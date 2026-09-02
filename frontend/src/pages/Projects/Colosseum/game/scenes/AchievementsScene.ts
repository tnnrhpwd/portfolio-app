import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { ACHIEVEMENTS } from '../core';

export class AchievementsScene extends BaseScene {
  constructor() {
    super('Achievements');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('TROPHIES');
    this.backButton('Main');

    const { width } = this.scale;
    const unlocked = this.gameState.unlockedAchievements;
    ACHIEVEMENTS.forEach((achievement, i) => {
      const y = 140 + i * 72;
      const done = unlocked.includes(achievement.id);
      addText(this, width / 2 - 220, y, `${done ? '✔' : '—'} ${achievement.label}`, {
        fontSize: '20px',
        color: done ? '#f2d98c' : '#6a6258',
      }).setOrigin(0, 0.5);
      addText(this, width / 2 + 140, y, achievement.blurb, {
        fontSize: '15px',
        color: done ? '#b8aa94' : '#55504a',
      }).setOrigin(0, 0.5);
    });
    addText(this, width / 2, 600, `${unlocked.length}/${ACHIEVEMENTS.length} unlocked`, {
      fontSize: '16px',
      color: '#b8aa94',
    });
  }
}
