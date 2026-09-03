import { BaseScene } from './BaseScene';
import { addText, createTooltip, type Tooltip } from '../ui/button';
import { addLayeredFighter } from '../assets/textures';
import {
  ATTRIBUTE_DEFS,
  ATTRIBUTE_KEYS,
  currentHp,
  getSkill,
  resetAttributes as resetAttributesCore,
  resetSkills as resetSkillsCore,
  spendAttributePoint,
  spendSkillPoint,
  STAT_CAPS,
  STYLES,
  STYLE_TREES,
  styleSkills,
  totalHp,
  xpToNext,
  type AttributeKey,
  type Fighter,
  type SkillNode,
  type StyleKey,
} from '../core';

/** Display order for the five class columns (matches the reference screen). */
const COLUMN_ORDER: StyleKey[] = ['retiarius', 'thraex', 'provocator', 'murmillo', 'dimachaerus'];

/** Pointy-top hexagon vertices for a skill node of radius `r`. */
function hexPoints(r: number): { x: number; y: number }[] {
  return [
    { x: 0, y: -r },
    { x: r * 0.87, y: -r * 0.5 },
    { x: r * 0.87, y: r * 0.5 },
    { x: 0, y: r },
    { x: -r * 0.87, y: r * 0.5 },
    { x: -r * 0.87, y: -r * 0.5 },
  ];
}

