import Phaser from 'phaser';
import { announce } from '../accessibility';
import { PLACEHOLDER_KEY } from '../assets';
import { sfx, setMuted } from '../audio/sfx';
import { SHIPS, SHIP_ORDER } from '../core/ships';
import { deriveStats } from '../core/upgrades';
import type { ShipKey } from '../core/types';
import { buyShip, getSave, selectShip, wipeProgress } from '../session';
import { loadSettings, updateSettings } from '../settings';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton, createIconButton, type GameButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_HEIGHT, VIEW_WIDTH } from '../ui/theme';

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

  create(): void {
    this.overlay = null;
    const save = getSave();
    const saved = save.ship;
    this.shipIndex = Math.max(0, SHIP_ORDER.indexOf(saved));

    addSpaceBackdrop(this, 20260912);

    // Footer scrim. The backdrop is bright in patches, so the control row gets a
    // band of its own rather than dim text fighting a nebula. Created before the
    // text so the text paints over it.
    this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT - 32, VIEW_WIDTH, 64, PALETTE.bg, 0.62);

    addText(this, VIEW_WIDTH / 2, 74, 'ROCKET', {
      size: 64,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    addText(this, VIEW_WIDTH / 2, 124, 'Dodge the debris. Bank the coins. Buy a better ship.', {
      size: 19,
      color: TEXT.muted,
      origin: [0.5, 0.5],
    });

    addText(
      this,
      VIEW_WIDTH / 2,
      168,
      `BEST ${fmt(save.bestScore)}   ·   WAVE ${fmt(save.bestWave)}   ·   RUNS ${fmt(save.runs)}`,
      { size: 17, color: TEXT.accent, origin: [0.5, 0.5] },
    );

    this.buildShipPanel();

    createButton(
      this,
      VIEW_WIDTH / 2,
      528,
      'PLAY',
      () => {
        sfx.uiClick();
        announce('Starting a run');
        this.scene.start('Play');
      },
      { width: 320, height: 62, fontSize: 26, fill: PALETTE.accent, textColor: '#04121c' },
    );

    createButton(
      this,
      VIEW_WIDTH / 2,
      598,
      'HOW TO PLAY',
      () => {
        sfx.uiClick();
        this.showHowTo();
      },
      { width: 260, height: 46, fontSize: 18, outline: true },
    );

    addText(
      this,
      VIEW_WIDTH / 2,
      VIEW_HEIGHT - 32,
      'Move with arrows / WASD or by dragging — guns fire themselves.',
      { size: 15, color: TEXT.muted, origin: [0.5, 0.5] },
    );

    const settings = loadSettings();
    const mute = createIconButton(this, 44, VIEW_HEIGHT - 32, settings.muted ? '🔇' : '🔊', () => {
      const next = updateSettings({ muted: !loadSettings().muted });
      setMuted(next.muted);
      mute.setLabel(next.muted ? '🔇' : '🔊');
    });
    mute.container.setDepth(5);

    createButton(
      this,
      126,
      VIEW_HEIGHT - 32,
      'RESET',
      () => this.showResetConfirm(),
      { width: 96, height: 34, fontSize: 14, outline: true, textColor: TEXT.muted },
    );

    addText(this, VIEW_WIDTH - 24, VIEW_HEIGHT - 32, 'Sprites: original SVG-free PNG set', {
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
    addPanel(this, VIEW_WIDTH / 2, 320, 860, 214);

    this.shipImage = this.add.image(410, 322, this.tex(SHIPS[SHIP_ORDER[0]].sprite)).setScale(0.82);

    createButton(this, 250, 320, '◀', () => this.cycleShip(-1), { width: 58, height: 58, fontSize: 24 });
    createButton(this, 1030, 320, '▶', () => this.cycleShip(1), { width: 58, height: 58, fontSize: 24 });

    this.shipName = addText(this, 560, 262, '', { size: 30, bold: true, color: TEXT.primary });
    this.shipStats = addText(this, 560, 304, '', { size: 17, color: TEXT.accent });
    this.shipBlurb = addText(this, 560, 334, '', {
      size: 16,
      color: TEXT.muted,
      wrap: 420,
    });

    this.bankText = addText(this, VIEW_WIDTH / 2, 442, '', {
      size: 18,
      color: TEXT.gold,
      origin: [0.5, 0.5],
    });

    this.shipAction = createButton(this, VIEW_WIDTH / 2, 480, '', () => this.shipActionClick(), {
      width: 240,
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
    const cx = VIEW_WIDTH / 2;
    const cy = VIEW_HEIGHT / 2;

    const shade = this.add.rectangle(cx, cy, VIEW_WIDTH, VIEW_HEIGHT, PALETTE.bg, 0.9);
    shade.setInteractive(); // swallow clicks on the arena behind
    const panel = addPanel(this, cx, cy, 720, 470, 0.96);

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
      addText(this, cx, cy - 190, 'HOW TO PLAY', {
        size: 26,
        bold: true,
        color: TEXT.primary,
        origin: [0.5, 0.5],
      }),
    );

    let y = cy - 138;
    for (const [heading, body] of lines) {
      objects.push(addText(this, cx - 300, y, heading, { size: 16, bold: true, color: TEXT.accent }));
      objects.push(
        addText(this, cx - 190, y - 2, body, { size: 15, color: TEXT.muted, wrap: 480 }),
      );
      y += 62;
    }

    const close = createButton(this, cx, cy + 190, 'GOT IT', () => this.closeOverlay(), {
      width: 180,
      height: 46,
      fontSize: 18,
      fill: PALETTE.accent,
      textColor: '#04121c',
    });

    this.overlay = this.add.container(0, 0, [...objects, close.container]).setDepth(50);
  }

  private showResetConfirm(): void {
    this.closeOverlay();
    const cx = VIEW_WIDTH / 2;
    const cy = VIEW_HEIGHT / 2;

    const shade = this.add.rectangle(cx, cy, VIEW_WIDTH, VIEW_HEIGHT, PALETTE.bg, 0.9);
    shade.setInteractive();
    const panel = addPanel(this, cx, cy, 560, 240, 0.96);

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
