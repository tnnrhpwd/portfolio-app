/**
 * Rocket — the three playable ships.
 *
 * Deliberately differentiated by feel rather than by "better": the scout dodges,
 * the hauler tanks, the retro sits between. All three can finish any wave, so
 * unlocking one is a change of playstyle, not a power gate.
 */

import type { ShipDef, ShipKey } from './types';

export const SHIPS: Record<ShipKey, ShipDef> = {
  scout: {
    key: 'scout',
    name: 'Scout',
    blurb: 'Quick and nimble. Thin hull — trust your reflexes.',
    sprite: 'probe-rocket-1',
    hull: 3,
    speed: 1.22,
    damage: 0.85,
    fireRate: 1.25,
    cost: 0,
  },
  retro: {
    key: 'retro',
    name: 'Retro',
    blurb: 'The all-rounder. Balanced hull, punch and handling.',
    sprite: 'retro-rocket-1',
    hull: 4,
    speed: 1.0,
    damage: 1.0,
    fireRate: 1.0,
    cost: 120,
  },
  hauler: {
    key: 'hauler',
    name: 'Hauler',
    blurb: 'Heavy lifter. Slow, but it shrugs off hits and hits hard.',
    sprite: 'lifter-rocket-1',
    hull: 6,
    speed: 0.82,
    damage: 1.35,
    fireRate: 0.82,
    cost: 260,
  },
};

/** Menu order. */
export const SHIP_ORDER: ShipKey[] = ['scout', 'retro', 'hauler'];

export const DEFAULT_SHIP: ShipKey = 'scout';

export function shipDef(key: ShipKey): ShipDef {
  return SHIPS[key];
}

/** `null` key (or an unknown one) falls back to the scout. */
export function resolveShip(key: ShipKey | null | undefined): ShipDef {
  return SHIPS[key ?? DEFAULT_SHIP] ?? SHIPS[DEFAULT_SHIP];
}
