import Phaser from 'phaser';
import { announce } from '../accessibility';
import { sfx } from '../audio/sfx';
import { startRun, getSave, type RunSummary } from '../session';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_WIDTH } from '../ui/theme';

/**
 * End of a run.
 *
 * Coins were banked as they were collected, so this screen never scolds the
 * player for dying — it shows what the run earned and puts them back in the
 * menu, one upgrade richer.
 */
export class GameOverScene extends Phaser.Scene {
  private summary: RunSummary = {
    score: 0,
    wave: 0,
    kills: 0,
    coins: 0,
    accuracy: 0,
    msAlive: 0,
  };

  constructor() {
    super('GameOver');
  }

  init(data?: RunSummary): void {
    if (data) this.summary = data;
  }

  create(): void {
    const save = getSave();
    const isBest = this.registry.get('rocket.wasBest') === true;

    addSpaceBackdrop(this, 9090, { alpha: 0.35 });

    addText(this, VIEW_WIDTH / 2, 92, 'RUN OVER', {
      size: 54,
      bold: true,
      color: TEXT.danger,
      origin: [0.5, 0.5],
    });

    if (isBest) {
      addText(this, VIEW_WIDTH / 2, 140, '★ NEW BEST SCORE ★', {
        size: 20,
        bold: true,
        color: TEXT.gold,
        origin: [0.5, 0.5],
      });
    }

    addPanel(this, VIEW_WIDTH / 2, 300, 620, 220);

    const rows: Array<[string, string]> = [
      ['SCORE', this.summary.score.toLocaleString('en-US')],
      ['WAVE REACHED', String(this.summary.wave)],
      ['ENEMIES DESTROYED', this.summary.kills.toLocaleString('en-US')],
      ['ACCURACY', `${Math.round(this.summary.accuracy * 100)}%`],
      ['COINS EARNED', this.summary.coins.toLocaleString('en-US')],
      ['TIME SURVIVED', formatDuration(this.summary.msAlive)],
    ];

    const left = VIEW_WIDTH / 2 - 270;
    let y = 222;
    for (const [label, value] of rows) {
      addText(this, left, y, label, { size: 17, color: TEXT.muted });
      addText(this, VIEW_WIDTH / 2 + 270, y, value, {
        size: 20,
        bold: true,
        color: TEXT.primary,
        origin: [1, 0],
      });
      y += 34;
    }

    addText(
      this,
      VIEW_WIDTH / 2,
      438,
      `Banked: ${save.coins.toLocaleString('en-US')} coins  ·  best ${save.bestScore.toLocaleString('en-US')}`,
      { size: 17, color: TEXT.gold, origin: [0.5, 0.5] },
    );

    createButton(
      this,
      VIEW_WIDTH / 2,
      512,
      'PLAY AGAIN',
      () => {
        sfx.uiClick();
        startRun();
        this.scene.start('Play');
      },
      { width: 280, height: 60, fontSize: 22, fill: PALETTE.accent, textColor: '#04121c' },
    );

    createButton(
      this,
      VIEW_WIDTH / 2,
      582,
      'BACK TO MENU',
      () => {
        sfx.uiClick();
        this.scene.start('Menu');
      },
      { width: 240, height: 50, fontSize: 18, outline: true },
    );

    addText(
      this,
      VIEW_WIDTH / 2,
      648,
      'Coins are saved the moment you pick them up — they are already yours.',
      { size: 14, color: TEXT.dim, origin: [0.5, 0.5] },
    );

    announce(
      `Run over. Score ${this.summary.score}, wave ${this.summary.wave}, ` +
        `${this.summary.kills} enemies destroyed.`,
    );
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
