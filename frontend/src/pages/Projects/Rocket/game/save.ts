/**
 * Rocket — persistent progress.
 *
 * Meta-progression model: **coins are banked the moment you collect them**, and
 * upgrades are permanent. Dying costs you your score and your wave, never your
 * progress — which is what makes a short run feel worth starting.
 *
 * `migrate` exists because this file is the one place an older build's data can
 * reach the current game: a save from a future/older version must be clamped
 * into range rather than trusted (a level of 99 would otherwise make every
 * number downstream nonsense).
 */

import { createUpgradeLevels, UPGRADES, UPGRADE_ORDER } from './core/upgrades';
import { DEFAULT_SHIP, SHIPS, SHIP_ORDER } from './core/ships';
import type { ShipKey, UpgradeKey, UpgradeLevels } from './core/types';

const STORAGE_KEY = 'rocket.save.v1';
const VERSION = 1;

export interface SaveData {
  version: number;
  bestScore: number;
  bestWave: number;
  /** Banked coins, spendable in the shop. */
  coins: number;
  levels: UpgradeLevels;
  unlockedShips: ShipKey[];
  ship: ShipKey;
  runs: number;
  kills: number;
}

function freshSave(): SaveData {
  return {
    version: VERSION,
    bestScore: 0,
    bestWave: 0,
    coins: 0,
    levels: createUpgradeLevels(),
    unlockedShips: [DEFAULT_SHIP],
    ship: DEFAULT_SHIP,
    runs: 0,
    kills: 0,
  };
}

const asCount = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const isShipKey = (value: unknown): value is ShipKey =>
  typeof value === 'string' && SHIP_ORDER.includes(value as ShipKey);

/** Coerce anything we find in storage into a valid, in-range save. */
export function migrate(raw: unknown): SaveData {
  const base = freshSave();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;

  const levels = createUpgradeLevels();
  const rawLevels = (data.levels ?? {}) as Record<string, unknown>;
  for (const key of UPGRADE_ORDER) {
    const value = asCount(rawLevels[key]);
    levels[key as UpgradeKey] = Math.min(UPGRADES[key].maxLevel, value);
  }

  const unlocked = new Set<ShipKey>([DEFAULT_SHIP]);
  if (Array.isArray(data.unlockedShips)) {
    for (const entry of data.unlockedShips) if (isShipKey(entry)) unlocked.add(entry);
  }

  const ship = isShipKey(data.ship) && unlocked.has(data.ship) ? data.ship : DEFAULT_SHIP;

  return {
    version: VERSION,
    bestScore: asCount(data.bestScore),
    bestWave: asCount(data.bestWave),
    coins: asCount(data.coins),
    levels,
    unlockedShips: SHIP_ORDER.filter((key) => unlocked.has(key)),
    ship,
    runs: asCount(data.runs),
    kills: asCount(data.kills),
  };
}

export function loadSave(): SaveData {
  if (typeof localStorage === 'undefined') return freshSave();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : freshSave();
  } catch {
    // Corrupt or unavailable storage must never stop the game booting.
    return freshSave();
  }
}

export function persistSave(data: SaveData): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked — the run still plays, it just won't be remembered */
  }
}

export function resetSave(): SaveData {
  const fresh = freshSave();
  persistSave(fresh);
  return fresh;
}

/** A ship is buyable when it is not owned and the bank covers its price. */
export function canUnlockShip(data: SaveData, key: ShipKey): boolean {
  return !data.unlockedShips.includes(key) && data.coins >= SHIPS[key].cost;
}

/** Buys a ship. Returns the updated save, or `null` if it was not allowed. */
export function unlockShip(data: SaveData, key: ShipKey): SaveData | null {
  if (!canUnlockShip(data, key)) return null;
  return {
    ...data,
    coins: data.coins - SHIPS[key].cost,
    unlockedShips: SHIP_ORDER.filter((s) => s === key || data.unlockedShips.includes(s)),
    ship: key,
  };
}

/** Records a finished run and banks anything it earned that wasn't banked live. */
export function recordRun(
  data: SaveData,
  run: { score: number; wave: number; kills: number },
): SaveData {
  return {
    ...data,
    bestScore: Math.max(data.bestScore, asCount(run.score)),
    bestWave: Math.max(data.bestWave, asCount(run.wave)),
    kills: data.kills + asCount(run.kills),
    runs: data.runs + 1,
  };
}
