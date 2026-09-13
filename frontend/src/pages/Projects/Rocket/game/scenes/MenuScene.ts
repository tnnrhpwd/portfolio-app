import Phaser from 'phaser';
import { announce } from '../accessibility';
import { PLACEHOLDER_KEY } from '../assets';
import { playMusic, setMusicEnabled } from '../audio/music';
import { sfx, setMuted } from '../audio/sfx';
import { SHIPS, SHIP_ORDER } from '../core/ships';
import { deriveStats } from '../core/upgrades';
import type { ShipKey } from '../core/types';
import { buyShip, getSave, selectShip, wipeProgress } from '../session';
import { loadSettings, updateSettings } from '../settings';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton, createIconButton, type GameButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_HEIGHT, VIEW_WIDTH, isPortrait } from '../ui/theme';

const fmt = (value: number): string => value.toLocaleString('en-US');

/**
 * Menu: pick a ship, spend banked coins, read how to play, start a run.
 *
 * Ships are bought with coins earned in previous runs, so this screen is the
 * visible half of the meta-progression loop (the shop between waves is the
 * other half).
 */
export class MenuScene extends Phaser.Scene {
  private shipIndex = 0;
  private shipImage!: Phaser.GameObjects.Image;
  private shipName!: Phaser.GameObjects.Text;
  private shipStats!: Phaser.GameObjects.Text;
  private shipBlurb!: Phaser.GameObjects.Text;
  private shipAction!: GameButton;
  private bankText!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Menu');
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  // Two fixed boxes («ui/theme.ts»), so every position here is a plain
  // ternary between the landscape and portrait arrangement. Nothing reflows.

  private get w(): number {
    return VIEW_WIDTH;
  }

  private get h(): number {
    return VIEW_HEIGHT;
  }

  private get cx(): number {
    return VIEW_WIDTH / 2;
  }

  private get cy(): number {
    return VIEW_HEIGHT / 2;
  }

  private get portrait(): boolean {
    return isPortrait();
  }

