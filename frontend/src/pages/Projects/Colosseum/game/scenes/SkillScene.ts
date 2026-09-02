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

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.header('SKILLS');
    this.backButton('Main');

    const fighter = this.gameState.roster[0];
    const tip = createTooltip(this);
    const compact = this.compact;

    addText(this, this.cx, 105, `${fighter.name} — ${fighter.style.toUpperCase()} tree`, {
      fontSize: '20px',
      color: '#f2d98c',
    });
    addText(this, this.cx, 135, `Unspent skill points: ${fighter.skillPoints}`, { fontSize: '18px' });

    const nodes = styleSkills(fighter.style);
    nodes.forEach((node, i) => {
      const y = 180 + i * (compact ? 64 : 54);
      const rank = fighter.skills[node.id] ?? 0;
      const mpLabel = node.mpCost > 0 ? `${node.mpCost} MP` : 'passive';
      const label = compact ? `${node.label}  ${rank}/${node.maxRank} · ${mpLabel}` : `${node.label}  ${rank}/${node.maxRank}`;
      addText(this, compact ? this.cx : this.cx - 240, compact ? y - 20 : y, label, {
        fontSize: '17px',
      }).setOrigin(compact ? 0.5 : 0, 0.5);
      if (!compact) {
        addText(this, this.cx + 40, y, mpLabel, {
          fontSize: '14px',
          color: '#b8aa94',
        }).setOrigin(0, 0.5);
      }
      const btn = this.button(compact ? this.cx : this.cx + 220, compact ? y + 22 : y, '+', () => this.spend(node.id), {
        width: 60,
        height: 44,
        fontSize: 20,
        hover: () => tip.show(this.cx, y - 40, node.blurb),
        blur: () => tip.hide(),
      });
      if (fighter.skillPoints <= 0 || rank >= node.maxRank) btn.setEnabled(false);
    });

    const spent = Object.values(fighter.skills).reduce((acc, rank) => acc + rank, 0);
    const resetBtn = this.button(this.cx, this.h - 40, `RESET (${spent} spent)`, () => this.reset(), {
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
