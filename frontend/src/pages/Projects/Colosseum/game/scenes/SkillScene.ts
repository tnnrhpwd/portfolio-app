import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import { resetSkills, spendSkillPoint, styleSkills } from '../core';

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

    const { width, height } = this.scale;
    const fighter = this.gameState.roster[0];
    const tip = createTooltip(this);

    addText(this, width / 2, 105, `${fighter.name} — ${fighter.style.toUpperCase()} tree`, {
      fontSize: '20px',
      color: '#f2d98c',
    });
    addText(this, width / 2, 135, `Unspent skill points: ${fighter.skillPoints}`, { fontSize: '18px' });

    const nodes = styleSkills(fighter.style);
    nodes.forEach((node, i) => {
      const y = 180 + i * 54;
      const rank = fighter.skills[node.id] ?? 0;
      addText(this, width / 2 - 240, y, `${node.label}  ${rank}/${node.maxRank}`, {
        fontSize: '17px',
      }).setOrigin(0, 0.5);
      addText(this, width / 2 + 40, y, node.mpCost > 0 ? `${node.mpCost} MP` : 'passive', {
        fontSize: '14px',
        color: '#b8aa94',
      }).setOrigin(0, 0.5);
      const btn = this.button(width / 2 + 220, y, '+', () => this.spend(node.id), {
        width: 60,
        height: 44,
        fontSize: 20,
        hover: () => tip.show(width / 2, y - 40, node.blurb),
        blur: () => tip.hide(),
      });
      if (fighter.skillPoints <= 0 || rank >= node.maxRank) btn.setEnabled(false);
    });

    const spent = Object.values(fighter.skills).reduce((acc, rank) => acc + rank, 0);
    const resetBtn = this.button(width / 2, height - 40, `RESET (${spent} spent)`, () => this.reset(), {
      width: 240,
      height: 44,
      fontSize: 17,
    });
    if (spent <= 0) resetBtn.setEnabled(false);
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

  private reset(): void {
    this.confirm('Reset skills?', 'Refund all spent skill points.', () => {
      const next = resetSkills(this.gameState.roster[0]);
      this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
      this.render();
    });
  }
}
