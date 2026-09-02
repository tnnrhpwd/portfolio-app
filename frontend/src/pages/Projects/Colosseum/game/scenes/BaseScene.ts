import Phaser from 'phaser';
import type { GameState } from '../core';
import { achievementById, evaluateAchievements } from '../core';
import { getState, setState } from '../state/store';
import { addText, createButton, type ButtonOpts, type GameButton } from '../ui/button';

/** Shared helpers for the menu scenes. */
export abstract class BaseScene extends Phaser.Scene {
  protected get gameState(): GameState {
    return getState();
  }

  protected set gameState(next: GameState) {
    setState(next);
  }

  protected header(text: string): void {
    const { width } = this.scale;
    addText(this, width / 2, 40, text, {
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
    return createButton(this, x, y, label, onClick, opts);
  }

  protected backButton(sceneKey: string): GameButton {
    return this.button(96, 40, 'BACK', () => this.scene.start(sceneKey), {
      width: 120,
      height: 44,
      fontSize: 18,
    });
  }

  /** Returns to the owning city (or the hub when launched directly). */
  protected cityBack(cityId: string): GameButton {
    return this.button(96, 40, 'BACK', () => {
      if (cityId) this.scene.start('City', { cityId });
      else this.scene.start('Main');
    }, { width: 120, height: 44, fontSize: 18 });
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
    this.tweens.add({
      targets: text,
      alpha: { from: 1, to: 0 },
      duration: 900,
      delay: 1600,
      onComplete: () => text.destroy(),
    });
  }

  /** Records and toasts any newly unlocked achievements. */
  protected applyAchievements(): void {
    const { state: next, unlocked } = evaluateAchievements(this.gameState);
    if (unlocked.length === 0) return;
    this.gameState = next;
    for (const id of unlocked) {
      const achievement = achievementById(id);
      if (achievement) this.toast(`Achievement unlocked: ${achievement.label}`);
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
      .rectangle(width / 2, height / 2, 560, 260, 0x1c1610, 1)
      .setStrokeStyle(2, 0xe8b84b)
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
}