/** Training + skill tree: allocate attributes on the left, unlock techniques in the five class trees on the right. */
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
    this.menuBackground();
    this.header('SKILLS');

    const roster = this.gameState.roster;
    this.fighterIndex = Math.max(0, Math.min(this.fighterIndex, roster.length - 1));
    const fighter = roster[this.fighterIndex];
    if (!fighter) return;

    if (this.compact) {
      this.renderCompact(fighter);
      return;
    }

    const leftX = this.w * 0.26;
    const rightX = this.w * 0.72;
    const tip = createTooltip(this);
    this.renderAttributePanel(fighter, leftX, tip);
    this.renderSkillTree(fighter, rightX, tip);
  }

  // ── Left column: nameplate, fighter sprite, attributes, and the info card ──
  private renderAttributePanel(f: Fighter, x: number, tip: Tooltip): void {
    this.add.rectangle(x, 84, 300, 40, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, 84, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 190, 84, '◀', () => this.shiftFighter(-1), { width: 44, height: 44, fontSize: 22 });
    this.button(x + 190, 84, '▶', () => this.shiftFighter(1), { width: 44, height: 44, fontSize: 22 });

    addLayeredFighter(this, x, 216, f, 1.2);
    this.add.ellipse(x, 332, 110, 20, 0x000000, 0.35);

    addText(this, x, 374, `Attribute points: ${f.attributePoints}`, { fontSize: '15px', color: '#f2d98c' });

    ATTRIBUTE_KEYS.forEach((key: AttributeKey, i: number) => {
      const y = 408 + i * 32;
      addText(this, x - 110, y, `${ATTRIBUTE_DEFS[key].label}: ${f.attributes[key]}`, {
        fontSize: '15px',
      }).setOrigin(0, 0.5);
      const btn = this.button(x + 100, y, '+', () => this.spendAttribute(key), {
        width: 44,
        height: 28,
        fontSize: 16,
        hover: () => tip.show(x, y - 24, ATTRIBUTE_DEFS[key].blurb),
        blur: () => tip.hide(),
      });
      if (f.attributePoints <= 0 || f.attributes[key] >= STAT_CAPS[key]) btn.setEnabled(false);
    });

    const attrSpent = ATTRIBUTE_KEYS.reduce((acc, key) => acc + (f.attributes[key] - f.baseAttributes[key]), 0);
    const resetBtn = this.button(x, 602, 'RESET', () => this.resetAttributePoints(), { width: 180, height: 40, fontSize: 15 });
    if (attrSpent <= 0) resetBtn.setEnabled(false);

    const infoY = 660;
    this.add.rectangle(x, infoY, 360, 72, 0x000000, 0.3).setStrokeStyle(1, 0x6a6258);
    addText(this, x, infoY - 20, `${f.name} · ${f.style.toUpperCase()}`, { fontSize: '14px', color: '#e8b84b', fontStyle: 'bold' });
    addText(this, x, infoY + 2, `Lv ${f.level} · HP ${currentHp(f)}/${totalHp(f)} · MP ${f.morale}/${f.maxMorale}`, {
      fontSize: '12px',
      color: '#e8dcc8',
    });
    addText(this, x, infoY + 22, `EXP ${f.xp}/${xpToNext(f.level)} · MP LVL ${f.maxMorale} · Gold ${this.gameState.gold}`, {
      fontSize: '12px',
      color: '#b8aa94',
    });
  }

  // ── Right column: the five weapon-class skill trees ──
  private renderSkillTree(f: Fighter, x: number, tip: Tooltip): void {
    const cols = COLUMN_ORDER.length;
    const gapX = 130;

    COLUMN_ORDER.forEach((style, ci) => {
      const colX = x - ((cols - 1) * gapX) / 2 + ci * gapX;
      const isOwn = style === f.style;
      addText(this, colX, 74, STYLES[style].label.toUpperCase(), {
        fontSize: '12px',
        color: isOwn ? '#e8b84b' : '#6a6258',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: 120 },
      });

      STYLE_TREES[style].forEach((id, ri) => {
        const y = 116 + ri * 58;
        const node = getSkill(id);
        if (!node) return;
        const rank = f.skills[id] ?? 0;
        this.drawNode(colX, y, node, rank, isOwn, f, tip);
      });
    });

    const skillSpent = Object.values(f.skills).reduce((acc, rank) => acc + rank, 0);
    addText(this, x, 606, `REMAINING POINTS: ${f.skillPoints}`, { fontSize: '18px', color: '#f2d98c' });
    const skillReset = this.button(x, 638, `RESET SKILLS (${skillSpent} spent)`, () => this.resetSkillPoints(), {
      width: 200,
      height: 34,
      fontSize: 13,
    });
    if (skillSpent <= 0) skillReset.setEnabled(false);

    this.button(x - 70, 686, 'INV', () => this.scene.start('Inventory'), { width: 120, height: 44, fontSize: 16 });
    this.button(x + 70, 686, 'BACK', () => this.scene.start('Main'), { width: 120, height: 44, fontSize: 16 });
  }

  private drawNode(
    x: number,
    y: number,
    node: SkillNode,
    rank: number,
    isOwn: boolean,
    f: Fighter,
    tip: Tooltip,
  ): void {
    const r = 20;
    const canSpend = isOwn && f.skillPoints > 0 && rank < node.maxRank;
    const fill = isOwn ? 0x8c1f28 : 0x2a241d;
    const stroke = isOwn ? 0xe8b84b : 0x6a6258;

    const hex = this.add.polygon(x, y, hexPoints(r), fill, 1).setStrokeStyle(2, stroke);
    if (isOwn) {
      hex.setInteractive({ useHandCursor: canSpend });
      hex.on('pointerover', () => {
        hex.setFillStyle(canSpend ? 0xa52a34 : 0x8c1f28);
        tip.show(x, y - 44, this.nodeTooltip(node, rank));
      });
      hex.on('pointerout', () => {
        hex.setFillStyle(fill);
        tip.hide();
      });
      if (canSpend) hex.on('pointerdown', () => this.spendSkill(node.id));
    }

    addText(this, x, y + r + 12, `${rank}/${node.maxRank}`, {
      fontSize: '11px',
      color: isOwn ? '#f2d98c' : '#6a6258',
    });
  }

  private nodeTooltip(node: SkillNode, rank: number): string {
    const cost = node.mpCost > 0 ? `${node.mpCost} MP` : 'Passive';
    return `${node.label} — ${rank}/${node.maxRank}\n${cost}\n${node.blurb}`;
  }

  // ── Compact (portrait) fallback ──
  private renderCompact(f: Fighter): void {
    const x = this.cx;
    addText(this, x, 76, `${f.name} — ${f.style.toUpperCase()}`, { fontSize: '18px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 70, 76, '◀', () => this.shiftFighter(-1), { width: 40, height: 40, fontSize: 20 });
    this.button(x + 70, 76, '▶', () => this.shiftFighter(1), { width: 40, height: 40, fontSize: 20 });

    let y = 120;
    addText(this, x, y, `Attribute points: ${f.attributePoints}`, { fontSize: '14px', color: '#f2d98c' });
    y += 26;
    ATTRIBUTE_KEYS.forEach((key) => {
      const btn = this.button(x, y, `${ATTRIBUTE_DEFS[key].label}: ${f.attributes[key]}  +`, () => this.spendAttribute(key), {
        width: 260,
        height: 30,
        fontSize: 12,
      });
      if (f.attributePoints <= 0 || f.attributes[key] >= STAT_CAPS[key]) btn.setEnabled(false);
      y += 34;
    });
    this.button(x, y, 'RESET ATTRIBUTES', () => this.resetAttributePoints(), { width: 200, height: 32, fontSize: 13 });
    y += 40;

    addText(this, x, y, `Skill points: ${f.skillPoints}`, { fontSize: '14px', color: '#f2d98c' });
    y += 26;
    styleSkills(f.style).forEach((node) => {
      const rank = f.skills[node.id] ?? 0;
      const btn = this.button(x, y, `${node.label} ${rank}/${node.maxRank}  +`, () => this.spendSkill(node.id), {
        width: 260,
        height: 30,
        fontSize: 12,
      });
      if (f.skillPoints <= 0 || rank >= node.maxRank) btn.setEnabled(false);
      y += 34;
    });
    this.button(x, y, 'RESET SKILLS', () => this.resetSkillPoints(), { width: 200, height: 32, fontSize: 13 });

    this.button(x - 70, this.h - 40, 'INV', () => this.scene.start('Inventory'), { width: 120, height: 40, fontSize: 15 });
    this.button(x + 70, this.h - 40, 'BACK', () => this.scene.start('Main'), { width: 120, height: 40, fontSize: 15 });
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
