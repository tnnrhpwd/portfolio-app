import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { ACHIEVEMENTS } from '../core';

export class AchievementsScene extends BaseScene {
  constructor() {
    super('Achievements');
  }

  create(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.header('TROPHIES');
    this.backButton('Main');

    // The tall box stacks each trophy: name centred, blurb on its own line
    // beneath it. Two columns are impossible here — 720px cannot hold a name
    // and a blurb side by side without them colliding.
    const portrait = this.portrait;
    const unlocked = this.gameState.unlockedAchievements;
    const step = portrait ? 108 : 72;
    const top = portrait ? 230 : 140;
    ACHIEVEMENTS.forEach((achievement, i) => {
      const y = top + i * step;
      const done = unlocked.includes(achievement.id);
      addText(
        this,
        portrait ? this.cx : this.cx - 220,
        portrait ? y - 20 : y,
        `${done ? '✔' : '—'} ${achievement.label}`,
        { fontSize: portrait ? '22px' : '20px', color: done ? '#f2d98c' : '#6a6258' },
      ).setOrigin(portrait ? 0.5 : 0, 0.5);
      addText(this, portrait ? this.cx : this.cx + 140, portrait ? y + 24 : y, achievement.blurb, {
        fontSize: '15px',
        color: done ? '#b8aa94' : '#55504a',
        wordWrap: { width: portrait ? this.w - 80 : this.w - 60 },
        align: portrait ? 'center' : 'left',
      }).setOrigin(portrait ? 0.5 : 0, 0.5);
    });
    addText(this, this.cx, this.h - 30, `${unlocked.length}/${ACHIEVEMENTS.length} unlocked`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
  }
}
