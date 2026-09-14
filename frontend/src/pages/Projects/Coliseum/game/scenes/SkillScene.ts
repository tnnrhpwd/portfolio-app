import { BaseScene } from './BaseScene';
import { addText, createTooltip, type Tooltip } from '../ui/button';
import { addLayeredFighter } from '../assets/textures';
import {
  ATTRIBUTE_DEFS,
  ATTRIBUTE_KEYS,
  currentHp,
  getSkill,
  isSkillUnlocked,
  resetAttributes as resetAttributesCore,
  resetSkills as resetSkillsCore,
  SKILL_TREES,
  skillUnlockRemaining,
  spendAttributePoint,
  spendSkillPoint,
  STAT_CAPS,
  totalHp,
  xpToNext,
  type AttributeKey,
  type Fighter,
  type SkillNode,
} from '../core';

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

/** Training + skill tree: allocate attributes on the left, unlock techniques from the shared skill list on the right. */
export class SkillScene extends BaseScene {
  private fighterIndex = 0;
  /** Which skill-tree column the tall box is showing (it shows one at a time). */
  private skillColumn = 0;

  constructor() {
    super('Skill');
  }

  create(): void {
    this.fighterIndex = 0;
    this.skillColumn = 0;
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

    if (this.portrait) {
      this.renderPortrait(fighter);
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
    addText(this, x, infoY - 20, f.name, { fontSize: '14px', color: '#e8b84b', fontStyle: 'bold' });
    addText(this, x, infoY + 2, `Lv ${f.level} · HP ${currentHp(f)}/${totalHp(f)} · MP ${f.morale}/${f.maxMorale}`, {
      fontSize: '12px',
      color: '#e8dcc8',
    });
    addText(this, x, infoY + 22, `EXP ${f.xp}/${xpToNext(f.level)} · MP LVL ${f.maxMorale} · Gold ${this.gameState.gold}`, {
      fontSize: '12px',
      color: '#b8aa94',
    });
  }

  // ── Right column: five weapon-class skill trees, each unlocked bottom → top ──
  private renderSkillTree(f: Fighter, x: number, tip: Tooltip): void {
    const gap = 92;
    const startX = x - ((SKILL_TREES.length - 1) * gap) / 2;
    SKILL_TREES.forEach((col, ci) => {
      const colX = startX + ci * gap;
      addText(this, colX, 84, col.label, {
        fontSize: '13px',
        color: '#e8b84b',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: 92 },
      });
      col.skills.forEach((skillId, ri) => {
        const node = getSkill(skillId);
        if (!node) return;
        const rank = f.skills[skillId] ?? 0;
        this.drawNode(colX, 134 + ri * 64, node, rank, f, tip);
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
    f: Fighter,
    tip: Tooltip,
  ): void {
    const r = 20;
    const locked = !isSkillUnlocked(f, node.id);
    const maxed = rank >= node.maxRank;
    const canSpend = f.skillPoints > 0 && !maxed && !locked;
    const fill = locked ? 0x2b2623 : 0x8c1f28;
    const stroke = locked ? 0x6a6258 : 0xe8b84b;

    const hex = this.add.polygon(x, y, hexPoints(r), fill, 1).setStrokeStyle(2, stroke);
    hex.setInteractive({ useHandCursor: canSpend });
    hex.on('pointerover', () => {
      hex.setFillStyle(canSpend ? 0xa52a34 : fill);
      tip.show(x, y - 44, this.nodeTooltip(node, rank, locked, skillUnlockRemaining(f, node.id)));
    });
    hex.on('pointerout', () => {
      hex.setFillStyle(fill);
      tip.hide();
    });
    if (canSpend) hex.on('pointerdown', () => this.spendSkill(node.id));

    const sub = locked ? `LOCK ${skillUnlockRemaining(f, node.id)}` : `${rank}/${node.maxRank}`;
    addText(this, x, y + r + 12, sub, {
      fontSize: '11px',
      color: locked ? '#8b8277' : '#f2d98c',
    });
  }

  private nodeTooltip(node: SkillNode, rank: number, locked: boolean, remaining: number): string {
    if (locked) {
      return `${node.label}\nLocked — ${remaining} more pts in this column\n${node.blurb}`;
    }
    const cost = node.mpCost > 0 ? `${node.mpCost} MP` : 'Passive';
    return `${node.label} — ${rank}/${node.maxRank}\n${cost}\n${node.blurb}`;
  }

  // ── Portrait: attributes, then ONE skill column at a time. All 29 nodes plus
  // six attribute rows is ~1500px of content, which cannot fit a 1280px box, so
  // the tall box pages between columns instead of scrolling.
  private renderPortrait(f: Fighter): void {
    const x = this.cx;
    this.backButton('Main');

    addText(this, x, 96, f.name, { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 150, 96, '◀', () => this.shiftFighter(-1), { width: 48, height: 48, fontSize: 20 });
    this.button(x + 150, 96, '▶', () => this.shiftFighter(1), { width: 48, height: 48, fontSize: 20 });

    addText(this, x, 152, `Attribute points: ${f.attributePoints}`, { fontSize: '16px', color: '#f2d98c' });
    let y = 190;
    ATTRIBUTE_KEYS.forEach((key) => {
      const btn = this.button(x, y, `${ATTRIBUTE_DEFS[key].label}: ${f.attributes[key]}  +`, () => this.spendAttribute(key), {
        width: 320,
        height: 46,
        fontSize: 15,
      });
      if (f.attributePoints <= 0 || f.attributes[key] >= STAT_CAPS[key]) btn.setEnabled(false);
      y += 54;
    });
    this.button(x, y + 10, 'RESET ATTRIBUTES', () => this.resetAttributePoints(), { width: 260, height: 46, fontSize: 14 });

    // ── Skill tree: one column, chosen with the arrows ──
    const colTop = y + 84;
    addText(this, x, colTop - 34, `Skill points: ${f.skillPoints}`, { fontSize: '16px', color: '#f2d98c' });
    this.skillColumn = Math.max(0, Math.min(this.skillColumn, SKILL_TREES.length - 1));
    const column = SKILL_TREES[this.skillColumn];
    this.button(x - 170, colTop, '◀', () => this.shiftColumn(-1), { width: 48, height: 44, fontSize: 18 });
    addText(this, x, colTop, `${column.label}  ${this.skillColumn + 1}/${SKILL_TREES.length}`, {
      fontSize: '16px',
      color: '#e8b84b',
      fontStyle: 'bold',
    });
    this.button(x + 170, colTop, '▶', () => this.shiftColumn(1), { width: 48, height: 44, fontSize: 18 });

    let sy = colTop + 50;
    column.skills.forEach((skillId) => {
      const node = getSkill(skillId);
      if (!node) return;
      const rank = f.skills[skillId] ?? 0;
      const locked = !isSkillUnlocked(f, skillId);
      const label = locked
        ? `${node.label} (LOCK ${skillUnlockRemaining(f, skillId)})`
        : `${node.label} ${rank}/${node.maxRank}  +`;
      const btn = this.button(x, sy, label, () => this.spendSkill(skillId), {
        width: 380,
        height: 50,
        fontSize: 15,
      });
      if (f.skillPoints <= 0 || rank >= node.maxRank || locked) btn.setEnabled(false);
      sy += 58;
    });

    this.button(x, this.h - 130, 'RESET SKILLS', () => this.resetSkillPoints(), { width: 260, height: 46, fontSize: 14 });
    this.button(x - 100, this.h - 56, 'INV', () => this.scene.start('Inventory'), { width: 170, height: 52, fontSize: 15 });
    this.button(x + 100, this.h - 56, 'BACK', () => this.scene.start('Main'), { width: 170, height: 52, fontSize: 15 });
  }

  private shiftColumn(delta: number): void {
    const n = SKILL_TREES.length;
    this.skillColumn = (this.skillColumn + delta + n) % n;
    this.render();
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
