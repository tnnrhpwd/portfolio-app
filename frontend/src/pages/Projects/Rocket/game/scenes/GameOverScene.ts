import Phaser from 'phaser';
import { announce } from '../accessibility';
import { playMusic } from '../audio/music';
import { sfx } from '../audio/sfx';
import { isLoggedIn } from '../cloud';
import { startRun, getSave, type RunSummary } from '../session';
import { addPanel, addSpaceBackdrop } from '../ui/backdrop';
import { addText, createButton } from '../ui/button';
import { PALETTE, TEXT, VIEW_WIDTH, isPortrait } from '../ui/theme';

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

    // Landscape is a short, wide card; portrait is a tall one, so the panel grows
    // and the rows breathe rather than leaving a band of empty space.
    const portrait = isPortrait();
    const cx = VIEW_WIDTH / 2;
    const titleY = portrait ? 190 : 92;
    const panelY = portrait ? 510 : 300;
    const panelH = portrait ? 320 : 220;
    const rowTop = panelY - panelH / 2 + (portrait ? 40 : 32);
    const rowGap = portrait ? 44 : 34;

    addSpaceBackdrop(this, 9090, { alpha: 0.35 });
    // A one-shot sting (the manifest marks it `loop: false`), so it plays once
    // and stops instead of droning under the stats.
    playMusic('run-over');

    addText(this, cx, titleY, 'RUN OVER', {
      size: 54,
      bold: true,
      color: TEXT.danger,
      origin: [0.5, 0.5],
    });

    if (isBest) {
      addText(this, cx, titleY + 48, '★ NEW BEST SCORE ★', {
        size: 20,
        bold: true,
        color: TEXT.gold,
        origin: [0.5, 0.5],
      });
    }

    addPanel(this, cx, panelY, 620, panelH);

    const rows: Array<[string, string]> = [
      ['SCORE', this.summary.score.toLocaleString('en-US')],
      ['WAVE REACHED', String(this.summary.wave)],
      ['ENEMIES DESTROYED', this.summary.kills.toLocaleString('en-US')],
      ['ACCURACY', `${Math.round(this.summary.accuracy * 100)}%`],
      ['COINS EARNED', this.summary.coins.toLocaleString('en-US')],
      ['TIME SURVIVED', formatDuration(this.summary.msAlive)],
    ];

    const left = cx - 270;
    let y = rowTop;
    for (const [label, value] of rows) {
      addText(this, left, y, label, { size: 17, color: TEXT.muted });
      addText(this, cx + 270, y, value, {
        size: 20,
        bold: true,
        color: TEXT.primary,
        origin: [1, 0],
      });
      y += rowGap;
    }

    addText(
      this,
      cx,
      portrait ? 730 : 438,
      `Banked: ${save.coins.toLocaleString('en-US')} coins  ·  best ${save.bestScore.toLocaleString('en-US')}`,
      { size: 17, color: TEXT.gold, origin: [0.5, 0.5] },
    );

    // Leaderboard status for this run. `submittedWave` is still the PREVIOUS value
    // here — publishing is a network round-trip that starts when the run ends — so
    // "newer than what was already sent" is exactly "a submission is in flight".
    const board: [string, string] =
      this.summary.wave < 1
        ? ['', TEXT.muted]
        : !isLoggedIn()
          ? [`Sign in to put wave ${this.summary.wave} on the leaderboard.`, TEXT.dim]
          : this.summary.wave > save.submittedWave
            ? [`Publishing wave ${this.summary.wave} to the leaderboard…`, TEXT.accent]
            : [`Wave ${this.summary.wave} is already on the leaderboard.`, TEXT.dim];

    if (board[0]) {
      addText(this, cx, portrait ? 768 : 470, board[0], {
        size: 15,
        color: board[1],
        origin: [0.5, 0.5],
        wrap: VIEW_WIDTH - 60,
        align: 'center',
      });
    }

    createButton(
      this,
      cx,
      portrait ? 860 : 512,
      'PLAY AGAIN',
      () => {
        sfx.uiClick();
        startRun();
        this.scene.start('Play');
      },
      {
        width: portrait ? 300 : 280,
        height: 60,
        fontSize: 22,
        fill: PALETTE.accent,
        textColor: '#04121c',
      },
    );

    createButton(
      this,
      cx,
      portrait ? 942 : 582,
      'BACK TO MENU',
      () => {
        sfx.uiClick();
        this.scene.start('Menu');
      },
      { width: portrait ? 300 : 240, height: 50, fontSize: 18, outline: true },
    );

    // Portrait keeps this tucked under the buttons: pinned to the bottom of a
    // 1280-tall box it lands on the brightest part of the backdrop.
    addText(
      this,
      cx,
      portrait ? 1030 : 648,
      'Coins are saved the moment you pick them up — they are already yours.',
      {
        size: 14,
        color: portrait ? TEXT.muted : TEXT.dim,
        origin: [0.5, 0.5],
        wrap: VIEW_WIDTH - 60,
        align: 'center',
      },
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
