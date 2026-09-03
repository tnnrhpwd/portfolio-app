import type { Equipment, EquipmentSlot } from './types';
import type { GameState } from './engine';
import type { Rng } from './rng';
import { pick } from './rng';
import { createEquipment } from './equipment';

const STOCK_SLOTS: readonly EquipmentSlot[] = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'legs',
  'mainHand',
  'offHand',
];

/** Rolls `count` items for a city-tier shop (tier 0..9, higher = better & pricier). */
export function generateShopStock(tier: number, count: number, rand: Rng = Math.random): Equipment[] {
  const items: Equipment[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = pick(STOCK_SLOTS, rand);
    const itemTier = Math.max(0, Math.min(9, tier + Math.floor(rand() * 2)));
    items.push(createEquipment(slot, itemTier, { rand }));
  }
  return items;
}

/** Gold price for an item (tier + quality + affixes). */
export function itemPrice(item: Equipment): number {
  return Math.round((40 + item.tier * 80) * item.quality + item.affixCount * 25);
}

/** Buys an item into inventory. Returns a new state; throws if unaffordable. */
export function buyItem(state: GameState, item: Equipment): GameState {
  const price = itemPrice(item);
  if (state.gold < price) throw new Error('Not enough gold');
  return { ...state, gold: state.gold - price, inventory: [...state.inventory, item] };
}

/** Sells an inventory item for half its shop price. Returns a new state. */
export function sellItem(state: GameState, item: Equipment): GameState {
  const price = sellPrice(item);
  return {
    ...state,
    gold: state.gold + price,
    inventory: state.inventory.filter((i) => i.id !== item.id),
  };
}

/** Gold refunded when selling an item (50% of its shop price). */
export function sellPrice(item: Equipment): number {
  return Math.max(1, Math.floor(itemPrice(item) / 2));
}
