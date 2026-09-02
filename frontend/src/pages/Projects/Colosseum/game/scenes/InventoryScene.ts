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
  constructor() {
    super('Inventory');
  }

  create(): void {
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

    const fighter = this.gameState.roster[0];
    const tip = createTooltip(this);
    const compact = this.compact;

    addText(this, this.cx, 100, `${fighter.name} — equipped gear`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    // Equipped loadout per slot.
    SLOTS.forEach((slot, i) => {
      const y = 150 + i * (compact ? 56 : 44);
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

    const invY = 150 + SLOTS.length * (compact ? 56 : 44) + 24;
    addText(this, this.cx, invY, `Stored items (${this.gameState.inventory.length})`, {
      fontSize: '20px',
      color: '#f2d98c',
    });

    this.gameState.inventory.forEach((item: Equipment, i: number) => {
      const y = invY + 44 + i * (compact ? 56 : 44);
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
    const next = equipItem(this.gameState.roster[0], item);
    this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    this.render();
  }

  private unequip(slot: EquipmentSlot): void {
    const next = unequipItem(this.gameState.roster[0], slot);
    this.gameState = { ...this.gameState, roster: [next, ...this.gameState.roster.slice(1)] };
    this.render();
  }
}
