import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import {
  buyItem,
  cityById,
  currentHp,
  equipItem,
  generateShopStock,
  itemPrice,
  sellItem,
  sellPrice,
  totalHp,
  type Equipment,
  type EquipmentSlot,
  type Fighter,
} from '../core';

const STOCK_COUNT = 8;

const FILTERS: Array<{ id: EquipmentSlot | 'all'; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'head', label: 'HEAD' },
  { id: 'torso', label: 'TORSO' },
  { id: 'leftArm', label: 'L ARM' },
  { id: 'rightArm', label: 'R ARM' },
  { id: 'legs', label: 'LEGS' },
  { id: 'mainHand', label: 'WEAPON' },
  { id: 'offHand', label: 'SHIELD' },
];

export class ShopScene extends BaseScene {
  private tier = 1;
  private cityId = '';
  private stock: Equipment[] = [];
  private filter: EquipmentSlot | 'all' = 'all';

  constructor() {
    super('Shop');
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.tier = data?.tier ?? 1;
    this.cityId = data?.cityId ?? '';
    this.filter = 'all';
    this.stock = generateShopStock(this.tier, STOCK_COUNT, Math.random);
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    const city = cityById(this.cityId);
    this.cityBack(this.cityId);
    this.goldText();

    this.header(city ? `SHOP — ${city.name.toUpperCase()}` : 'SHOP');
    const tip = createTooltip(this);
    const compact = this.compact;

    addText(this, this.cx, 90, 'Sort by:', { fontSize: '15px', color: '#f2d98c' });
    this.renderFilters(compact);

    // ── Stock grid ──
    const visible = this.filter === 'all' ? this.stock : this.stock.filter((i) => i.slot === this.filter);
    const stockTop = compact ? 208 : 158;
    addText(this, this.cx, stockTop - 14, `For sale — ${visible.length} item${visible.length === 1 ? '' : 's'}`, {
      fontSize: '18px',
      color: '#f2d98c',
    });

    const cols = compact ? 2 : 4;
    const cellW = compact ? 168 : 250;
    const cellH = compact ? 52 : 50;
    const gapX = compact ? 176 : 264;
    const gapY = compact ? 60 : 58;
    visible.forEach((item: Equipment, i: number) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.cx - ((cols - 1) * gapX) / 2 + col * gapX;
      const y = stockTop + row * gapY;
      const price = itemPrice(item);
      const btn = this.button(x, y, `${item.name} · ${price}gp`, () => this.buy(item), {
        width: cellW,
        height: cellH,
        fontSize: compact ? 13 : 15,
        hover: () => tip.show(this.cx, y - 40, this.preview(item)),
        blur: () => tip.hide(),
      });
      if (this.gameState.gold < price) btn.setEnabled(false);
    });

    const rows = Math.max(1, Math.ceil(visible.length / cols));
    const restockY = stockTop + rows * gapY + 18;
    this.button(this.cx, restockY, 'NEW STOCK', () => this.restock(), {
      width: 180,
      height: 40,
      fontSize: 16,
    });

    // ── Inventory ──
    const invY = restockY + 50;
    addText(this, this.cx, invY, `Inventory (${this.gameState.inventory.length}) — equip to your fighter`, {
      fontSize: '18px',
      color: '#f2d98c',
    });
    this.gameState.inventory.forEach((item: Equipment, i: number) => {
      const y = invY + 40 + i * (compact ? 56 : 42);
      addText(
        this,
        compact ? this.cx : this.cx - 260,
        compact ? y - 18 : y,
        `${item.name} (${item.slot})`,
        { fontSize: '15px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      if (compact) {
        this.button(this.cx - 70, y + 18, 'EQUIP', () => this.equip(item), { width: 90, height: 34, fontSize: 13 });
        this.button(this.cx + 70, y + 18, 'SELL', () => this.sell(item), { width: 90, height: 34, fontSize: 13 });
      } else {
        this.button(this.cx + 150, y, 'EQUIP', () => this.equip(item), { width: 96, height: 36, fontSize: 14 });
        this.button(this.cx + 260, y, 'SELL', () => this.sell(item), { width: 96, height: 36, fontSize: 14 });
      }
    });

    // ── Fighter summary ──
    const fighter = this.gameState.roster[0];
    addText(this, this.cx, this.h - 28, this.describeFighter(fighter), {
      fontSize: '14px',
      color: '#b8aa94',
      wordWrap: { width: this.w - 40 },
    });
  }

  private renderFilters(compact: boolean): void {
    const cols = compact ? 4 : 8;
    const width = compact ? 80 : 94;
    const gapX = compact ? 88 : 100;
    FILTERS.forEach((f, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.cx - ((cols - 1) * gapX) / 2 + col * gapX;
      const y = compact ? 118 + row * 46 : 118;
      const active = this.filter === f.id;
      this.button(x, y, f.label, () => {
        this.filter = f.id;
        this.render();
      }, {
        width,
        height: 36,
        fontSize: compact ? 12 : 14,
        fill: active ? 0xe8b84b : undefined,
        hoverFill: active ? 0xf0c858 : undefined,
        textColor: active ? '#3a2f24' : undefined,
      });
    });
  }

  private restock(): void {
    this.stock = generateShopStock(this.tier, STOCK_COUNT, Math.random);
    this.render();
  }

  /** Equipping preview: current → new for each stat the item carries. */
  private preview(item: Equipment): string {
    const equipped = this.gameState.roster[0].loadout[item.slot];
    const parts: string[] = [];
    if (item.armor > 0) parts.push(`armor ${equipped?.armor ?? 0} → ${item.armor}`);
    if (item.minDamage !== undefined) {
      parts.push(`dmg ${equipped?.minDamage ?? 0}-${equipped?.maxDamage ?? 0} → ${item.minDamage}-${item.maxDamage}`);
    }
    if (item.critBonus) parts.push(`crit +${Math.round(item.critBonus * 100)}%`);
    if (item.blockChance !== undefined) {
      parts.push(`block ${equipped?.blockChance ?? 0}% → ${item.blockChance}%`);
    }
    return parts.join(' · ') || 'No stat change';
  }

  private describeFighter(fighter: Fighter): string {
    const armor = Object.values(fighter.loadout).reduce((acc, item) => acc + (item?.armor ?? 0), 0);
    const equipped = Object.values(fighter.loadout)
      .filter(Boolean)
      .map((item) => (item as Equipment).name)
      .join(', ');
    return `${fighter.name} · Lv ${fighter.level} · HP ${currentHp(fighter)}/${totalHp(fighter)} · MP ${fighter.morale}/${fighter.maxMorale} · Armor ${armor} · Equipped: ${equipped || 'nothing'}`;
  }

  private buy(item: Equipment): void {
    try {
      this.gameState = buyItem(this.gameState, item);
    } catch {
      // not enough gold — button is disabled anyway
    }
    this.render();
  }

  private sell(item: Equipment): void {
    this.confirm('Sell item?', `Sell ${item.name} for ${sellPrice(item)} gp?`, () => {
      this.gameState = sellItem(this.gameState, item);
      this.render();
    });
  }

  private equip(item: Equipment): void {
    const next = equipItem(this.gameState.roster[0], item);
    this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    this.render();
  }
}
