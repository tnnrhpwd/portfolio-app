import Phaser from 'phaser';
import type { GameState } from '../core';
import { achievementById, evaluateAchievements } from '../core';
import { getState, setState } from '../state/store';
import { addText, createButton, type ButtonOpts, type GameButton } from '../ui/button';
import { getSettings } from '../settings';
import { getThemeColors, type ThemeColors } from '../theme';
import { announce } from '../accessibility';

/** Shared helpers for the menu scenes, including keyboard navigation. */
export abstract class BaseScene extends Phaser.Scene {
  private focusables: GameButton[] = [];
  private focusIndex = -1;
  private focusRing: Phaser.GameObjects.Rectangle | null = null;
  private backAction: (() => void) | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  protected get gameState(): GameState {
    return getState();
  }

  protected set gameState(next: GameState) {
    setState(next);
  }

  /** The resolved color palette for the current theme. */
  protected get theme(): ThemeColors {
    return getThemeColors();
  }

  /** Paints the scene background with the theme color (or a custom one). */
  protected applyBackground(color?: string): void {
    // Guard against a resize/render racing a scene teardown, where the main
    // camera can already be destroyed.
    if (!this.cameras?.main) return;
    this.cameras.main.setBackgroundColor(color ?? this.theme.bg);
  }

  // ── Responsive layout (the canvas resizes to the device via Scale.RESIZE) ──
  protected get w(): number {
    return this.scale.width;
  }

  protected get h(): number {
    return this.scale.height;
  }

  protected get cx(): number {
    return this.w / 2;
  }

  protected get cy(): number {
    return this.h / 2;
  }

  /** True on narrow (portrait) screens, where rows should stack vertically. */
  protected get compact(): boolean {
    return this.w < 720;
  }

  private handleResize = (): void => {
    // Only re-render while the scene is actually running.
    if (this.scene.isActive()) this.onResize();
  };

  /** Override to re-render when the device is resized or rotated. */
  protected onResize(): void {}

  init(): void {
    this.focusables = [];
    this.focusIndex = -1;
    this.backAction = null;
    this.focusRing = null;

    this.keyHandler = (event: KeyboardEvent) => {
      // Ignore keys delivered while this scene is being torn down (a resize
      // or scene transition can race the listener's removal).
      if (!this.scene.isActive()) return;
      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          this.moveFocus(-1);
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          this.moveFocus(1);
          break;
        case 'Enter':
        case ' ':
          this.activateFocus();
          break;
        case 'Escape':
          this.onBack();
          break;
        case 'Tab':
          event.preventDefault();
          this.moveFocus(1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize);
    this.input?.on('pointerdown', () => this.clearFocus());
  }

  shutdown(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize);
  }

  protected header(text: string): void {
    addText(this, this.cx, 40, text, {
      fontSize: '36px',
      color: '#e8b84b',
      fontStyle: 'bold',
    });
  }

  protected goldText(): void {
    const { width } = this.scale;
    addText(this, width - 24, 40, `Gold: ${this.gameState.gold}`, {
      fontSize: '22px',
      color: '#f2d98c',
    }).setOrigin(1, 0.5);
  }

  protected button(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts?: ButtonOpts,
  ): GameButton {
    const btn = createButton(this, x, y, label, onClick, opts);
    this.focusables.push(btn);
    return btn;
  }

  protected backButton(sceneKey: string): GameButton {
    this.backAction = () => this.scene.start(sceneKey);
    return this.button(96, 40, 'BACK', () => this.scene.start(sceneKey), {
      width: 120,
      height: 44,
      fontSize: 18,
    });
  }

  /** Returns to the hub (Main), since facilities are entered from there directly. */
  protected cityBack(cityId: string): GameButton {
    void cityId;
    this.backAction = () => this.scene.start('Main');
    return this.button(96, 40, 'BACK', () => this.scene.start('Main'), {
      width: 120,
      height: 44,
      fontSize: 18,
    });
  }

  /** Clears the display list and resets keyboard-focus tracking. */
  protected clearScreen(): void {
    this.children.removeAll();
    this.focusables = [];
    this.focusIndex = -1;
    this.focusRing?.destroy();
    this.focusRing = null;
  }