  create(): void {
    this.overlay = null;
    const save = getSave();
    const saved = save.ship;
    this.shipIndex = Math.max(0, SHIP_ORDER.indexOf(saved));

    addSpaceBackdrop(this, 20260912);

    // The menu theme. Silent (and harmless) when no audio was rendered — see
    // `audio/music.ts` for why the assets are optional.
    playMusic('menu-drift');

    // Footer scrim. The backdrop is bright in patches, so the control row gets a
    // band of its own rather than dim text fighting a nebula. Created before the
    // text so the text paints over it. In portrait the hint gets its own line —
    // three items do not fit across a 720-wide box without colliding.
    const footerH = this.portrait ? 112 : 64;
    this.add.rectangle(this.cx, this.h - footerH / 2, this.w, footerH, PALETTE.bg, 0.62);

    addText(this, this.cx, this.portrait ? 96 : 74, 'ROCKET', {
      size: this.portrait ? 68 : 64,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    addText(this, this.cx, this.portrait ? 148 : 124, 'Dodge the debris. Bank the coins. Buy a better ship.', {
      size: this.portrait ? 17 : 19,
      color: TEXT.muted,
      origin: [0.5, 0.5],
      wrap: this.w - 60,
      align: 'center',
    });

    addText(
      this,
      this.cx,
      this.portrait ? 196 : 168,
      `BEST ${fmt(save.bestScore)}   ·   WAVE ${fmt(save.bestWave)}   ·   RUNS ${fmt(save.runs)}`,
      { size: 17, color: TEXT.accent, origin: [0.5, 0.5] },
    );

    this.buildShipPanel();

    createButton(
      this,
      this.cx,
      this.portrait ? 930 : 528,
      'PLAY',
      () => {
        sfx.uiClick();
        announce('Starting a run');
        this.scene.start('Play');
      },
      {
        width: this.portrait ? 360 : 320,
        height: this.portrait ? 68 : 62,
        fontSize: 26,
        fill: PALETTE.accent,
        textColor: '#04121c',
      },
    );

    createButton(
      this,
      this.cx,
      this.portrait ? 1014 : 598,
      'HOW TO PLAY',
      () => {
        sfx.uiClick();
        this.showHowTo();
      },
      { width: this.portrait ? 280 : 260, height: 48, fontSize: 18, outline: true },
    );

    addText(
      this,
      this.cx,
      this.portrait ? this.h - 84 : this.h - 32,
      'Move with arrows / WASD or by dragging — guns fire themselves.',
      {
        size: 15,
        color: TEXT.muted,
        origin: [0.5, 0.5],
        wrap: this.portrait ? this.w - 40 : this.w - 300,
        align: 'center',
      },
    );

    const controlY = this.portrait ? this.h - 34 : this.h - 32;

    const settings = loadSettings();
    const mute = createIconButton(this, 44, controlY, settings.muted ? '🔇' : '🔊', () => {
      const next = updateSettings({ muted: !loadSettings().muted });
      setMuted(next.muted);
      mute.setLabel(next.muted ? '🔇' : '🔊');
      announce(next.muted ? 'Sound off' : 'Sound on');
    });
    mute.container.setDepth(5);

    // Music has its own switch: a lot of players want the effects without a
    // soundtrack, and the whole set is silent until they ask for it.
    const music = createIconButton(this, 96, controlY, settings.music ? '🎵' : '🚫', () => {
      const next = updateSettings({ music: !loadSettings().music });
      setMusicEnabled(next.music);
      music.setLabel(next.music ? '🎵' : '🚫');
      announce(next.music ? 'Music on' : 'Music off');
    });
    music.container.setDepth(5);

    createButton(
      this,
      178,
      controlY,
      'RESET',
      () => this.showResetConfirm(),
      { width: 96, height: 34, fontSize: 14, outline: true, textColor: TEXT.muted },
    );

    addText(this, this.w - 24, controlY, 'Sprites: original SVG-free PNG set', {
      size: 13,
      color: TEXT.muted,
      origin: [1, 0.5],
    });

    announce('Rocket menu. Press play to start, or choose a ship with the arrow buttons.');
  }

  // ── Ship selector ────────────────────────────────────────────────────────

  /** A missing texture shows the loud magenta placeholder, never a silent green box. */
  private tex(name: string): string {
    if (this.textures.exists(name)) return name;
    return this.textures.exists(PLACEHOLDER_KEY) ? PLACEHOLDER_KEY : '__MISSING';
  }

  private buildShipPanel(): void {
    // Landscape puts the ship beside its stats; portrait stacks the ship above
    // them, because a 860-wide panel has nowhere to go in a 720-wide box.
    const portrait = this.portrait;

    addPanel(this, this.cx, portrait ? 470 : 320, portrait ? this.w - 60 : 860, portrait ? 350 : 214);

    this.shipImage = this.add
      .image(portrait ? this.cx : 410, portrait ? 420 : 322, this.tex(SHIPS[SHIP_ORDER[0]].sprite))
      .setScale(portrait ? 0.55 : 0.82);

    const arrowY = portrait ? 420 : 320;
    const arrowSize = portrait ? 56 : 58;
    createButton(this, portrait ? 58 : 250, arrowY, '◀', () => this.cycleShip(-1), {
      width: arrowSize,
      height: arrowSize,
      fontSize: 24,
    });
    createButton(this, portrait ? this.w - 58 : 1030, arrowY, '▶', () => this.cycleShip(1), {
      width: arrowSize,
      height: arrowSize,
      fontSize: 24,
    });

    const textX = portrait ? this.cx : 560;
    const origin: [number, number] = portrait ? [0.5, 0] : [0, 0];
    this.shipName = addText(this, textX, portrait ? 552 : 262, '', {
      size: 30,
      bold: true,
      color: TEXT.primary,
      origin,
    });
    this.shipStats = addText(this, textX, portrait ? 590 : 304, '', {
      size: 17,
      color: TEXT.accent,
      origin,
    });
    this.shipBlurb = addText(this, textX, portrait ? 622 : 334, '', {
      size: 16,
      color: TEXT.muted,
      wrap: portrait ? this.w - 140 : 420,
      align: portrait ? 'center' : 'left',
      origin,
    });

    this.bankText = addText(this, this.cx, portrait ? 700 : 442, '', {
      size: 18,
      color: TEXT.gold,
      origin: [0.5, 0.5],
    });

    this.shipAction = createButton(this, this.cx, portrait ? 750 : 480, '', () => this.shipActionClick(), {
      width: portrait ? 300 : 240,
      height: 44,
      fontSize: 18,
    });

    this.refreshShip();
  }

  private get selectedShip(): ShipKey {
    return SHIP_ORDER[this.shipIndex];
  }

  private cycleShip(direction: number): void {
    sfx.uiClick();
    this.shipIndex = (this.shipIndex + direction + SHIP_ORDER.length) % SHIP_ORDER.length;
    this.refreshShip();
  }

  private refreshShip(): void {
    const key = this.selectedShip;
    const def = SHIPS[key];
    const save = getSave();
    const owned = save.unlockedShips.includes(key);

    this.shipImage.setTexture(this.tex(def.sprite));
    this.shipName.setText(def.name);
    this.shipBlurb.setText(def.blurb);

    // Show the ship's *effective* numbers, i.e. including banked upgrades, so
    // the menu and the first wave agree.
    const stats = deriveStats(def, save.levels);
    this.shipStats.setText(
      `HULL ${stats.maxHull}   SPEED ${Math.round(stats.speed * 100)}%   ` +
        `DAMAGE ${stats.damage.toFixed(1)}   BARRELS ${stats.barrels}`,
    );

    this.bankText.setText(`COINS ${fmt(save.coins)}`);

    if (!owned) {
      const affordable = save.coins >= def.cost;
      this.shipAction.setLabel(affordable ? `UNLOCK  ${fmt(def.cost)}` : `NEEDS ${fmt(def.cost)}`);
      this.shipAction.setEnabled(affordable);
    } else if (save.ship === key) {
      this.shipAction.setLabel('SELECTED');
      this.shipAction.setEnabled(false);
    } else {
      this.shipAction.setLabel('SELECT');
      this.shipAction.setEnabled(true);
    }

    // Announce the selection so the carousel is usable without sight.
    announce(
      `${def.name}. ${owned ? 'Owned' : `Locked, costs ${def.cost} coins`}. ` +
        `Hull ${stats.maxHull}, speed ${Math.round(stats.speed * 100)} percent.`,
    );
  }

  private shipActionClick(): void {
    const key = this.selectedShip;
    const save = getSave();
    if (save.unlockedShips.includes(key)) {
      selectShip(key);
      sfx.buy();
    } else if (buyShip(key)) {
      selectShip(key);
      sfx.buy();
      announce(`${SHIPS[key].name} unlocked`);
    } else {
      sfx.deny();
    }
    this.refreshShip();
  }

  // ── Overlays ─────────────────────────────────────────────────────────────

  private closeOverlay(): void {
    this.overlay?.destroy();
    this.overlay = null;
  }

  private showHowTo(): void {
    this.closeOverlay();
    const cx = this.cx;
    const cy = this.cy;
    const portrait = this.portrait;
    const panelW = portrait ? this.w - 40 : 720;
    const panelH = portrait ? 660 : 470;
    const rowGap = portrait ? 66 : 62;
    const topRow = portrait ? cy - 200 : cy - 138;
    const bodyWrap = portrait ? panelW - 230 : 480;

    const shade = this.add.rectangle(cx, cy, this.w, this.h, PALETTE.bg, 0.9);
    shade.setInteractive(); // swallow clicks on the arena behind
    const panel = addPanel(this, cx, cy, panelW, panelH, 0.96);

    const lines: Array<[string, string]> = [
      ['MOVE', 'Arrow keys or W A S D. On a phone, drag anywhere — the ship follows your thumb.'],
      ['FIRE', 'Automatic. Every ship shoots on its own, so all of your attention goes on dodging.'],
      ['SHIELD', 'A shield absorbs one hit and grows back after a few quiet seconds. Hull hits end the run.'],
      ['LOOT', 'Coins and gems fall out of destroyed enemies. Collecting them banks them immediately — you keep them even if you die.'],
      ['SHOP', 'Clear a wave and you get a shop: spend banked coins on permanent upgrades.'],
      ['PAUSE', 'Escape or P. Mute is on the menu.'],
    ];

    const objects: Phaser.GameObjects.GameObject[] = [shade, panel];
    objects.push(
      addText(this, cx, cy - panelH / 2 + 52, 'HOW TO PLAY', {
        size: 26,
        bold: true,
        color: TEXT.primary,
        origin: [0.5, 0.5],
      }),
    );

    let y = topRow;
    for (const [heading, body] of lines) {
      objects.push(addText(this, cx - 300, y, heading, { size: 16, bold: true, color: TEXT.accent }));
      objects.push(
        addText(this, cx - 190, y - 2, body, { size: 15, color: TEXT.muted, wrap: bodyWrap }),
      );
      y += rowGap;
    }

    const close = createButton(
      this,
      cx,
      portrait ? cy + 280 : cy + 190,
      'GOT IT',
      () => this.closeOverlay(),
      {
        width: 180,
        height: 46,
        fontSize: 18,
        fill: PALETTE.accent,
        textColor: '#04121c',
      },
    );

    this.overlay = this.add.container(0, 0, [...objects, close.container]).setDepth(50);
  }

  private showResetConfirm(): void {
    this.closeOverlay();
    const cx = this.cx;
    const cy = this.cy;

    const shade = this.add.rectangle(cx, cy, this.w, this.h, PALETTE.bg, 0.9);
    shade.setInteractive();
    const panel = addPanel(this, cx, cy, this.portrait ? 620 : 560, this.portrait ? 300 : 240, 0.96);

    const title = addText(this, cx, cy - 68, 'RESET PROGRESS?', {
      size: 24,
      bold: true,
      color: TEXT.danger,
      origin: [0.5, 0.5],
    });
    const body = addText(
      this,
      cx,
      cy - 16,
      'This clears coins, upgrades, best score and unlocked ships. It cannot be undone.',
      { size: 16, color: TEXT.muted, wrap: 460, align: 'center', origin: [0.5, 0.5] },
    );

    const yes = createButton(
      this,
      cx - 96,
      cy + 68,
      'RESET',
      () => {
        wipeProgress();
        sfx.deny();
        this.closeOverlay();
        this.scene.restart();
      },
      { width: 168, height: 46, fontSize: 17, textColor: TEXT.danger, outline: true },
    );
    const no = createButton(this, cx + 96, cy + 68, 'CANCEL', () => this.closeOverlay(), {
      width: 168,
      height: 46,
      fontSize: 17,
    });

    this.overlay = this.add
      .container(0, 0, [shade, panel, title, body, yes.container, no.container])
      .setDepth(50);
  }
}
