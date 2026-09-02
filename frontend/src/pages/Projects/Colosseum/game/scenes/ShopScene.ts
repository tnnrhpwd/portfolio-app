import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { addText, createTooltip, type Tooltip } from '../ui/button';
import { EquipTargets } from '../ui/equipTargets';
import { addEquipmentIcon, addLayeredFighter, addMannequinFrame } from '../assets/textures';
import {
  buyItem,
  cityById,
  currentHp,
  displacedByEquip,
  effectiveAttributes,
  equipItem,
  generateShopStock,
  itemPrice,
  sellItem,
  sellPrice,
  totalHp,
  unequipAll,
  xpToNext,
  type Equipment,
  type EquipmentSlot,
  type Fighter,
} from '../core';

const STOCK_COUNT = 8;
/** Shop restock cadence in ms (matches the reference's ~15-minute timer). */
const RESTOCK_MS = 15 * 60 * 1000;

/** The seven equipment slots, in body order for the equipped-gear summary. */
const SLOTS: EquipmentSlot[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'mainHand', 'offHand'];

interface FilterDef {
  id: string;
  label: string;
  match: (slot: EquipmentSlot) => boolean;
}

/** Shop categories. "ARMS" matches both arm slots (armor + vambrace). */
const FILTERS: FilterDef[] = [
  { id: 'all', label: 'ALL', match: () => true },
  { id: 'weapon', label: 'WEAPON', match: (s) => s === 'mainHand' },
  { id: 'shield', label: 'SHIELD', match: (s) => s === 'offHand' },
  { id: 'helm', label: 'HELM', match: (s) => s === 'head' },
  { id: 'torso', label: 'TORSO', match: (s) => s === 'torso' },
  { id: 'arms', label: 'ARMS', match: (s) => s === 'leftArm' || s === 'rightArm' },
  { id: 'legs', label: 'LEGS', match: (s) => s === 'legs' },
];

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class ShopScene extends BaseScene {
  private tier = 1;
  private cityId = '';
  private stock: Equipment[] = [];
  private filter = 'all';
  private fighterIndex = 0;
  private restockDeadline = 0;
  private countdownText: Phaser.GameObjects.Text | null = null;
  private mannequinBounds: Bounds | null = null;
  private equipTargets: EquipTargets | null = null;
  private dragging = false;
  private inventoryBounds: Bounds | null = null;
  private sellBounds: Bounds | null = null;

  constructor() {
    super('Shop');
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.tier = data?.tier ?? 1;
    this.cityId = data?.cityId ?? '';
    this.filter = 'all';
    this.fighterIndex = 0;
    this.stock = generateShopStock(this.tier, STOCK_COUNT, Math.random);
    if (!this.restockDeadline) this.restockDeadline = Date.now() + RESTOCK_MS;
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tickRestock() });
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.menuBackground();
    this.countdownText = null;
    this.mannequinBounds = null;
    this.equipTargets = null;
    this.inventoryBounds = null;
    this.sellBounds = null;

    const city = cityById(this.cityId);
    this.cityBack(this.cityId);
    this.goldText();
    this.header(city ? `SHOP — ${city.name.toUpperCase()}` : 'SHOP');

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
    this.renderShopPanel(rightX, tip);
  }

  // ── Left column: active fighter, arrows, and the mannequin equip target ──
  private renderFighterPanel(f: Fighter, x: number): void {
    const scale = 1.3;
    const bodyY = 330;
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
    this.equipTargets.drawSlots(f.loadout);

    // Equipped gear summary.
    const equipped = SLOTS.map((slot) => f.loadout[slot]).filter(Boolean) as Equipment[];
    addText(
      this,
      x,
      455,
      equipped.length ? `Equipped: ${equipped.map((e) => e.name).join(', ')}` : 'Equipped: nothing',
      { fontSize: '13px', color: '#b8aa94', wordWrap: { width: 360 } },
    );

    this.renderStats(f, x);
  }

  private renderStats(f: Fighter, x: number): void {
    const attrs = effectiveAttributes(f);
    const main = f.loadout.mainHand;
    const off = f.loadout.offHand;
    const weapon = main ?? (off && off.minDamage !== undefined ? off : null);
    const dmgMin = (weapon?.minDamage ?? 5) + attrs.strength;
    const dmgMax = (weapon?.maxDamage ?? 10) + attrs.strength;
    const armor = SLOTS.reduce((acc, slot) => acc + (f.loadout[slot]?.armor ?? 0), 0);

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

    const y = 505;
    this.add.rectangle(x, y + 82, 380, 172, 0x000000, 0.28).setStrokeStyle(1, 0x6a6258);
    addText(this, x - 120, y, left, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
    addText(this, x + 60, y, right, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
  }

  // ── Right column: sort / shop / inventory / sell ──
  private renderShopPanel(x: number, tip: Tooltip): void {
    addText(this, x, 86, 'SORT BY:', { fontSize: '15px', color: '#f2d98c' });
    this.renderFilters(x, 116);

    addText(this, x, 164, 'SHOP', { fontSize: '22px', color: '#e8b84b', fontStyle: 'bold' });
    this.countdownText = addText(this, x, 188, this.countdownLabel(), { fontSize: '14px', color: '#f2d98c' });
    addText(this, x, 206, 'PAGE 1/1', { fontSize: '11px', color: '#6a6258' });
    addText(this, x, 222, 'Drag gear to buy — onto your fighter to equip, or into inventory to store.', {
      fontSize: '11px',
      color: '#b8aa94',
    });

    // Shop grid (4 × 2).
    const visible = this.stock.filter((item) => !!FILTERS.find((flt) => flt.id === this.filter)?.match(item.slot));
    const cell = 84;
    const gap = 10;
    const cols = 4;
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = x - gridW / 2 + cell / 2;
    const y0 = 250;
    visible.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.addShopCell(item, x0 + col * (cell + gap), y0 + row * (cell + gap), cell, tip);
    });

    // Inventory grid (up to 8 visible; the rest live in the Inventory scene).
    const invLabelY = y0 + 2 * (cell + gap) + 20;
    addText(this, x, invLabelY, `INVENTORY (${this.gameState.inventory.length})`, { fontSize: '16px', color: '#f2d98c' });
    const invY0 = invLabelY + 34;
    const invItems = this.gameState.inventory.slice(0, 8);
    this.inventoryBounds = {
      x0: x - gridW / 2,
      y0: invY0 - cell / 2,
      x1: x + gridW / 2,
      y1: invY0 + (Math.ceil(invItems.length / cols) || 1) * (cell + gap) - gap,
    };
    for (let i = 0; i < 8; i += 1) {
      const item = invItems[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x0 + col * (cell + gap);
      const cy = invY0 + row * (cell + gap);
      if (item) this.addInventoryCell(item, cx, cy, cell, tip);
      else this.addEmptyCell(cx, cy, cell);
    }
    if (this.gameState.inventory.length > 8) {
      addText(this, x, invY0 + 2 * (cell + gap) + 8, `+${this.gameState.inventory.length - 8} more in storage`, {
        fontSize: '12px',
        color: '#b8aa94',
      });
    }

    // Sell drop zone.
    const sellW = 230;
    const sellH = 46;
    const sellY = this.h - 40;
    this.add.rectangle(x, sellY, sellW, sellH, 0x2a241d).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, sellY, 'SELL — drop loot here', { fontSize: '15px', color: '#f2d98c' });
    this.sellBounds = { x0: x - sellW / 2, y0: sellY - sellH / 2, x1: x + sellW / 2, y1: sellY + sellH / 2 };
  }

  private renderFilters(x: number, y: number): void {
    const width = 70;
    const gapX = 80;
    FILTERS.forEach((flt, i) => {
      const bx = x - ((FILTERS.length - 1) * gapX) / 2 + i * gapX;
      const active = this.filter === flt.id;
      this.button(bx, y, flt.label, () => {
        this.filter = flt.id;
        this.render();
      }, {
        width,
        height: 32,
        fontSize: 12,
        fill: active ? 0xe8b84b : undefined,
        hoverFill: active ? 0xf0c858 : undefined,
        textColor: active ? '#3a2f24' : undefined,
      });
    });
  }

  // ── Compact (portrait) fallback: button-based list ──
  private renderCompact(f: Fighter): void {
    const x = this.cx;
    addText(this, x, 80, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 70, 80, '◀', () => this.shiftFighter(-1), { width: 40, height: 40, fontSize: 20 });
    this.button(x + 70, 80, '▶', () => this.shiftFighter(1), { width: 40, height: 40, fontSize: 20 });

    let y = 122;
    addText(this, x, y, 'Sort by:', { fontSize: '13px', color: '#f2d98c' });
    y += 26;
    FILTERS.forEach((flt, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      this.button(x - 150 + col * 100, y + row * 36, flt.label, () => {
        this.filter = flt.id;
        this.render();
      }, {
        width: 92,
        height: 30,
        fontSize: 11,
        fill: this.filter === flt.id ? 0xe8b84b : undefined,
        textColor: this.filter === flt.id ? '#3a2f24' : undefined,
      });
    });
    y += 84;

    const visible = this.stock.filter((item) => !!FILTERS.find((flt) => flt.id === this.filter)?.match(item.slot));
    addText(this, x, y, 'SHOP — tap to buy', { fontSize: '14px', color: '#f2d98c' });
    y += 26;
    visible.forEach((item) => {
      const price = itemPrice(item);
      const btn = this.button(x, y, `${item.name} · ${price}gp`, () => this.buyToInventory(item), {
        width: 260,
        height: 32,
        fontSize: 12,
      });
      if (this.gameState.gold < price) btn.setEnabled(false);
      y += 38;
    });

    y += 10;
    addText(this, x, y, `INVENTORY (${this.gameState.inventory.length})`, { fontSize: '14px', color: '#f2d98c' });
    y += 26;
    this.gameState.inventory.forEach((item) => {
      addText(this, x, y, `${item.name} (${item.slot})`, { fontSize: '12px' });
      this.button(x - 60, y + 20, 'EQUIP', () => this.equipFromInventory(item), { width: 70, height: 30, fontSize: 12 });
      this.button(x + 60, y + 20, 'SELL', () => this.sellFromInventory(item), { width: 70, height: 30, fontSize: 12 });
      y += 46;
    });
  }

  // ── Draggable item cells ──
  private makeCell(
    item: Equipment,
    x: number,
    y: number,
    size: number,
    fill: number,
    stroke: number,
    footer: string | null,
  ): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(0, 0, size, size, fill).setStrokeStyle(2, stroke);
    const objs: Phaser.GameObjects.GameObject[] = [rect];
    const icon = addEquipmentIcon(this, 0, footer ? -size * 0.28 : -size * 0.16, item, size * 0.42);
    if (icon) objs.push(icon);
    const label = this.add
      .text(0, footer ? -8 : 0, item.name, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '10px',
        color: '#f2d98c',
        wordWrap: { width: size - 10 },
        align: 'center',
      })
      .setOrigin(0.5);
    objs.push(label);
    if (footer) {
      objs.push(
        this.add
          .text(0, size / 2 - 10, footer, {
            fontFamily: 'Arial, sans-serif',
            fontSize: '11px',
            color: '#f2d98c',
          })
          .setOrigin(0.5),
      );
    }
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

  private addShopCell(item: Equipment, x: number, y: number, size: number, tip: Tooltip): void {
    const price = itemPrice(item);
    const affordable = this.gameState.gold >= price;
    const cell = this.makeCell(item, x, y, size, affordable ? 0x8c1f28 : 0x55504a, affordable ? 0xe8b84b : 0x6a6258, `${price}g`);
    cell.on('dragend', (pointer: Phaser.Input.Pointer) => {
      cell.setScale(1);
      cell.setDepth(0);
      this.dragging = false;
      this.equipTargets?.hide();
      let handled = false;
      if (this.pointIn(this.mannequinBounds, pointer.x, pointer.y)) {
        this.buyAndEquip(item);
        handled = true;
      } else if (this.pointIn(this.inventoryBounds, pointer.x, pointer.y)) {
        this.buyToInventory(item);
        handled = true;
      }
      if (!handled) cell.setPosition(x, y);
    });
    cell.on('pointerover', () => tip.show(x, y - size, this.itemTooltip(item, true)));
    cell.on('pointerout', () => tip.hide());
  }

  private addInventoryCell(item: Equipment, x: number, y: number, size: number, tip: Tooltip): void {
    const cell = this.makeCell(item, x, y, size, 0x8c1f28, 0xe8b84b, null);
    cell.on('dragend', (pointer: Phaser.Input.Pointer) => {
      cell.setScale(1);
      cell.setDepth(0);
      this.dragging = false;
      this.equipTargets?.hide();
      let handled = false;
      if (this.pointIn(this.mannequinBounds, pointer.x, pointer.y)) {
        this.equipFromInventory(item);
        handled = true;
      } else if (this.pointIn(this.sellBounds, pointer.x, pointer.y)) {
        this.sellFromInventory(item);
        handled = true;
      }
      if (!handled) cell.setPosition(x, y);
    });
    cell.on('pointerover', () => tip.show(x, y - size, this.itemTooltip(item, false)));
    cell.on('pointerout', () => tip.hide());
  }

  private addEmptyCell(x: number, y: number, size: number): void {
    this.add.rectangle(x, y, size, size, 0x2a241d).setStrokeStyle(2, 0x6a6258);
  }

  // ── Actions ──
  private shiftFighter(delta: number): void {
    const n = this.gameState.roster.length;
    if (n <= 1) return;
    this.fighterIndex = (this.fighterIndex + delta + n) % n;
    this.render();
  }

  private buyToInventory(item: Equipment): void {
    if (this.gameState.gold < itemPrice(item)) {
      this.toast('Not enough gold.');
      return;
    }
    this.gameState = buyItem(this.gameState, item);
    this.stock = this.stock.filter((s) => s.id !== item.id);
    this.toast(`Bought ${item.name}.`);
    this.render();
  }

  private buyAndEquip(item: Equipment): void {
    const state = this.gameState;
    if (state.gold < itemPrice(item)) {
      this.toast('Not enough gold.');
      return;
    }
    const roster = [...state.roster];
    const fighter = roster[this.fighterIndex];
    const displaced = displacedByEquip(fighter, item);
    roster[this.fighterIndex] = equipItem(fighter, item);
    const inventory = [...state.inventory, ...displaced];
    this.gameState = { ...state, gold: state.gold - itemPrice(item), roster, inventory };
    this.stock = this.stock.filter((s) => s.id !== item.id);
    this.toast(`Equipped ${item.name}.`);
    this.render();
  }

  private equipFromInventory(item: Equipment): void {
    const state = this.gameState;
    const roster = [...state.roster];
    const fighter = roster[this.fighterIndex];
    const displaced = displacedByEquip(fighter, item);
    roster[this.fighterIndex] = equipItem(fighter, item);
    const inventory = [...state.inventory.filter((i) => i.id !== item.id), ...displaced];
    this.gameState = { ...state, roster, inventory };
    this.toast(`Equipped ${item.name}.`);
    this.render();
  }

  private sellFromInventory(item: Equipment): void {
    const price = sellPrice(item);
    this.gameState = sellItem(this.gameState, item);
    this.toast(`Sold ${item.name} for ${price} gp.`);
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

  // ── Helpers ──
  private describeItem(item: Equipment): string {
    const parts: string[] = [];
    if (item.armor > 0) parts.push(`Armor ${item.armor}`);
    if (item.minDamage !== undefined) parts.push(`Dmg ${item.minDamage}-${item.maxDamage}`);
    if (item.critBonus) parts.push(`Crit +${Math.round(item.critBonus * 100)}%`);
    if (item.blockChance !== undefined) parts.push(`Block ${item.blockChance}% (${item.blockValue ?? 0})`);
    for (const [key, value] of Object.entries(item.bonuses)) parts.push(`+${value} ${key}`);
    return parts.join(' · ') || 'No bonuses';
  }

  private itemTooltip(item: Equipment, inShop: boolean): string {
    const lines = [item.name, this.describeItem(item)];
    lines.push(inShop ? `Price: ${itemPrice(item)} gp` : `Sell: ${sellPrice(item)} gp`);
    return lines.join('\n');
  }

  private countdownLabel(): string {
    const total = Math.max(0, Math.ceil((this.restockDeadline - Date.now()) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `NEW STOCK IN: ${m}:${s.toString().padStart(2, '0')}`;
  }

  private tickRestock(): void {
    if (this.restockDeadline <= Date.now()) {
      this.restock();
      return;
    }
    if (this.countdownText) this.countdownText.setText(this.countdownLabel());
  }

  private restock(): void {
    this.stock = generateShopStock(this.tier, STOCK_COUNT, Math.random);
    this.restockDeadline = Date.now() + RESTOCK_MS;
    this.render();
  }

  private pointIn(bounds: Bounds | null, x: number, y: number): boolean {
    if (!bounds) return false;
    return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  }
}
