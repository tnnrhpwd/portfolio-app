import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { addText, createTooltip, type Tooltip } from '../ui/button';
import { EquipTargets } from '../ui/equipTargets';
import { addEquipmentIcon, addLayeredFighter, addMannequinFrame } from '../assets/textures';
import {
  currentHp,
  displacedByEquip,
  effectiveAttributes,
  equipItem,
  totalHp,
  unequipAll,
  unequipItem,
  xpToNext,
  type Equipment,
  type EquipmentSlot,
  type Fighter,
} from '../core';

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Inventory grid dimensions. */
const COLS = 6;
const ROWS = 4;
const CELL = 72;
const GAP = 8;
const MAX_VISIBLE = COLS * ROWS;

/**
 * The inventory / character sheet, laid out like the reference: a fighter
 * (with a mannequin equip target) on the left, the stored-item grid on the
 * right, and stats + gold + SKILL/DONE along the bottom. Items are dragged
 * from the grid onto the fighter to equip them.
 */
export class InventoryScene extends BaseScene {
  private fighterIndex = 0;
  private inventoryPage = 0;
  private mannequinBounds: Bounds | null = null;
  private inventoryBounds: Bounds | null = null;
  private equipTargets: EquipTargets | null = null;
  private dragging = false;

  constructor() {
    super('Inventory');
  }

  create(): void {
    this.fighterIndex = 0;
    this.inventoryPage = 0;
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.backButton('Main');
    this.mannequinBounds = null;
    this.inventoryBounds = null;
    this.equipTargets = null;

    const roster = this.gameState.roster;
    this.fighterIndex = Math.max(0, Math.min(this.fighterIndex, roster.length - 1));
    const fighter = roster[this.fighterIndex];
    if (!fighter) return;

    if (this.compact) {
      this.renderCompact(fighter);
      return;
    }

    const leftX = this.w * 0.3;
    const rightX = this.w * 0.7;
    const tip = createTooltip(this);
    this.renderFighterPanel(fighter, leftX);
    this.renderInventoryPanel(rightX, tip);
  }

  // ── Left column: fighter, arrows, mannequin equip target, and stats ──
  private renderFighterPanel(f: Fighter, x: number): void {
    const scale = 1.3;
    const bodyY = 300;
    const feetY = bodyY + 90 * scale + 8;

    // Nameplate.
    this.add.rectangle(x, 96, 340, 40, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, 96, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });

    // Fighter selector arrows.
    this.button(x - 230, bodyY, '◀', () => this.shiftFighter(-1), { width: 44, height: 76, fontSize: 26 });
    this.button(x + 230, bodyY, '▶', () => this.shiftFighter(1), { width: 44, height: 76, fontSize: 26 });

    // Active fighter sprite on a pedestal.
    addLayeredFighter(this, x - 110, bodyY, f, scale);
    this.add.ellipse(x - 110, feetY, 110, 22, 0x000000, 0.35);

    // Mannequin: a wireframe figure with eight always-visible drop slots.
    addMannequinFrame(this, x + 110, bodyY, scale);
    this.add.ellipse(x + 110, feetY, 110, 22, 0x000000, 0.25);
    const manW = 120 * scale + 26;
    const manH = 180 * scale + 18;
    const hitArea = this.add
      .rectangle(x + 110, bodyY, manW, manH, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hitArea.on('pointerover', () => {
      if (!this.dragging) this.equipTargets?.setHover(true);
    });
    hitArea.on('pointerout', () => {
      if (!this.dragging) this.equipTargets?.setHover(false);
    });
    this.button(x + 110, bodyY - manH / 2 - 16, 'UNEQUIP ALL', () => this.unequipAllGear(), {
      width: 118,
      height: 26,
      fontSize: 11,
    });
    this.mannequinBounds = {
      x0: x + 110 - manW / 2,
      y0: bodyY - manH / 2,
      x1: x + 110 + manW / 2,
      y1: bodyY + manH / 2,
    };
    this.equipTargets = new EquipTargets(this, { cx: x + 110, cy: bodyY, w: 120 * scale, h: 180 * scale });
    this.equipTargets.setDragCallbacks({
      onDragStart: () => {
        this.dragging = true;
      },
      onDragEnd: (slot, px, py) => {
        this.dragging = false;
        if (this.pointIn(this.inventoryBounds, px, py)) this.unequipToInventory(slot);
        this.render();
      },
    });
    this.equipTargets.drawSlots(f.loadout);

    this.renderStats(f, x);
  }

