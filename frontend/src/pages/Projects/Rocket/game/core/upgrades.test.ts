import { TUNING } from './constants';
import { SHIPS, resolveShip, SHIP_ORDER } from './ships';
import {
  buyUpgrade,
  canAfford,
  createUpgradeLevels,
  deriveStats,
  isMaxed,
  MIN_FIRE_MS,
  nextCost,
  totalToMax,
  UPGRADES,
  UPGRADE_ORDER,
  upgradeCost,
} from './upgrades';
import type { UpgradeKey } from './types';

describe('ships', () => {
  it('exposes every ship with a unique sprite and key', () => {
    const sprites = SHIP_ORDER.map((k) => SHIPS[k].sprite);
    expect(new Set(sprites).size).toBe(sprites.length);
    for (const key of SHIP_ORDER) expect(SHIPS[key].key).toBe(key);
  });

  it('gives the starter ship away for free and charges for the others', () => {
    expect(SHIPS.scout.cost).toBe(0);
    for (const key of ['retro', 'hauler'] as const) expect(SHIPS[key].cost).toBeGreaterThan(0);
  });

  it('falls back to the starter for a missing or unknown key', () => {
    expect(resolveShip(null).key).toBe('scout');
    expect(resolveShip(undefined).key).toBe('scout');
    // A save written by an older build must not crash the game.
    expect(resolveShip('battlecruiser' as never).key).toBe('scout');
  });

  it('trades speed for survivability between ships', () => {
    expect(SHIPS.scout.speed).toBeGreaterThan(SHIPS.hauler.speed);
    expect(SHIPS.hauler.hull).toBeGreaterThan(SHIPS.scout.hull);
  });
});

describe('upgrade costs', () => {
  it('starts every upgrade at level 0', () => {
    const levels = createUpgradeLevels();
    for (const key of UPGRADE_ORDER) expect(levels[key]).toBe(0);
  });

  it('rises with each level', () => {
    for (const key of UPGRADE_ORDER) {
      const def = UPGRADES[key];
      for (let level = 1; level < def.maxLevel; level++) {
        expect(upgradeCost(key, level + 1)).toBeGreaterThan(upgradeCost(key, level));
      }
    }
  });

  it('reports Infinity and "maxed" past the last level', () => {
    const key: UpgradeKey = 'weapon';
    const max = UPGRADES[key].maxLevel;
    expect(upgradeCost(key, max + 1)).toBe(Number.POSITIVE_INFINITY);
    const maxed = { ...createUpgradeLevels(), weapon: max };
    expect(isMaxed(key, maxed)).toBe(true);
    expect(canAfford(key, maxed, 1_000_000)).toBe(false);
  });

  it('refuses a purchase you cannot afford, and one that is maxed', () => {
    const levels = createUpgradeLevels();
    expect(buyUpgrade(levels, 'damage', 0)).toBeNull();
    const maxed = { ...createUpgradeLevels(), luck: UPGRADES.luck.maxLevel };
    expect(buyUpgrade(maxed, 'luck', 1_000_000)).toBeNull();
  });

  it('deducts exactly the advertised cost', () => {
    const levels = createUpgradeLevels();
    const price = nextCost('damage', levels);
    const result = buyUpgrade(levels, 'damage', price + 7);
    expect(result).not.toBeNull();
    expect(result?.coins).toBe(7);
    expect(result?.spent).toBe(price);
    expect(result?.levels.damage).toBe(1);
  });

  it('does not mutate the levels it was handed', () => {
    const levels = createUpgradeLevels();
    buyUpgrade(levels, 'speed', 1000);
    expect(levels.speed).toBe(0);
  });

  it('totals a plausible long-run coin sink', () => {
    // A campaign should take many waves to max out, not one.
    expect(totalToMax()).toBeGreaterThan(800);
  });
});

describe('deriveStats', () => {
  const base = createUpgradeLevels();

  it('matches the ship\'s own numbers with no upgrades', () => {
    const stats = deriveStats(SHIPS.retro, base);
    expect(stats.maxHull).toBe(SHIPS.retro.hull);
    expect(stats.maxShield).toBe(0);
    expect(stats.barrels).toBe(1);
    expect(stats.damage).toBeCloseTo(TUNING.playerDamage * SHIPS.retro.damage);
  });

  it('adds a barrel per weapon level', () => {
    expect(deriveStats(SHIPS.retro, { ...base, weapon: 1 }).barrels).toBe(2);
    expect(deriveStats(SHIPS.retro, { ...base, weapon: 2 }).barrels).toBe(3);
  });

  it('never lets fire rate go below the floor', () => {
    const maxed = { ...base, fireRate: UPGRADES.fireRate.maxLevel };
    const stats = deriveStats(SHIPS.scout, maxed);
    expect(stats.fireMs).toBeGreaterThanOrEqual(MIN_FIRE_MS);
  });

  it('makes every upgrade improve exactly one axis', () => {
    const max = (key: UpgradeKey) => ({ ...base, [key]: UPGRADES[key].maxLevel });

    const plain = deriveStats(SHIPS.retro, base);
    expect(deriveStats(SHIPS.retro, max('damage')).damage).toBeGreaterThan(plain.damage);
    expect(deriveStats(SHIPS.retro, max('fireRate')).fireMs).toBeLessThan(plain.fireMs);
    expect(deriveStats(SHIPS.retro, max('hull')).maxHull).toBeGreaterThan(plain.maxHull);
    expect(deriveStats(SHIPS.retro, max('shield')).maxShield).toBeGreaterThan(plain.maxShield);
    expect(deriveStats(SHIPS.retro, max('speed')).speed).toBeGreaterThan(plain.speed);
    expect(deriveStats(SHIPS.retro, max('magnet')).magnetRadius).toBeGreaterThan(plain.magnetRadius);
    expect(deriveStats(SHIPS.retro, max('luck')).coinMultiplier).toBeGreaterThan(plain.coinMultiplier);
  });
});
