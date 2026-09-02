import { BaseScene } from './BaseScene';
import { addText, createTooltip } from '../ui/button';
import {
  equipItem,
  unequipItem,
  type Equipment,
  type EquipmentSlot,
  type Fighter,
} from '../core';

const SLOTS: EquipmentSlot[] = ['head', 'torso', 'leftArm', 'rightArm', 'legs', 'mainHand', 'offHand'];

/** The inventory / character sheet: view equipped gear and equip from storage. */
export class InventoryScene extends BaseScene {
  private fighterIndex = 0;

  constructor() {
    super('Inventory');
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
    this.header('INVENTORY');
    this.backButton('Main');

    const roster = this.gameState.roster;
    this.fighterIndex = Math.max(0, Math.min(this.fighterIndex, roster.length - 1));
    const fighter = roster[this.fighterIndex];
    if (!fighter) return;

    const tip = createTooltip(this);
    const compact = this.compact;

    // Fighter selector (◀ ▶ cycle through the roster).
    this.button(this.cx - 110, 96, '◀', () => this.shiftFighter(-1), { width: 44, height: 44, fontSize: 22 });
    this.button(this.cx + 110, 96, '▶', () => this.shiftFighter(1), { width: 44, height: 44, fontSize: 22 });
    addText(this, this.cx, 96, `${fighter.name} — ${fighter.style.toUpperCase()} (${this.fighterIndex + 1}/${roster.length})`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    addText(this, this.cx, 142, 'Equipped gear', { fontSize: '18px', color: '#f2d98c' });

    // Equipped loadout per slot.
    SLOTS.forEach((slot, i) => {
      const y = 184 + i * (compact ? 52 : 40);
      const item = fighter.loadout[slot];
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 18 : y,
        `${this.slotLabel(slot)}: ${item ? item.name : '— empty —'}`,
        { fontSize: '16px', color: item ? undefined : '#6a6258' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      if (item) {
        this.button(compact ? this.cx : this.cx + 220, compact ? y + 18 : y, 'UNEQUIP', () =>
          this.unequip(slot),
        { width: 110, height: 36, fontSize: 14 });
      }
    });

    const invY = 184 + SLOTS.length * (compact ? 52 : 40) + 24;
    addText(this, this.cx, invY, `Stored items (${this.gameState.inventory.length})`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    this.gameState.inventory.forEach((item: Equipment, i: number) => {
      const y = invY + 40 + i * (compact ? 52 : 40);
      addText(
        this,
        compact ? this.cx : this.cx - 240,
        compact ? y - 18 : y,
        `${item.name} · ${this.describe(item)} (${this.slotLabel(item.slot)})`,
        { fontSize: '15px' },
      ).setOrigin(compact ? 0.5 : 0, 0.5);
      this.button(compact ? this.cx : this.cx + 220, compact ? y + 18 : y, 'EQUIP', () =>
        this.equip(item),
      {
        width: 110,
        height: 36,
        fontSize: 14,
        hover: () => tip.show(this.cx, y - 40, this.preview(fighter, item)),
        blur: () => tip.hide(),
      });
    });
  }

  private shiftFighter(delta: number): void {
    const n = this.gameState.roster.length;
    if (n <= 1) return;
    this.fighterIndex = (this.fighterIndex + delta + n) % n;
    this.render();
  }

  private slotLabel(slot: EquipmentSlot): string {
    switch (slot) {
      case 'head':
        return 'Head';
      case 'torso':
        return 'Torso';
      case 'leftArm':
        return 'Left arm';
      case 'rightArm':
        return 'Right arm';
      case 'legs':
        return 'Legs';
      case 'mainHand':
        return 'Main hand';
      case 'offHand':
        return 'Off hand';
    }
  }

  private describe(item: Equipment): string {
    if (item.armor > 0) return `armor ${item.armor}`;
    if (item.minDamage !== undefined) return `dmg ${item.minDamage}-${item.maxDamage}`;
    return `block ${item.blockChance}%`;
  }

  private preview(fighter: Fighter, item: Equipment): string {
    const equipped = fighter.loadout[item.slot];
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

  private equip(item: Equipment): void {
    const fighter = this.gameState.roster[this.fighterIndex];
    const previous = fighter.loadout[item.slot];
    const next = equipItem(fighter, item);
    const roster = [...this.gameState.roster];
    roster[this.fighterIndex] = next;
    let inventory = this.gameState.inventory.filter((i) => i.id !== item.id);
    if (previous) inventory = [...inventory, previous];
    this.gameState = { ...this.gameState, roster, inventory };
    this.render();
  }

  private unequip(slot: EquipmentSlot): void {
    const fighter = this.gameState.roster[this.fighterIndex];
    const item = fighter.loadout[slot];
    const next = unequipItem(fighter, slot);
    const roster = [...this.gameState.roster];
    roster[this.fighterIndex] = next;
    this.gameState = {
      ...this.gameState,
      roster,
      inventory: item ? [...this.gameState.inventory, item] : this.gameState.inventory,
    };
    this.render();
  }
}