  /** Shows a temporary toast banner near the top of the screen. */
  protected toast(message: string): void {
    const { width } = this.scale;
    const text = addText(this, width / 2, 84, message, {
      fontSize: '20px',
      color: '#f2d98c',
      backgroundColor: '#000000cc',
      padding: { x: 12, y: 8 },
    }).setDepth(950);
    if (getSettings().reducedMotion) {
      this.time.delayedCall(2200, () => text.destroy());
    } else {
      this.tweens.add({
        targets: text,
        alpha: { from: 1, to: 0 },
        duration: 900,
        delay: 1600,
        onComplete: () => text.destroy(),
      });
    }
  }

  /** Records and toasts any newly unlocked achievements. */
  protected applyAchievements(): void {
    const { state: next, unlocked } = evaluateAchievements(this.gameState);
    if (unlocked.length === 0) return;
    this.gameState = next;
    for (const id of unlocked) {
      const achievement = achievementById(id);
      if (achievement) {
        this.toast(`Achievement unlocked: ${achievement.label}`);
        announce(`Achievement unlocked: ${achievement.label}`);
      }
    }
  }

  /** A modal YES/NO confirmation over the current screen. */
  protected confirm(title: string, body: string, onYes: () => void, onNo?: () => void): void {
    const { width, height } = this.scale;
    const depth = 900;
    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
      .setDepth(depth)
      .setInteractive();
    const panel = this.add
      .rectangle(width / 2, height / 2, 560, 260, this.theme.panel, 1)
      .setStrokeStyle(2, this.theme.panelStroke)
      .setDepth(depth + 1);
    const titleText = addText(this, width / 2, height / 2 - 78, title, {
      fontSize: '28px',
      color: '#e8b84b',
      fontStyle: 'bold',
    }).setDepth(depth + 2);
    const bodyText = addText(this, width / 2, height / 2 - 16, body, {
      fontSize: '18px',
      wordWrap: { width: 480 },
    }).setDepth(depth + 2);

    const disposables: Phaser.GameObjects.GameObject[] = [overlay, panel, titleText, bodyText];
    let cleanup = (): void => {};
    const yesBtn = this.button(width / 2 - 100, height / 2 + 62, 'YES', () => {
      cleanup();
      onYes();
    }, { width: 140, height: 52, fontSize: 20 });
    const noBtn = this.button(width / 2 + 100, height / 2 + 62, 'NO', () => {
      cleanup();
      onNo?.();
    }, { width: 140, height: 52, fontSize: 20 });
    yesBtn.container.setDepth(depth + 2);
    noBtn.container.setDepth(depth + 2);
    cleanup = () => {
      disposables.forEach((d) => d.destroy());
      yesBtn.container.destroy();
      noBtn.container.destroy();
    };
  }

  private moveFocus(delta: number): void {
    const list = this.focusables;
    if (list.length === 0) return;
    let next = this.focusIndex;
    for (let i = 0; i < list.length; i += 1) {
      next = (next + delta + list.length) % list.length;
      if (list[next].isEnabled()) break;
    }
    this.focusIndex = next;
    this.drawFocusRing();
  }

  private drawFocusRing(): void {
    const btn = this.focusables[this.focusIndex];
    if (!btn) return;
    if (!this.focusRing) {
      this.focusRing = this.add
        .rectangle(0, 0, 10, 10, 0x000000, 0)
        .setStrokeStyle(3, this.theme.focusStroke)
        .setDepth(999);
    }
    this.focusRing
      .setPosition(btn.container.x, btn.container.y)
      .setSize(btn.container.width + 8, btn.container.height + 8)
      .setVisible(true);
  }

  private clearFocus(): void {
    this.focusIndex = -1;
    this.focusRing?.setVisible(false);
  }

  private activateFocus(): void {
    const btn = this.focusables[this.focusIndex];
    if (btn && btn.isEnabled()) btn.activate();
  }

  private onBack(): void {
    if (this.backAction) this.backAction();
    else if (this.scene.key !== 'Main') this.scene.start('Main');
  }
}