  private renderStats(f: Fighter, x: number): void {
    const attrs = effectiveAttributes(f);
    const main = f.loadout.mainHand;
    const off = f.loadout.offHand;
    const weapon = main ?? (off && off.minDamage !== undefined ? off : null);
    const dmgMin = (weapon?.minDamage ?? 5) + attrs.strength;
    const dmgMax = (weapon?.maxDamage ?? 10) + attrs.strength;
    const armor = Object.values(f.loadout).reduce((acc, item) => acc + (item?.armor ?? 0), 0);

    const left = [
      `LEVEL: ${f.level}`,
      `EXP: ${f.xp}/${xpToNext(f.level)}`,
      `FAME: ${this.gameState.fame}`,
      `CHARISMA: ${attrs.charisma}`,
      `STRENGTH: ${attrs.strength}`,
      `DEXTERITY: ${attrs.dexterity}`,
      `DEFENSE: ${attrs.defense}`,
      `SPEED: ${attrs.speed}`,
      `VITALITY: ${attrs.vitality}`,
    ].join('\n');
    const right = [
      `DAMAGE: ${dmgMin}-${dmgMax}`,
      `ARMOR: ${armor}`,
      `HP: ${currentHp(f)}/${totalHp(f)}`,
      `MP: ${f.maxMorale}`,
    ].join('\n');

    const y = 500;
    this.add.rectangle(x, y + 82, 380, 180, 0x000000, 0.28).setStrokeStyle(1, 0x6a6258);
    addText(this, x - 120, y, left, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
    addText(this, x + 60, y, right, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
  }

  // ── Right column: item grid, gold, and SKILL / DONE ──
  private renderInventoryPanel(x: number, tip: Tooltip): void {
    addText(this, x, 76, 'INVENTORY', { fontSize: '24px', color: '#e8b84b', fontStyle: 'bold' });

    const gridW = COLS * CELL + (COLS - 1) * GAP;
    const x0 = x - gridW / 2 + CELL / 2;
    const y0 = 110;
    const totalPages = Math.max(1, Math.ceil(this.gameState.inventory.length / MAX_VISIBLE));
    this.inventoryPage = Math.min(this.inventoryPage, totalPages - 1);
    const items = this.gameState.inventory.slice(
      this.inventoryPage * MAX_VISIBLE,
      this.inventoryPage * MAX_VISIBLE + MAX_VISIBLE,
    );
    this.inventoryBounds = {
      x0: x - gridW / 2,
      y0: y0 - CELL / 2,
      x1: x + gridW / 2,
      y1: y0 + ROWS * (CELL + GAP) - GAP,
    };

    for (let i = 0; i < MAX_VISIBLE; i += 1) {
      const item = items[i] ?? null;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = x0 + col * (CELL + GAP);
      const cy = y0 + row * (CELL + GAP);
      if (item) this.addInventoryCell(item, cx, cy, CELL, tip);
      else this.addEmptyCell(cx, cy, CELL);
    }

    // Inventory pager.
    const pageY = y0 + ROWS * (CELL + GAP) + 16;
    const prevBtn = this.button(x - 80, pageY, '\u25C0', () => this.changeInventoryPage(-1), { width: 44, height: 36, fontSize: 18 });
    addText(this, x, pageY, `PAGE ${this.inventoryPage + 1}/${totalPages}`, { fontSize: '14px', color: '#f2d98c' });
    const nextBtn = this.button(x + 80, pageY, '\u25B6', () => this.changeInventoryPage(1), { width: 44, height: 36, fontSize: 18 });
    if (this.inventoryPage <= 0) prevBtn.setEnabled(false);
    if (this.inventoryPage >= totalPages - 1) nextBtn.setEnabled(false);

    addText(this, x, 596, `Gold: ${this.gameState.gold}`, { fontSize: '20px', color: '#f2d98c' });
    this.button(x - 70, 652, 'SKILL', () => this.scene.start('Skill'), { width: 120, height: 44, fontSize: 16 });
    this.button(x + 70, 652, 'DONE', () => this.scene.start('Main'), { width: 120, height: 44, fontSize: 16 });
  }

  // ── Draggable item cells ──
  private makeCell(item: Equipment, x: number, y: number, size: number): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(0, 0, size, size, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    const objs: Phaser.GameObjects.GameObject[] = [rect];
    const icon = addEquipmentIcon(this, 0, -size * 0.18, item, size * 0.42);
    if (icon) objs.push(icon);
    const label = this.add
      .text(0, size * 0.16, item.name, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '10px',
        color: '#f2d98c',
        wordWrap: { width: size - 10 },
        align: 'center',
      })
      .setOrigin(0.5);
    objs.push(label);
    const container = this.add.container(x, y, objs);
    container.setSize(size, size);
    container.setInteractive({ draggable: true, useHandCursor: true });
    this.input.setDraggable(container);
    container.on('dragstart', () => {
      container.setDepth(950);
      container.setScale(1.06);
      this.dragging = true;
      this.equipTargets?.highlight(item);
    });
    container.on('drag', (pointer: Phaser.Input.Pointer) => {
      container.setPosition(pointer.x, pointer.y);
      if (this.pointIn(this.mannequinBounds, pointer.x, pointer.y)) this.equipTargets?.setHover(true);
      else this.equipTargets?.setHover(false);
    });
    return container;
  }

  private addInventoryCell(item: Equipment, x: number, y: number, size: number, tip: Tooltip): void {
    const cell = this.makeCell(item, x, y, size);
    cell.on('dragend', (pointer: Phaser.Input.Pointer) => {
      cell.setScale(1);
      cell.setDepth(0);
      this.dragging = false;
      this.equipTargets?.hide();
      let handled = false;
      if (this.pointIn(this.mannequinBounds, pointer.x, pointer.y)) {
        this.equip(item);
        handled = true;
      }
      if (!handled) cell.setPosition(x, y);
    });
    cell.on('pointerover', () => tip.show(x, y - size, this.itemTooltip(item)));
    cell.on('pointerout', () => tip.hide());
  }

  private addEmptyCell(x: number, y: number, size: number): void {
    this.add.rectangle(x, y, size, size, 0x2a241d).setStrokeStyle(2, 0x6a6258);
  }

  // ── Compact (portrait) fallback ──
  private renderCompact(f: Fighter): void {
    const x = this.cx;
    addText(this, x, 76, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 70, 76, '◀', () => this.shiftFighter(-1), { width: 40, height: 40, fontSize: 20 });
    this.button(x + 70, 76, '▶', () => this.shiftFighter(1), { width: 40, height: 40, fontSize: 20 });

    let y = 126;
    addText(this, x, y, `INVENTORY (${this.gameState.inventory.length})`, { fontSize: '16px', color: '#f2d98c' });
    y += 30;
    this.gameState.inventory.forEach((item) => {
      addText(this, x, y, item.name, { fontSize: '13px' });
      this.button(x, y + 20, 'EQUIP', () => this.equip(item), { width: 90, height: 30, fontSize: 12 });
      y += 48;
    });

    this.button(x - 70, this.h - 40, 'SKILL', () => this.scene.start('Skill'), { width: 120, height: 40, fontSize: 15 });
    this.button(x + 70, this.h - 40, 'DONE', () => this.scene.start('Main'), { width: 120, height: 40, fontSize: 15 });
  }

  // ── Actions & helpers ──
  private shiftFighter(delta: number): void {
    const n = this.gameState.roster.length;
    if (n <= 1) return;
    this.fighterIndex = (this.fighterIndex + delta + n) % n;
    this.render();
  }

  private equip(item: Equipment): void {
    const fighter = this.gameState.roster[this.fighterIndex];
    const displaced = displacedByEquip(fighter, item);
    const next = equipItem(fighter, item);
    const roster = [...this.gameState.roster];
    roster[this.fighterIndex] = next;
    const inventory = [...this.gameState.inventory.filter((i) => i.id !== item.id), ...displaced];
    this.gameState = { ...this.gameState, roster, inventory };
    this.render();
  }

  private unequipAllGear(): void {
    const state = this.gameState;
    const { fighter: next, displaced } = unequipAll(state.roster[this.fighterIndex]);
    if (displaced.length === 0) {
      this.toast('Nothing equipped.');
      return;
    }
    const roster = [...state.roster];
    roster[this.fighterIndex] = next;
    this.gameState = { ...state, roster, inventory: [...state.inventory, ...displaced] };
    this.toast('Unequipped all.');
    this.render();
  }

  private unequipToInventory(slot: EquipmentSlot): void {
    const state = this.gameState;
    const fighter = state.roster[this.fighterIndex];
    const item = fighter.loadout[slot];
    if (!item) return;
    const roster = [...state.roster];
    roster[this.fighterIndex] = unequipItem(fighter, slot);
    this.gameState = { ...state, roster, inventory: [...state.inventory, item] };
    this.toast(`Unequipped ${item.name}.`);
  }

  private changeInventoryPage(delta: number): void {
    const totalPages = Math.max(1, Math.ceil(this.gameState.inventory.length / MAX_VISIBLE));
    this.inventoryPage = Math.max(0, Math.min(this.inventoryPage + delta, totalPages - 1));
    this.render();
  }

  private describeItem(item: Equipment): string {
    const parts: string[] = [];
    if (item.armor > 0) parts.push(`Armor ${item.armor}`);
    if (item.minDamage !== undefined) parts.push(`Dmg ${item.minDamage}-${item.maxDamage}`);
    if (item.critBonus) parts.push(`Crit +${Math.round(item.critBonus * 100)}%`);
    if (item.blockChance !== undefined) parts.push(`Block ${item.blockChance}% (${item.blockValue ?? 0})`);
    for (const [key, value] of Object.entries(item.bonuses)) parts.push(`+${value} ${key}`);
    return parts.join(' · ') || 'No bonuses';
  }

  private itemTooltip(item: Equipment): string {
    return `${item.name}\n${this.describeItem(item)}\nDrag onto your fighter to equip.`;
  }

  private pointIn(bounds: Bounds | null, x: number, y: number): boolean {
    if (!bounds) return false;
    return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  }
}
