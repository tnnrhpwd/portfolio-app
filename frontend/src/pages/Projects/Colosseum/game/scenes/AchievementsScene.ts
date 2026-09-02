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

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.header('TROPHIES');
    this.backButton('Main');

    const compact = this.compact;
    const unlocked = this.gameState.unlockedAchievements;
    ACHIEVEMENTS.forEach((achievement, i) => {
      const y = 140 + i * (compact ? 92 : 72);
      const done = unlocked.includes(achievement.id);
      addText(
        this,
        compact ? this.cx : this.cx - 220,
        compact ? y - 20 : y,
        `${done ? '✔' : '—'} ${achievement.label}`,
        { fontSize: '20px', color: done ? '#f2d98c' : '#6a6258' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      addText(this, compact ? this.cx : this.cx + 140, compact ? y + 22 : y, achievement.blurb, {
        fontSize: '15px',
        color: done ? '#b8aa94' : '#55504a',
        wordWrap: { width: this.w - 60 },
      }).setOrigin(compact ? 0.5 : 0, 0.5);
    });
    addText(this, this.cx, this.h - 30, `${unlocked.length}/${ACHIEVEMENTS.length} unlocked`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
  }
}
