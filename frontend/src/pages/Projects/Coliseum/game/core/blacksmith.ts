import type { EquipmentSlot } from './types';
import type { GameState } from './engine';
import type { MetalId } from './equipment';
import type { Rng } from './rng';
import { createEquipment } from './equipment';

/** Metal id → item tier. */
export const METAL_TIER: Record<MetalId, number> = { bronze: 1, iron: 2, silver: 3, gold: 4 };

/** Gold cost to forge with a metal. */
export function forgeCost(metal: MetalId): number {
  return 60 + METAL_TIER[metal] * 40;
}

/**
 * Forges a crafted item (quality 1.3–1.6, up to 6 affixes), consuming gold and
 * one metal. Returns a new state; throws if unaffordable or out of the metal.
 */
export function forge(
  state: GameState,
  slot: EquipmentSlot,
  metal: MetalId,
  rand: Rng = Math.random,
): GameState {
  const cost = forgeCost(metal);
  if (state.gold < cost) throw new Error('Not enough gold');
  if ((state.metals[metal] ?? 0) < 1) throw new Error('No such metal');
  const item = createEquipment(slot, METAL_TIER[metal], { crafted: true, rand });
  return {
    ...state,
    gold: state.gold - cost,
    metals: { ...state.metals, [metal]: (state.metals[metal] ?? 0) - 1 },
    inventory: [...state.inventory, item],
  };
}
