import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { currentHp, totalHp } from '../core';

/** The school roster: rename the school or any gladiator, and review condition. */
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

    // ── Team name (school tag) ──
    const teamY = compact ? 108 : 100;
    addText(this, this.cx, teamY, `Team: ${this.gameState.teamName}`, {
      fontSize: compact ? '18px' : '22px',
      color: '#e8b84b',
      fontStyle: 'bold',
      wordWrap: { width: this.w - 40 },
    });
    this.button(this.cx, teamY + (compact ? 42 : 40), 'RENAME TEAM', () => this.renameTeam(), {
      width: 180,
      height: 40,
      fontSize: 15,
    });

    const rosterTop = compact ? 226 : 190;
    addText(this, this.cx, rosterTop, `Roster: ${this.gameState.roster.length}/12`, {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.gameState.roster.forEach((fighter, i) => {
      const y = rosterTop + 30 + i * (compact ? 78 : 56);
      const lead = i === 0;
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 16 : y,
        `${lead ? '★ ' : ''}${fighter.name} — Lv ${fighter.level} ${fighter.style.toUpperCase()}`,
        { fontSize: '20px', color: lead ? '#f2d98c' : undefined },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      addText(
        this,
        compact ? this.cx : this.cx + 110,
        compact ? y + 18 : y,
        `HP ${currentHp(fighter)}/${totalHp(fighter)} · MP ${fighter.morale}/${fighter.maxMorale}`,
        { fontSize: '15px', color: '#b8aa94' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      this.button(compact ? this.cx : this.cx + 300, compact ? y + 40 : y, 'RENAME', () => this.renameFighter(i), {
        width: compact ? 120 : 110,
        height: 34,
        fontSize: 13,
      });
    });

    addText(this, this.cx, this.h - 30, 'The first gladiator (★) leads the school. Rename anyone, or the school, above.', {
      fontSize: '14px',
      color: '#6a6258',
    });
  }

  private renameTeam(): void {
    this.promptText('Rename your school', this.gameState.teamName, (value) => {
      if (value) {
        this.gameState = { ...this.gameState, teamName: value };
        this.render();
      }
    });
  }

  private renameFighter(index: number): void {
    const fighter = this.gameState.roster[index];
    this.promptText(`Rename ${fighter.name}`, fighter.name, (value) => {
      if (value) {
        const roster = [...this.gameState.roster];
        roster[index] = { ...fighter, name: value };
        this.gameState = { ...this.gameState, roster };
        this.render();
      }
    });
  }
}
