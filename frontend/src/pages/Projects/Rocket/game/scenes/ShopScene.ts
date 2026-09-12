import Phaser from 'phaser';
import { announce } from '../accessibility';
import { PLACEHOLDER_KEY } from '../assets';
import { sfx } from '../audio/sfx';
import { UPGRADES, UPGRADE_ORDER } from '../core/upgrades';
import type { UpgradeKey } from '../core/types';
import { advanceWave, currentWorld, finishRun, getSave, isMaxed, priceOf, purchase } from '../session';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_WIDTH, isPortrait } from '../ui/theme';

/**
 * The between-waves shop.
 *
 * This is where coins become power. Purchases are *permanent* and apply to the
 * run in progress immediately, which is the whole loop: a good run funds the
 * upgrades that make the next wave survivable.
 */
export class ShopScene extends Phaser.Scene {
  private coinText!: Phaser.GameObjects.Text;
  private grid: Phaser.GameObjects.Container | null = null;

  /**
   * Grid shape for the active design box: 4×2 side by side in landscape, 2×4
   * stacked in portrait, where four 284-wide cells cannot fit in 720.
   */
  private cell = { cols: 4, w: 284, h: 158, gapX: 18, gapY: 18, startY: 196 };

  constructor() {
    super('Shop');
  }

  private get w(): number {
    return VIEW_WIDTH;
  }

  private get cx(): number {
    return VIEW_WIDTH / 2;
  }

  private get portrait(): boolean {
    return isPortrait();
  }

  create(): void {
    const world = currentWorld();
    this.grid = null;

    const portrait = this.portrait;
    this.cell = portrait
      ? { cols: 2, w: 326, h: 158, gapX: 18, gapY: 18, startY: 240 }
      : { cols: 4, w: 284, h: 158, gapX: 18, gapY: 18, startY: 196 };

    addSpaceBackdrop(this, 5150);

    addText(this, this.cx, portrait ? 78 : 52, 'WAVE CLEAR', {
      size: 40,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    addText(
      this,
      this.cx,
      portrait ? 120 : 92,
      world ? `Wave ${world.wave} survived — hull ${world.player.hull}/${world.player.maxHull}` : '',
      { size: 17, color: TEXT.muted, origin: [0.5, 0.5] },
    );
    this.coinText = addText(this, this.cx, portrait ? 158 : 124, '', {
      size: 24,
      bold: true,
      color: TEXT.gold,
      origin: [0.5, 0.5],
    });

    addText(this, this.cx, portrait ? 194 : 160, 'SPEND YOUR COINS — upgrades are permanent', {
      size: 14,
      color: TEXT.dim,
      origin: [0.5, 0.5],
    });

    this.rebuildGrid();

    createButton(
      this,
      portrait ? this.cx : this.cx - 130,
      portrait ? 1050 : 636,
      'NEXT WAVE ▶',
      () => {
        sfx.uiClick();
        advanceWave();
        announce('Next wave starting');
        this.scene.start('Play');
      },
      {
        width: portrait ? 300 : 240,
        height: 58,
        fontSize: 20,
        fill: PALETTE.accent,
        textColor: '#04121c',
      },
    );

    createButton(
      this,
      portrait ? this.cx : this.cx + 130,
      portrait ? 1130 : 636,
      'END RUN',
      () => {
        // Ending here still records the run — the score and wave reached are real.
        finishRun();
        sfx.uiClick();
        this.scene.start('Menu');
      },
      {
        width: portrait ? 300 : 240,
        height: 54,
        fontSize: 20,
        outline: true,
        textColor: TEXT.muted,
      },
    );

    announce('Shop open. Buy upgrades with your coins, then start the next wave.');
  }

  private rebuildGrid(): void {
    this.grid?.destroy();

    const save = getSave();
    this.coinText.setText(`COINS  ${save.coins.toLocaleString('en-US')}`);

    const { cols, w, h, gapX, gapY, startY } = this.cell;
    const totalWidth = cols * w + (cols - 1) * gapX;
    const startX = (this.w - totalWidth) / 2;

    const objects: Phaser.GameObjects.GameObject[] = [];

    UPGRADE_ORDER.forEach((key, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (w + gapX) + w / 2;
      const y = startY + row * (h + gapY) + h / 2;
      this.buildCell(key, x, y, objects);
    });

    this.grid = this.add.container(0, 0, objects).setDepth(2);
  }

  private buildCell(
    key: UpgradeKey,
    x: number,
    y: number,
    objects: Phaser.GameObjects.GameObject[],
  ): void {
    const def = UPGRADES[key];
    const save = getSave();
    const level = save.levels[key];
    const maxed = isMaxed(key);
    const price = priceOf(key);
    const affordable = !maxed && save.coins >= price;

    const { w: cellW, h: cellH } = this.cell;

    objects.push(addPanel(this, x, y, cellW, cellH, 0.86));

    const icon = this.add.image(x - cellW / 2 + 40, y - 40, this.tex(def.sprite));
    const size = Math.max(icon.width, icon.height) || 1;
    icon.setScale(46 / size);
    objects.push(icon);

    objects.push(
      addText(this, x - cellW / 2 + 76, y - 62, def.name.toUpperCase(), {
        size: 17,
        bold: true,
        color: TEXT.primary,
      }),
    );

    // Level pips: filled = owned, hollow = still buyable.
    for (let i = 0; i < def.maxLevel; i++) {
      const pip = this.add
        .rectangle(x - cellW / 2 + 80 + i * 16, y - 40, 11, 11, i < level ? PALETTE.accent : PALETTE.panel)
        .setStrokeStyle(1, PALETTE.panelEdge);
      objects.push(pip);
    }

    objects.push(
      addText(this, x - cellW / 2 + 20, y - 16, def.blurb, {
        size: 12,
        color: TEXT.muted,
        wrap: cellW - 40,
      }),
    );

    const label = maxed ? 'MAXED' : `BUY  ${price.toLocaleString('en-US')}`;
    const button = createButton(
      this,
      x,
      y + cellH / 2 - 28,
      label,
      () => this.buy(key),
      {
        width: cellW - 40,
        height: 34,
        fontSize: 15,
        fill: affordable ? PALETTE.panelHover : PALETTE.panel,
        textColor: affordable ? TEXT.gold : TEXT.dim,
      },
    );
    button.setEnabled(!maxed);
    objects.push(button.container);
  }

  private buy(key: UpgradeKey): void {
    const result = purchase(key);
    if (!result.ok) {
      sfx.deny();
      if (result.reason === 'poor') announce('Not enough coins');
      return;
    }
    sfx.buy();
    announce(`${UPGRADES[key].name} upgraded`);
    this.rebuildGrid();
  }

  private tex(name: string): string {
    if (this.textures.exists(name)) return name;
    return this.textures.exists(PLACEHOLDER_KEY) ? PLACEHOLDER_KEY : '__MISSING';
  }
}
