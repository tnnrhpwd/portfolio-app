import { BaseScene } from './BaseScene';
import { addText } from '../ui/button';
import { spendSkillPoint, styleSkills } from '../core';

export class SkillScene extends BaseScene {
  constructor() {
    super('Skill');
  }

  create(): void {
    this.render();
  }

  private render(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('SKILLS');
    this.backButton('Main');

    const { width } = this.scale;
    const fighter = this.gameState.roster[0];
    addText(this, width / 2, 105, `${fighter.name} — ${fighter.style.toUpperCase()} tree`, {
      fontSize: '20px',
      color: '#f2d98c',
    });
    addText(this, width / 2, 135, `Unspent skill points: ${fighter.skillPoints}`, { fontSize: '18px' });

    const nodes = styleSkills(fighter.style);
    nodes.forEach((node, i) => {
      const y = 180 + i * 58;
      const rank = fighter.skills[node.id] ?? 0;
      addText(this, width / 2 - 240, y, `${node.label}  ${rank}/${node.maxRank}`, {
        fontSize: '17px',
      }).setOrigin(0, 0.5);
      addText(this, width / 2 + 60, y, node.mpCost > 0 ? `${node.mpCost} MP` : 'passive', {
        fontSize: '14px',
        color: '#b8aa94',
      }).setOrigin(0, 0.5);
      const btn = this.button(width / 2 + 220, y, '+', () => this.spend(node.id), {
        width: 60,
        height: 44,
        fontSize: 20,
      });
      if (fighter.skillPoints <= 0 || rank >= node.maxRank) btn.setEnabled(false);
    });
  }

  private spend(skillId: string): void {
    try {
      const next = spendSkillPoint(this.gameState.roster[0], skillId);
      this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    } catch {
      // no points or maxed — button is disabled anyway
    }
    this.render();
  }
}
