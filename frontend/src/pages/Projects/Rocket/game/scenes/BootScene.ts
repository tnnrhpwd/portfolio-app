import Phaser from 'phaser';
import { ensureRuntimeTextures, missingSprites, queueGameSprites } from '../assets';
import { addText } from '../ui/button';
import { PALETTE, TEXT, VIEW_HEIGHT, VIEW_WIDTH } from '../ui/theme';

/**
 * Boot: load the sprite set behind a progress bar, then hand off to the menu.
 *
 * A failed sprite is collected and warned about rather than thrown — the game
 * draws a magenta placeholder for a missing texture, so one bad filename
 * degrades one enemy instead of breaking the page.
 */
export class BootScene extends Phaser.Scene {
  private spriteNames: string[] = [];

  constructor() {
    super('Boot');
  }

  preload(): void {
    const cx = VIEW_WIDTH / 2;
    const cy = VIEW_HEIGHT / 2;

    addText(this, cx, cy - 64, 'ROCKET', {
      size: 52,
      bold: true,
      color: TEXT.primary,
      origin: [0.5, 0.5],
    });

    const status = addText(this, cx, cy + 4, 'Loading sprites…', {
      size: 18,
      color: TEXT.muted,
      origin: [0.5, 0.5],
    });

    const barWidth = 440;
    this.add.rectangle(cx, cy + 46, barWidth, 10, PALETTE.panel).setOrigin(0.5);
    const fill = this.add
      .rectangle(cx - barWidth / 2, cy + 46, 0, 10, PALETTE.accent)
      .setOrigin(0, 0.5);

    this.spriteNames = queueGameSprites(this);

    this.load.on('progress', (value: number) => {
      fill.width = barWidth * Phaser.Math.Clamp(value, 0, 1);
    });
    this.load.on('complete', () => status.setText('Ready'));
  }

  create(): void {
    ensureRuntimeTextures(this);

    const missing = missingSprites(this, this.spriteNames);
    if (missing.length) {
      // Loud on purpose: a rename in sheets.json that isn't reflected here shows
      // up as magenta boxes in play, and this is the only place that says why.
      console.warn(
        `[rocket] ${missing.length} sprite(s) failed to load and will draw as placeholders:\n` +
          missing.join(', '),
      );
    }

    this.scene.start('Menu');
  }
}
