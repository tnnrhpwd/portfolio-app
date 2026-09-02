import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import { buyItem, equipItem, generateShopStock, itemPrice, type Equipment, type Fighter } from '../core';

export class ShopScene extends BaseScene {
  private tier = 1;
  private cityId = '';

  constructor() {
    super('Shop');
  }

  create(data: { tier?: number; cityId?: string } = {}): void {
    this.tier = data?.tier ?? 1;
    this.cityId = data?.cityId ?? '';
    this.render();
  }

  protected onResize(): void {
    this.render();
  }

  private render(): void {
    this.clearScreen();
    this.applyBackground();
    this.header('ARMORY');
    this.cityBack(this.cityId);
    this.goldText();

    const stock = generateShopStock(this.tier, 6);
    const tip = createTooltip(this);
    const compact = this.compact;

    addText(this, this.cx, 100, 'For sale — buy into inventory', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    stock.forEach((item: Equipment, i: number) => {
      const y = 140 + i * (compact ? 66 : 46);
      const stat = this.describeItem(item);
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 20 : y,
        `${item.name} · ${stat} · ${itemPrice(item)} gp`,
        { fontSize: '16px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      this.button(compact ? this.cx : this.cx + 210, compact ? y + 20 : y, 'BUY', () => this.buy(item), {
        width: 96,
        height: 38,
        fontSize: 15,
        hover: () => tip.show(this.cx, y - 40, this.preview(item)),
        blur: () => tip.hide(),
      });
    });

    const invY = 140 + stock.length * (compact ? 66 : 46) + 20;
    addText(this, this.cx, invY, 'Inventory — equip to your fighter', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.gameState.inventory.forEach((item: Equipment, i: number) => {
      const y = invY + 36 + i * (compact ? 60 : 40);
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 18 : y,
        `${item.name} (${item.slot})`,
        { fontSize: '15px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      this.button(compact ? this.cx : this.cx + 210, compact ? y + 18 : y, 'EQUIP', () => this.equip(item), {
        width: 96,
        height: 36,
        fontSize: 14,
      });
    });

    addText(this, this.cx, this.h - 30, `Equipped: ${this.describeFighter(this.gameState.roster[0])}`, {
      fontSize: '14px',
      color: '#b8aa94',
      wordWrap: { width: this.w - 40 },
    });
  }

  private describeItem(item: Equipment): string {
    if (item.armor > 0) return `armor ${item.armor}`;
    if (item.minDamage !== undefined) return `dmg ${item.minDamage}-${item.maxDamage}`;
    return `block ${item.blockChance}%`;
  }

  /** Equipping preview: current → new for each stat the item carries. */
  private preview(item: Equipment): string {
    const equipped = this.gameState.roster[0].loadout[item.slot];
    const parts: string[] = [];
    if (item.armor > 0) parts.push(`armor ${equipped?.armor ?? 0} → ${item.armor}`);
    if (item.minDamage !== undefined) {
      parts.push(`dmg ${equipped?.minDamage ?? 0}-${equipped?.maxDamage ?? 0} → ${item.minDamage}-${item.maxDamage}`);
    }
    if (item.blockChance !== undefined) {
      parts.push(`block ${equipped?.blockChance ?? 0}% → ${item.blockChance}%`);
    }
    return parts.join(' · ') || 'No stat change';
  }

  private describeFighter(fighter: Fighter): string {
    const parts: string[] = [];
    if (fighter.loadout.mainHand) parts.push(fighter.loadout.mainHand.name);
    if (fighter.loadout.offHand) parts.push(fighter.loadout.offHand.name);
    if (fighter.loadout.head) parts.push(fighter.loadout.head.name);
    return parts.join(', ') || 'nothing';
  }

  private buy(item: Equipment): void {
    try {
      this.gameState = buyItem(this.gameState, item);
    } catch {
      // not enough gold — ignore
    }
    this.render();
  }

  private equip(item: Equipment): void {
    const next = equipItem(this.gameState.roster[0], item);
    this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    this.render();
  }
}
