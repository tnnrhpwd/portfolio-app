import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import {
  ATTRIBUTE_DEFS,
  ATTRIBUTE_KEYS,
  resetAttributes as resetAttributesCore,
  resetSkills as resetSkillsCore,
  spendAttributePoint,
  spendSkillPoint,
  STAT_CAPS,
  styleSkills,
  type AttributeKey,
  type Fighter,
} from '../core';

/** Combined training + skill screen: allocate attribute points, then skill points. */
export class SkillScene extends BaseScene {
  private fighterIndex = 0;

  constructor() {
    super('Skill');
  }

  create(): void {
    this.fighterIndex = 0;
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

    const roster = this.gameState.roster;
    this.fighterIndex = Math.max(0, Math.min(this.fighterIndex, roster.length - 1));
    const fighter = roster[this.fighterIndex];
    const tip = createTooltip(this);
    const compact = this.compact;

    this.button(this.cx - 130, 98, '◀', () => this.shiftFighter(-1), { width: 44, height: 44, fontSize: 22 });
    this.button(this.cx + 130, 98, '▶', () => this.shiftFighter(1), { width: 44, height: 44, fontSize: 22 });
    addText(this, this.cx, 98, `${fighter.name} — ${fighter.style.toUpperCase()} (${this.fighterIndex + 1}/${roster.length})`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    // ── Attributes ──
    addText(this, this.cx, 130, `Attribute points: ${fighter.attributePoints}`, { fontSize: '18px' });
    const attrStep = compact ? 58 : 48;
    const attrStart = 168;
    ATTRIBUTE_KEYS.forEach((key: AttributeKey, i: number) => {
      const y = attrStart + i * attrStep;
      const labelY = compact ? y - 18 : y;
      const btnY = compact ? y + 18 : y;
      addText(this, compact ? this.cx : this.cx - 220, labelY, `${ATTRIBUTE_DEFS[key].label}: ${fighter.attributes[key]}`, {
        fontSize: '18px',
      }).setOrigin(compact ? 0.5 : 0, 0.5);
      const btn = this.button(compact ? this.cx : this.cx + 200, btnY, '+', () => this.spendAttribute(key), {
        width: 56,
        height: 40,
        fontSize: 20,
        hover: () => tip.show(this.cx, y - 36, ATTRIBUTE_DEFS[key].blurb),
        blur: () => tip.hide(),
      });
      if (fighter.attributePoints <= 0 || fighter.attributes[key] >= STAT_CAPS[key]) {
        btn.setEnabled(false);
      }
    });

    const attrSpent = ATTRIBUTE_KEYS.reduce(
      (acc, key) => acc + (fighter.attributes[key] - fighter.baseAttributes[key]),
      0,
    );
    const attrResetY = attrStart + ATTRIBUTE_KEYS.length * attrStep + 12;
    const attrReset = this.button(this.cx, attrResetY, `RESET ATTRIBUTES (${attrSpent} spent)`, () =>
      this.resetAttributePoints(),
    { width: 250, height: 40, fontSize: 15 });
    if (attrSpent <= 0) attrReset.setEnabled(false);

    // ── Skills ──
    const skillHeaderY = attrResetY + (compact ? 54 : 44);
    addText(this, this.cx, skillHeaderY, `Skill points: ${fighter.skillPoints}`, { fontSize: '18px' });

    const nodes = styleSkills(fighter.style);
    const skillStep = compact ? 54 : 46;
    nodes.forEach((node, i) => {
      const y = skillHeaderY + 32 + i * skillStep;
      const rank = fighter.skills[node.id] ?? 0;
      const mpLabel = node.mpCost > 0 ? `${node.mpCost} MP` : 'passive';
      const label = compact ? `${node.label}  ${rank}/${node.maxRank} · ${mpLabel}` : `${node.label}  ${rank}/${node.maxRank}`;
      addText(this, compact ? this.cx : this.cx - 240, compact ? y - 18 : y, label, {
        fontSize: '17px',
      }).setOrigin(compact ? 0.5 : 0, 0.5);
      if (!compact) {
        addText(this, this.cx + 40, y, mpLabel, {
          fontSize: '14px',
          color: '#b8aa94',
        }).setOrigin(0, 0.5);
      }
      const btn = this.button(compact ? this.cx : this.cx + 220, compact ? y + 18 : y, '+', () => this.spendSkill(node.id), {
        width: 60,
        height: 40,
        fontSize: 20,
        hover: () => tip.show(this.cx, y - 36, node.blurb),
        blur: () => tip.hide(),
      });
      if (fighter.skillPoints <= 0 || rank >= node.maxRank) btn.setEnabled(false);
    });

    const skillSpent = Object.values(fighter.skills).reduce((acc, rank) => acc + rank, 0);
    const skillReset = this.button(
      this.cx,
      skillHeaderY + 32 + nodes.length * skillStep + 12,
      `RESET SKILLS (${skillSpent} spent)`,
      () => this.resetSkillPoints(),
      { width: 250, height: 40, fontSize: 15 },
    );
    if (skillSpent <= 0) skillReset.setEnabled(false);
  }

  private shiftFighter(delta: number): void {
    const n = this.gameState.roster.length;
    if (n <= 1) return;
    this.fighterIndex = (this.fighterIndex + delta + n) % n;
    this.render();
  }

  private replaceFighter(next: Fighter): void {
    const roster = [...this.gameState.roster];
    roster[this.fighterIndex] = next;
    this.gameState = { ...this.gameState, roster };
  }

  private spendAttribute(key: AttributeKey): void {
    try {
      this.replaceFighter(spendAttributePoint(this.gameState.roster[this.fighterIndex], key));
    } catch {
      // no points or at cap — button is disabled anyway
    }
    this.render();
  }

  private resetAttributePoints(): void {
    this.confirm('Reset attributes?', 'Refund all spent attribute points.', () => {
      this.replaceFighter(resetAttributesCore(this.gameState.roster[this.fighterIndex]));
      this.render();
    });
  }

  private spendSkill(skillId: string): void {
    try {
      this.replaceFighter(spendSkillPoint(this.gameState.roster[this.fighterIndex], skillId));
    } catch {
      // no points or maxed — button is disabled anyway
    }
    this.render();
  }

  private resetSkillPoints(): void {
    this.confirm('Reset skills?', 'Refund all spent skill points.', () => {
      this.replaceFighter(resetSkillsCore(this.gameState.roster[this.fighterIndex]));
      this.render();
    });
  }
}
