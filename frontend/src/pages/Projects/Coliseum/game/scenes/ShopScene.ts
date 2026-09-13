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
  unequipItem,
  xpToNext,
  type Equipment,
  type EquipmentSlot,
  type Fighter,
} from '../core';

const STOCK_COUNT = 36;
/** Items per shop page in the wide box (6 columns × 2 rows, matching the reference). */
const SHOP_PAGE_SIZE = 12;
/** Shop restock cadence in ms (matches the reference's ~15-minute timer). */
const RESTOCK_MS = 15 * 60 * 1000;

/** Items per inventory page in the wide box (6 columns × 2 rows). */
const SHOP_INV_PAGE_SIZE = 12;

/**
 * Items per grid page in the tall box (720×1280): 4 columns × 2 rows of much
 * larger cells, since six columns cannot fit and the extra height is spent on
 * taller bands rather than more rows.
 */
const PORTRAIT_PAGE_SIZE = 8;

/** The seven equipment slots, in body order for the equipped-gear summary. */
const SLOTS: EquipmentSlot[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'mainHand', 'offHand'];

interface FilterDef {
  id: string;
  label: string;
  match: (item: Equipment) => boolean;
}

/** Shop categories. "WEAPON" covers any weapon (main or off hand); "SHIELD" only shields. */
const FILTERS: FilterDef[] = [
  { id: 'all', label: 'ALL', match: () => true },
  { id: 'weapon', label: 'WEAPON', match: (i) => i.minDamage !== undefined },
  { id: 'shield', label: 'SHIELD', match: (i) => i.blockChance !== undefined },
  { id: 'helm', label: 'HELMET', match: (i) => i.slot === 'head' },
  { id: 'torso', label: 'TORSO', match: (i) => i.slot === 'torso' },
  { id: 'arms', label: 'ARMS', match: (i) => i.slot === 'leftArm' || i.slot === 'rightArm' },
  { id: 'legs', label: 'LEGS', match: (i) => i.slot === 'legs' },
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
  private shopPage = 0;
  private fighterIndex = 0;
  private restockDeadline = 0;
  private countdownText: Phaser.GameObjects.Text | null = null;
  private mannequinBounds: Bounds | null = null;
  private equipTargets: EquipTargets | null = null;
  private dragging = false;
  private inventoryBounds: Bounds | null = null;
  private sellBounds: Bounds | null = null;
  private inventoryPage = 0;

  constructor() {
    super('Shop');
  }

  /** Items per inventory page — the tall box shows fewer, much larger cells. */
  private get inventoryPageSize(): number {
    return this.portrait ? PORTRAIT_PAGE_SIZE : SHOP_INV_PAGE_SIZE;
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.tier = data?.tier ?? 1;
    this.cityId = data?.cityId ?? '';
    this.filter = 'all';
    this.shopPage = 0;
    this.inventoryPage = 0;
    this.fighterIndex = 0;
    this.stock = generateShopStock(this.tier, STOCK_COUNT, Math.random);
    if (!this.restockDeadline) this.restockDeadline = Date.now() + RESTOCK_MS;
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tickRestock() });
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
    this.goldText();
    this.header(city ? `SHOP — ${city.name.toUpperCase()}` : 'SHOP');

    const roster = this.gameState.roster;
    this.fighterIndex = Math.max(0, Math.min(this.fighterIndex, roster.length - 1));
    const fighter = roster[this.fighterIndex];
    if (!fighter) return;

    if (this.portrait) {
      this.renderPortrait(fighter);
      return;
    }

    const leftX = this.w * 0.26;
    const rightX = this.w * 0.74;
    const tip = createTooltip(this);
    this.renderFighterPanel(fighter, leftX, tip);
    this.renderShopPanel(rightX, tip);
  }

  // ── Left column: active fighter, arrows, and the mannequin equip target ──
  private renderFighterPanel(f: Fighter, x: number, tip: Tooltip): void {
    const scale = 1.3;
    const h = this.h;
    const bodyY = h * 0.28; // figures near the top, like the reference
    const nameY = h * 0.57; // nameplate below the figures
    const statsY = h * 0.7; // stats near the bottom
    const feetY = bodyY + 90 * scale + 8;
    const manW = 120 * scale + 26;
    const manH = 180 * scale + 18;

    // UNEQUIP ALL (top-left of the panel).
    this.button(x - 150, h * 0.05, 'UNEQUIP ALL', () => this.unequipAllGear(), {
      width: 118,
      height: 30,
      fontSize: 11,
    });

    // Active fighter sprite on a pedestal.
    addLayeredFighter(this, x - 110, bodyY, f, scale);
    this.add.ellipse(x - 110, feetY, 110, 22, 0x000000, 0.35);

    // Mannequin: a wireframe figure with eight always-visible drop slots.
    addMannequinFrame(this, x + 110, bodyY, scale);
    this.add.ellipse(x + 110, feetY, 110, 22, 0x000000, 0.25);
    const hitArea = this.add
      .rectangle(x + 110, bodyY, manW, manH, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hitArea.on('pointerover', () => {
      if (!this.dragging) this.equipTargets?.setHover(true);
    });
    hitArea.on('pointerout', () => {
      if (!this.dragging) this.equipTargets?.setHover(false);
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
        tip.hide();
      },
      onDragEnd: (slot, px, py) => {
        this.dragging = false;
        if (this.pointIn(this.inventoryBounds, px, py)) this.unequipToInventory(slot);
        else if (this.pointIn(this.sellBounds, px, py)) this.sellEquipped(slot);
        this.render();
      },
      onItemHover: (item, hx, hy) => {
        if (!this.dragging) tip.show(hx, hy - 40, this.itemTooltip(item, false));
      },
      onItemHoverOut: () => tip.hide(),
    });
    this.equipTargets.drawSlots(f.loadout);

    // Nameplate below the figures.
    this.add.rectangle(x, nameY, 340, 40, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, nameY, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });

    // Fighter selector arrows flank the stats panel, like the reference.
    this.button(x - 230, statsY + 70, '◀', () => this.shiftFighter(-1), { width: 44, height: 60, fontSize: 24 });
    this.button(x + 230, statsY + 70, '▶', () => this.shiftFighter(1), { width: 44, height: 60, fontSize: 24 });

    // Equipped gear summary.
    const equipped = SLOTS.map((slot) => f.loadout[slot]).filter(Boolean) as Equipment[];
    addText(
      this,
      x,
      statsY - 14,
      equipped.length ? `Equipped: ${equipped.map((e) => e.name).join(', ')}` : 'Equipped: nothing',
      { fontSize: '13px', color: '#b8aa94', wordWrap: { width: 360 } },
    );

    this.renderStats(f, x, statsY);
  }

  private renderStats(f: Fighter, x: number, y: number): void {
    const attrs = effectiveAttributes(f);
    const main = f.loadout.mainHand;
    const off = f.loadout.offHand;
    const weapon = main ?? (off && off.minDamage !== undefined ? off : null);
    const dmgMin = (weapon?.minDamage ?? 5) + attrs.strength;
    const dmgMax = (weapon?.maxDamage ?? 10) + attrs.strength;
    const armor = SLOTS.reduce((acc, slot) => acc + (f.loadout[slot]?.armor ?? 0), 0);

    this.add.rectangle(x, y + 86, 380, 184, 0x000000, 0.28).setStrokeStyle(1, 0x6a6258);
    const leftX = x - 160;

    // Level + progress bars (EXP light, FAME red — matching the reference).
    addText(this, leftX, y, `LEVEL: ${f.level}`, { fontSize: '13px', color: '#e8dcc8' }).setOrigin(0, 0);
    const expNeed = Math.max(1, xpToNext(f.level));
    this.drawBar(leftX, y + 20, 170, 10, Math.min(1, f.xp / expNeed), 0xd9d4c8);
    addText(this, leftX + 178, y + 20, 'EXP', { fontSize: '11px', color: '#b8aa94' }).setOrigin(0, 0.5);
    this.drawBar(leftX, y + 36, 170, 10, Math.min(1, this.gameState.fame / 100), 0x8c1f28);
    addText(this, leftX + 178, y + 36, 'FAME', { fontSize: '11px', color: '#b8aa94' }).setOrigin(0, 0.5);

    // Attribute columns.
    const left = [
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
    addText(this, leftX, y + 56, left, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
    addText(this, x + 30, y + 56, right, { fontSize: '13px', color: '#e8dcc8', align: 'left', lineSpacing: 5 }).setOrigin(0, 0);
  }

  private drawBar(x: number, y: number, w: number, h: number, frac: number, fill: number): void {
    this.add.rectangle(x + w / 2, y, w, h, 0x1c1610).setStrokeStyle(1, 0x6a6258);
    if (frac > 0) {
      this.add.rectangle(x, y, Math.max(2, w * Math.min(1, frac)), h, fill).setOrigin(0, 0.5);
    }
  }

  // ── Right column: sort / shop / inventory / sell ──
  private renderShopPanel(x: number, tip: Tooltip): void {
    addText(this, x, 86, 'SORT BY:', { fontSize: '15px', color: '#f2d98c' });
    this.renderFilters(x, 116);

    addText(this, x, 164, 'SHOP', { fontSize: '22px', color: '#e8b84b', fontStyle: 'bold' });
    this.countdownText = addText(this, x, 188, this.countdownLabel(), { fontSize: '14px', color: '#f2d98c' });
    addText(this, x, 208, 'Drag gear to buy — onto your fighter to equip, or into inventory to store.', {
      fontSize: '11px',
      color: '#b8aa94',
    });

    // Shop grid (6 columns × 2 rows, paginated like the reference).
    const visible = this.stock.filter((item) => !!FILTERS.find((flt) => flt.id === this.filter)?.match(item));
    const totalPages = Math.max(1, Math.ceil(visible.length / SHOP_PAGE_SIZE));
    const page = Math.min(this.shopPage, totalPages - 1);
    const pageItems = visible.slice(page * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE + SHOP_PAGE_SIZE);

    const cols = 6;
    const cell = 78;
    const gap = 8;
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = x - gridW / 2 + cell / 2;
    const y0 = 232;
    for (let i = 0; i < SHOP_PAGE_SIZE; i += 1) {
      const item = pageItems[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x0 + col * (cell + gap);
      const cy = y0 + row * (cell + gap);
      if (item) this.addShopCell(item, cx, cy, cell, tip);
      else this.addEmptyCell(cx, cy, cell);
    }

    // Pagination row.
    const pageY = y0 + 2 * (cell + gap) + 22;
    this.button(x - 60, pageY, '◀', () => this.changePage(-1), { width: 36, height: 26, fontSize: 14 });
    addText(this, x, pageY, `PAGE ${page + 1}/${totalPages}`, { fontSize: '13px', color: '#f2d98c' });
    this.button(x + 60, pageY, '▶', () => this.changePage(1), { width: 36, height: 26, fontSize: 14 });

    // Inventory grid (6 columns × 2 rows, paginated).
    const invLabelY = pageY + 34;
    const invTotalPages = Math.max(1, Math.ceil(this.gameState.inventory.length / SHOP_INV_PAGE_SIZE));
    this.inventoryPage = Math.min(this.inventoryPage, invTotalPages - 1);
    addText(this, x, invLabelY, `INVENTORY (${this.gameState.inventory.length})`, { fontSize: '16px', color: '#f2d98c' });
    const prevBtn = this.button(x - 120, invLabelY, '\u25C0', () => this.changeInventoryPage(-1), { width: 36, height: 30, fontSize: 14 });
    const nextBtn = this.button(x + 120, invLabelY, '\u25B6', () => this.changeInventoryPage(1), { width: 36, height: 30, fontSize: 14 });
    if (this.inventoryPage <= 0) prevBtn.setEnabled(false);
    if (this.inventoryPage >= invTotalPages - 1) nextBtn.setEnabled(false);
    const invY0 = invLabelY + 34;
    const invItems = this.gameState.inventory.slice(
      this.inventoryPage * SHOP_INV_PAGE_SIZE,
      this.inventoryPage * SHOP_INV_PAGE_SIZE + SHOP_INV_PAGE_SIZE,
    );
    this.inventoryBounds = {
      x0: x - gridW / 2,
      y0: invY0 - cell / 2,
      x1: x + gridW / 2,
      y1: invY0 + 2 * (cell + gap) - gap,
    };
    for (let i = 0; i < SHOP_INV_PAGE_SIZE; i += 1) {
      const item = invItems[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x0 + col * (cell + gap);
      const cy = invY0 + row * (cell + gap);
      if (item) this.addInventoryCell(item, cx, cy, cell, tip);
      else this.addEmptyCell(cx, cy, cell);
    }

    // Sell drop zone.
    const sellW = 230;
    const sellH = 46;
    const sellY = this.h - 40;
    this.add.rectangle(x, sellY, sellW, sellH, 0x2a241d).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, sellY, 'SELL — drop loot here', { fontSize: '15px', color: '#f2d98c' });
    this.sellBounds = { x0: x - sellW / 2, y0: sellY - sellH / 2, x1: x + sellW / 2, y1: sellY + sellH / 2 };

    // BACK (bottom-right, like the reference).
    this.backAction = () => this.scene.start('Main');
    this.button(this.w * 0.92, this.h * 0.93, 'BACK', () => this.scene.start('Main'), {
      width: 110,
      height: 44,
      fontSize: 18,
    });
  }

  private changePage(delta: number): void {
    this.shopPage = Math.max(0, this.shopPage + delta);
    this.render();
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

  // ── Tall box (720×1280): the same panels stacked into labelled bands ──
  //    fighter (top) · stats · shop header + filters · stock grid · inventory · actions
  private renderPortrait(f: Fighter): void {
    const x = this.cx;
    const tip = createTooltip(this);

    // Band 1 — fighter selector: nameplate, arrows, fighter and equip mannequin.
    addText(this, x, 68, 'FIGHTER', { fontSize: '13px', color: '#b8aa94', fontStyle: 'bold' });
    this.add.rectangle(x, 96, 360, 44, 0x8c1f28).setStrokeStyle(2, 0xe8b84b);
    addText(this, x, 96, f.name.toUpperCase(), { fontSize: '20px', color: '#f2d98c', fontStyle: 'bold' });
    this.button(x - 228, 96, '◀', () => this.shiftFighter(-1), { width: 60, height: 48, fontSize: 22 });
    this.button(x + 228, 96, '▶', () => this.shiftFighter(1), { width: 60, height: 48, fontSize: 22 });

    const fighterX = x - 148;
    const manX = x + 148;
    const bodyY = 218;
    const spriteScale = 0.85;
    const manScale = 1;
    const manW = 120 * manScale + 26;
    const manH = 180 * manScale + 18;
    addLayeredFighter(this, fighterX, bodyY, f, spriteScale);
    this.add.ellipse(fighterX, bodyY + 90 * spriteScale + 8, 110, 22, 0x000000, 0.35);
    addMannequinFrame(this, manX, bodyY, manScale);
    this.add.ellipse(manX, bodyY + 90 * manScale + 8, 110, 22, 0x000000, 0.25);

    // Mannequin: the tall drop target with its eight always-visible slots.
    const hitArea = this.add
      .rectangle(manX, bodyY, manW, manH, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hitArea.on('pointerover', () => {
      if (!this.dragging) this.equipTargets?.setHover(true);
    });
    hitArea.on('pointerout', () => {
      if (!this.dragging) this.equipTargets?.setHover(false);
    });
    this.mannequinBounds = {
      x0: manX - manW / 2,
      y0: bodyY - manH / 2,
      x1: manX + manW / 2,
      y1: bodyY + manH / 2,
    };
    this.equipTargets = new EquipTargets(this, { cx: manX, cy: bodyY, w: 120 * manScale, h: 180 * manScale });
    this.equipTargets.setDragCallbacks({
      onDragStart: () => {
        this.dragging = true;
        tip.hide();
      },
      onDragEnd: (slot, px, py) => {
        this.dragging = false;
        if (this.pointIn(this.inventoryBounds, px, py)) this.unequipToInventory(slot);
        else if (this.pointIn(this.sellBounds, px, py)) this.sellEquipped(slot);
        this.render();
      },
      onItemHover: (item, hx, hy) => {
        if (!this.dragging) tip.show(hx, hy - 40, this.itemTooltip(item, false));
      },
      onItemHoverOut: () => tip.hide(),
    });
    this.equipTargets.drawSlots(f.loadout);

    // Equipped gear summary, then the stats panel.
    const equipped = SLOTS.map((slot) => f.loadout[slot]).filter(Boolean) as Equipment[];
    addText(
      this,
      x,
      334,
      equipped.length ? `Equipped: ${equipped.map((e) => e.name).join(', ')}` : 'Equipped: nothing',
      { fontSize: '12px', color: '#b8aa94', wordWrap: { width: 660 } },
    );
    this.renderStats(f, x, 362);

    // Band 2 — shop heading, restock countdown and the sort filters.
    addText(this, x, 556, 'SHOP', { fontSize: '20px', color: '#e8b84b', fontStyle: 'bold' });
    this.countdownText = addText(this, x, 580, this.countdownLabel(), { fontSize: '15px', color: '#f2d98c' });
    addText(this, x, 602, 'Drag gear to buy — onto your fighter to equip, or into inventory to store.', {
      fontSize: '12px',
      color: '#b8aa94',
      wordWrap: { width: 640 },
    });
    addText(this, x, 626, 'SORT BY', { fontSize: '13px', color: '#b8aa94', fontStyle: 'bold' });
    FILTERS.forEach((flt, i) => {
      const bx = x + (i - (FILTERS.length - 1) / 2) * 96;
      const active = this.filter === flt.id;
      this.button(bx, 656, flt.label, () => {
        this.filter = flt.id;
        this.render();
      }, {
        width: 88,
        height: 48,
        fontSize: 12,
        fill: active ? 0xe8b84b : undefined,
        hoverFill: active ? 0xf0c858 : undefined,
        textColor: active ? '#3a2f24' : undefined,
      });
    });

    // Band 3 — shop stock: 4 columns × 2 rows of large cells, paginated.
    const visible = this.stock.filter((item) => !!FILTERS.find((flt) => flt.id === this.filter)?.match(item));
    const totalPages = Math.max(1, Math.ceil(visible.length / PORTRAIT_PAGE_SIZE));
    const page = Math.min(this.shopPage, totalPages - 1);
    const pageItems = visible.slice(page * PORTRAIT_PAGE_SIZE, page * PORTRAIT_PAGE_SIZE + PORTRAIT_PAGE_SIZE);

    const cols = 4;
    const cell = 92;
    const gap = 10;
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = x - gridW / 2 + cell / 2;
    const y0 = 736;
    for (let i = 0; i < PORTRAIT_PAGE_SIZE; i += 1) {
      const item = pageItems[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x0 + col * (cell + gap);
      const cy = y0 + row * (cell + gap);
      if (item) this.addShopCell(item, cx, cy, cell, tip);
      else this.addEmptyCell(cx, cy, cell);
    }

    // Pagination row.
    const pageY = 908;
    this.button(x - 140, pageY, '◀', () => this.changePage(-1), { width: 60, height: 44, fontSize: 16 });
    addText(this, x, pageY, `PAGE ${page + 1}/${totalPages}`, { fontSize: '14px', color: '#f2d98c' });
    this.button(x + 140, pageY, '▶', () => this.changePage(1), { width: 60, height: 44, fontSize: 16 });

    // Band 4 — inventory: 4 columns × 2 rows of large cells, paginated.
    const invTotalPages = Math.max(1, Math.ceil(this.gameState.inventory.length / PORTRAIT_PAGE_SIZE));
    this.inventoryPage = Math.min(this.inventoryPage, invTotalPages - 1);
    const invLabelY = 956;
    addText(this, x, invLabelY, `INVENTORY (${this.gameState.inventory.length})`, { fontSize: '16px', color: '#f2d98c' });
    const prevBtn = this.button(x - 210, invLabelY, '\u25C0', () => this.changeInventoryPage(-1), { width: 60, height: 44, fontSize: 16 });
    const nextBtn = this.button(x + 210, invLabelY, '\u25B6', () => this.changeInventoryPage(1), { width: 60, height: 44, fontSize: 16 });
    if (this.inventoryPage <= 0) prevBtn.setEnabled(false);
    if (this.inventoryPage >= invTotalPages - 1) nextBtn.setEnabled(false);

    const invY0 = 1038;
    const invItems = this.gameState.inventory.slice(
      this.inventoryPage * PORTRAIT_PAGE_SIZE,
      this.inventoryPage * PORTRAIT_PAGE_SIZE + PORTRAIT_PAGE_SIZE,
    );
    this.inventoryBounds = {
      x0: x - gridW / 2,
      y0: invY0 - cell / 2,
      x1: x + gridW / 2,
      y1: invY0 + (cell + gap) + cell / 2,
    };
    for (let i = 0; i < PORTRAIT_PAGE_SIZE; i += 1) {
      const item = invItems[i] ?? null;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x0 + col * (cell + gap);
      const cy = invY0 + row * (cell + gap);
      if (item) this.addInventoryCell(item, cx, cy, cell, tip);
      else this.addEmptyCell(cx, cy, cell);
    }

    // Band 5 — SELL drop zone and the action buttons, along the bottom edge.
    const actionY = 1230;
    const sellW = 300;
    const sellH = 60;
    const sellX = 170;
    this.add.rectangle(sellX, actionY, sellW, sellH, 0x2a241d).setStrokeStyle(2, 0xe8b84b);
    addText(this, sellX, actionY, 'SELL — drop loot here', { fontSize: '15px', color: '#f2d98c' });
    this.sellBounds = {
      x0: sellX - sellW / 2,
      y0: actionY - sellH / 2,
      x1: sellX + sellW / 2,
      y1: actionY + sellH / 2,
    };

    this.button(415, actionY, 'UNEQUIP ALL', () => this.unequipAllGear(), { width: 170, height: 60, fontSize: 15 });
    this.backAction = () => this.scene.start('Main');
    this.button(610, actionY, 'BACK', () => this.scene.start('Main'), { width: 160, height: 60, fontSize: 18 });
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
    // No name label: it was eating the space the art needs, and the hover tooltip already
    // names the item. The price sits in the TOP-LEFT corner instead of a footer band, so it
    // no longer reserves a strip of the tile and the art gets the whole square.
    const icon = addEquipmentIcon(this, 0, 0, item, size * 0.94);
    if (icon) objs.push(icon);
    if (footer) {
      objs.push(
        this.add
          .text(-size / 2 + 5, -size / 2 + 3, footer, {
            fontFamily: 'Arial, sans-serif',
            fontSize: '11px',
            color: '#f2d98c',
            backgroundColor: 'rgba(20,8,10,0.55)',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0, 0),
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

  private changeInventoryPage(delta: number): void {
    const totalPages = Math.max(1, Math.ceil(this.gameState.inventory.length / this.inventoryPageSize));
    this.inventoryPage = Math.max(0, Math.min(this.inventoryPage + delta, totalPages - 1));
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

  private sellEquipped(slot: EquipmentSlot): void {
    const state = this.gameState;
    const fighter = state.roster[this.fighterIndex];
    const item = fighter.loadout[slot];
    if (!item) return;
    const price = sellPrice(item);
    const roster = [...state.roster];
    roster[this.fighterIndex] = unequipItem(fighter, slot);
    this.gameState = { ...state, roster, gold: state.gold + price };
    this.toast(`Sold ${item.name} for ${price} gp.`);
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
