import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { currentHp, totalHp } from '../core';

/** The school roster: every gladiator in the ludus and their condition. */
export class TeamScene extends BaseScene {
  constructor() {
    super('Team');
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
    this.header('TEAM');
    this.backButton('Main');

    const compact = this.compact;
    addText(this, this.cx, 100, `Roster: ${this.gameState.roster.length}/12`, {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.gameState.roster.forEach((fighter, i) => {
      const y = 150 + i * (compact ? 88 : 66);
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 22 : y,
        `${i === 0 ? '★ ' : ''}${fighter.name} — Lv ${fighter.level} ${fighter.style.toUpperCase()}`,
        { fontSize: '20px', color: i === 0 ? '#f2d98c' : undefined },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      addText(
        this,
        compact ? this.cx : this.cx + 120,
        compact ? y + 24 : y,
        `HP ${currentHp(fighter)}/${totalHp(fighter)} · MP ${fighter.morale}/${fighter.maxMorale}`,
        { fontSize: '15px', color: '#b8aa94' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
    });

    addText(this, this.cx, this.h - 30, 'The first gladiator (★) leads the school.', {
      fontSize: '14px',
      color: '#6a6258',
    });
  }
}
