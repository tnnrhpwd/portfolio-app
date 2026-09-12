/**
 * Rocket — the upgrade shop.
 *
 * Level 0 on every upgrade means "nothing bought", so `deriveStats` is a single
 * readable formula with no off-by-one sneakiness: level N buys exactly N steps
 * of whatever the upgrade does.
 */

import { TUNING } from './constants';
import type { DerivedStats, ShipDef, UpgradeDef, UpgradeKey, UpgradeLevels } from './types';

/** Cost growth per level. 1.8 makes late levels a real commitment. */
const COST_GROWTH = 1.8;

const costCurve =
  (base: number) =>
  (level: number): number =>
    Math.round(base * COST_GROWTH ** (level - 1));

export const UPGRADES: Record<UpgradeKey, UpgradeDef> = {
  weapon: {
    key: 'weapon',
    name: 'Weapon',
    blurb: 'Add a barrel. Widens your fire pattern.',
    maxLevel: 2,
    cost: costCurve(40),
    sprite: 'booster-fins-red',
  },
  damage: {
    key: 'damage',
    name: 'Damage',
    blurb: 'Each shot hurts more.',
    maxLevel: 5,
    cost: costCurve(12),
    sprite: 'plasma-ball-arcs',
  },
  fireRate: {
    key: 'fireRate',
    name: 'Fire rate',
    blurb: 'Shorter gap between shots.',
    maxLevel: 5,
    cost: costCurve(14),
    sprite: 'plasma-ball-blue',
  },
  hull: {
    key: 'hull',
    name: 'Hull',
    blurb: 'One more hit before you go down.',
    maxLevel: 5,
    cost: costCurve(20),
    sprite: 'capsule-module-grey',
  },
  shield: {
    key: 'shield',
    name: 'Shield',
    blurb: 'Absorbs a hit, then comes back on its own.',
    maxLevel: 5,
    cost: costCurve(18),
    sprite: 'shield-bubble-blue',
  },
  speed: {
    key: 'speed',
    name: 'Thrusters',
    blurb: 'Move faster.',
    maxLevel: 4,
    cost: costCurve(16),
    sprite: 'exhaust-trail-blue',
  },
  magnet: {
    key: 'magnet',
    name: 'Magnet',
    blurb: 'Pulls loot toward you from further away.',
    maxLevel: 3,
    cost: costCurve(10),
    sprite: 'orb-water',
  },
  luck: {
    key: 'luck',
    name: 'Prospector',
    blurb: 'Enemies drop more coins.',
    maxLevel: 3,
    cost: costCurve(18),
    sprite: 'gem-diamond-green',
  },
};

/** Shop display order (cheapest/most impactful first). */
export const UPGRADE_ORDER: UpgradeKey[] = [
  'damage',
  'fireRate',
  'weapon',
  'hull',
  'shield',
  'speed',
  'magnet',
  'luck',
];

export function createUpgradeLevels(): UpgradeLevels {
  return {
    weapon: 0,
    damage: 0,
    fireRate: 0,
    hull: 0,
    shield: 0,
    speed: 0,
    magnet: 0,
    luck: 0,
  };
}

/** Costs a level, clamping to the upgrade's maximum. */
export function upgradeCost(key: UpgradeKey, nextLevel: number): number {
  const def = UPGRADES[key];
  if (nextLevel < 1 || nextLevel > def.maxLevel) return Number.POSITIVE_INFINITY;
  return def.cost(nextLevel);
}

/** Cost of the next level, or Infinity when maxed. */
export function nextCost(key: UpgradeKey, levels: UpgradeLevels): number {
  return upgradeCost(key, levels[key] + 1);
}

export function isMaxed(key: UpgradeKey, levels: UpgradeLevels): boolean {
  return levels[key] >= UPGRADES[key].maxLevel;
}

export function canAfford(key: UpgradeKey, levels: UpgradeLevels, coins: number): boolean {
  return !isMaxed(key, levels) && coins >= nextCost(key, levels);
}

/**
 * Buys one level. Returns the new levels + remaining coins, or `null` when the
 * purchase is not allowed (maxed, or not enough coins). Returning `null` rather
 * than throwing keeps the caller honest: the UI can disable the button, but the
 * rule still holds if something calls it anyway.
 */
export function buyUpgrade(
  levels: UpgradeLevels,
  key: UpgradeKey,
  coins: number,
): { levels: UpgradeLevels; coins: number; spent: number } | null {
  if (!canAfford(key, levels, coins)) return null;
  const spent = nextCost(key, levels);
  return {
    levels: { ...levels, [key]: levels[key] + 1 },
    coins: coins - spent,
    spent,
  };
}

/** Minimum ms between shots, so stacked fire-rate upgrades can't melt the game. */
export const MIN_FIRE_MS = 72;

/**
 * Fold the chosen ship and purchased upgrades into the numbers the simulation
 * actually uses. Pure, so tests can assert exact values.
 */
export function deriveStats(ship: ShipDef, levels: UpgradeLevels): DerivedStats {
  const fireMs = Math.max(
    MIN_FIRE_MS,
    TUNING.fireMs / (ship.fireRate * (1 + 0.13 * levels.fireRate)),
  );

  return {
    damage: TUNING.playerDamage * ship.damage * (1 + 0.2 * levels.damage),
    fireMs,
    barrels: 1 + levels.weapon,
    maxHull: ship.hull + levels.hull,
    maxShield: levels.shield,
    speed: TUNING.playerSpeed * ship.speed * (1 + 0.08 * levels.speed),
    magnetRadius: TUNING.baseMagnetRadius * (1 + 0.4 * levels.magnet),
    coinMultiplier: 1 + 0.18 * levels.luck,
  };
}

/** Total coins required to max every upgrade — used by tests and the shop UI. */
export function totalToMax(): number {
  let total = 0;
  for (const key of UPGRADE_ORDER) {
    const def = UPGRADES[key];
    for (let level = 1; level <= def.maxLevel; level++) total += def.cost(level);
  }
  return total;
}
