import Phaser from 'phaser';
import { announce } from '../accessibility';
import { PLACEHOLDER_KEY } from '../assets';
import { sfx } from '../audio/sfx';
import { UPGRADES, UPGRADE_ORDER } from '../core/upgrades';
import type { UpgradeKey } from '../core/types';
import { advanceWave, currentWorld, finishRun, getSave, isMaxed, priceOf, purchase } from '../session';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_WIDTH } from '../ui/theme';

const COLS = 4;
const CELL = { w: 284, h: 158, gapX: 18, gapY: 18 };

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

  constructor() {
    super('Shop');
  }

  create(): void {
    const world = currentWorld();
    this.grid = null;

    addSpaceBackdrop(this, 5150);

    addText(this, VIEW_WIDTH / 2, 52, 'WAVE CLEAR', {
      size: 40,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });
    addText(
      this,
      VIEW_WIDTH / 2,
      92,
      world ? `Wave ${world.wave} survived — hull ${world.player.hull}/${world.player.maxHull}` : '',
      { size: 17, color: TEXT.muted, origin: [0.5, 0.5] },
    );
    this.coinText = addText(this, VIEW_WIDTH / 2, 124, '', {
      size: 24,
      bold: true,
      color: TEXT.gold,
      origin: [0.5, 0.5],
    });

    addText(this, VIEW_WIDTH / 2, 160, 'SPEND YOUR COINS — upgrades are permanent', {
      size: 14,
      color: TEXT.dim,
      origin: [0.5, 0.5],
    });

    this.rebuildGrid();

    createButton(
      this,
      VIEW_WIDTH / 2 - 130,
      636,
      'NEXT WAVE ▶',
      () => {
        sfx.uiClick();
        advanceWave();
        announce('Next wave starting');
        this.scene.start('Play');
      },
      { width: 240, height: 58, fontSize: 20, fill: PALETTE.accent, textColor: '#04121c' },
    );

    createButton(
      this,
      VIEW_WIDTH / 2 + 130,
      636,
      'END RUN',
      () => {
        // Ending here still records the run — the score and wave reached are real.
        finishRun();
        sfx.uiClick();
        this.scene.start('Menu');
      },
      { width: 240, height: 58, fontSize: 20, outline: true, textColor: TEXT.muted },
    );

    announce('Shop open. Buy upgrades with your coins, then start the next wave.');
  }

  private rebuildGrid(): void {
    this.grid?.destroy();

    const save = getSave();
    this.coinText.setText(`COINS  ${save.coins.toLocaleString('en-US')}`);

    const totalWidth = COLS * CELL.w + (COLS - 1) * CELL.gapX;
    const startX = (VIEW_WIDTH - totalWidth) / 2;
    const startY = 196;

    const objects: Phaser.GameObjects.GameObject[] = [];

    UPGRADE_ORDER.forEach((key, index) => {
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      const x = startX + col * (CELL.w + CELL.gapX) + CELL.w / 2;
      const y = startY + row * (CELL.h + CELL.gapY) + CELL.h / 2;
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

    objects.push(addPanel(this, x, y, CELL.w, CELL.h, 0.86));

    const icon = this.add.image(x - CELL.w / 2 + 40, y - 40, this.tex(def.sprite));
    const size = Math.max(icon.width, icon.height) || 1;
    icon.setScale(46 / size);
    objects.push(icon);

    objects.push(
      addText(this, x - CELL.w / 2 + 76, y - 62, def.name.toUpperCase(), {
        size: 17,
        bold: true,
        color: TEXT.primary,
      }),
    );

    // Level pips: filled = owned, hollow = still buyable.
    for (let i = 0; i < def.maxLevel; i++) {
      const pip = this.add
        .rectangle(x - CELL.w / 2 + 80 + i * 16, y - 40, 11, 11, i < level ? PALETTE.accent : PALETTE.panel)
        .setStrokeStyle(1, PALETTE.panelEdge);
      objects.push(pip);
    }

    objects.push(
      addText(this, x - CELL.w / 2 + 20, y - 16, def.blurb, {
        size: 12,
        color: TEXT.muted,
        wrap: CELL.w - 40,
      }),
    );

    const label = maxed ? 'MAXED' : `BUY  ${price.toLocaleString('en-US')}`;
    const button = createButton(
      this,
      x,
      y + CELL.h / 2 - 28,
      label,
      () => this.buy(key),
      {
        width: CELL.w - 40,
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
