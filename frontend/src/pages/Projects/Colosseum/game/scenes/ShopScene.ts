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

  private render(): void {
    this.clearScreen();
    this.cameras.main.setBackgroundColor('#120e0a');
    this.header('ARMORY');
    this.cityBack(this.cityId);
    this.goldText();

    const { width, height } = this.scale;
    const stock = generateShopStock(this.tier, 6);
    const tip = createTooltip(this);

    addText(this, width / 2, 100, 'For sale — buy into inventory', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    stock.forEach((item: Equipment, i: number) => {
      const y = 140 + i * 46;
      const stat = this.describeItem(item);
      addText(this, width / 2 - 240, y, `${item.name} · ${stat} · ${itemPrice(item)} gp`, {
        fontSize: '16px',
      }).setOrigin(0, 0.5);
      this.button(width / 2 + 210, y, 'BUY', () => this.buy(item), {
        width: 96,
        height: 38,
        fontSize: 15,
        hover: () => tip.show(width / 2, y - 40, this.preview(item)),
        blur: () => tip.hide(),
      });
    });

    const invY = 140 + stock.length * 46 + 20;
    addText(this, width / 2, invY, 'Inventory — equip to your fighter', {
      fontSize: '18px',
      color: '#f2d98c',
    });

    this.gameState.inventory.forEach((item: Equipment, i: number) => {
      const y = invY + 36 + i * 40;
      addText(this, width / 2 - 240, y, `${item.name} (${item.slot})`, {
        fontSize: '15px',
      }).setOrigin(0, 0.5);
      this.button(width / 2 + 210, y, 'EQUIP', () => this.equip(item), {
        width: 96,
        height: 36,
        fontSize: 14,
      });
    });

    addText(this, width / 2, height - 30, `Equipped: ${this.describeFighter(this.gameState.roster[0])}`, {
      fontSize: '14px',
      color: '#b8aa94',
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
