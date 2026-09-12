/**
 * Rocket — the run session.
 *
 * A module singleton, in the same spirit as the Coliseum store: the play, shop
 * and game-over scenes are separate Phaser scenes but they share one run, and
 * the run has to survive a scene switch (the shop is not a new game).
 *
 * The split that matters: `save` is permanent (coins, upgrades, ships), `world`
 * is this attempt (score, hull, wave). Coins are banked the instant they are
 * collected, so `save.coins` is always spendable in the shop.
 */

import { applyUpgrades, createWorld, startWave } from './core/engine';
import { buyUpgrade, nextCost, UPGRADES } from './core/upgrades';
import type { ShipKey, UpgradeKey, World } from './core/types';
import { loadSave, persistSave, recordRun, resetSave, unlockShip, type SaveData } from './save';

export interface RunSummary {
  score: number;
  wave: number;
  kills: number;
  coins: number;
  accuracy: number;
  msAlive: number;
}

interface Session {
  world: World | null;
  save: SaveData;
  /** Seeded per run so a run is reproducible from its number (useful in bug reports). */
  seed: number;
}

let session: Session | null = null;

function boot(): Session {
  return { world: null, save: loadSave(), seed: 0 };
}

export function getSession(): Session {
  if (!session) session = boot();
  return session;
}

export function getSave(): SaveData {
  return getSession().save;
}

function commit(save: SaveData): void {
  getSession().save = save;
  persistSave(save);
}

/** A fresh run on the saved ship/upgrades. Any previous run is discarded. */
export function startRun(seed = Math.floor(Math.random() * 0xffffff)): World {
  const s = getSession();
  s.seed = seed;
  s.world = createWorld({
    width: 1280,
    height: 720,
    ship: s.save.ship,
    levels: s.save.levels,
    seed,
  });
  return s.world;
}

export function currentWorld(): World | null {
  return getSession().world;
}

/** Advance the live run to the next wave (used when leaving the shop). */
export function advanceWave(): World | null {
  const world = getSession().world;
  if (!world) return null;
  startWave(world, world.wave + 1);
  return world;
}

/** Bank coins earned during play. Called on every coin/gem pickup. */
export function bankCoins(amount: number): void {
  if (amount <= 0) return;
  const s = getSession();
  commit({ ...s.save, coins: s.save.coins + amount });
}

export interface PurchaseResult {
  ok: boolean;
  reason?: 'maxed' | 'poor';
  spent?: number;
}

/**
 * Buy one level of an upgrade with banked coins. The change applies to the
 * *current* run immediately (that is the point of a mid-run shop) and is
 * permanent, so the next run starts stronger.
 */
export function purchase(key: UpgradeKey): PurchaseResult {
  const s = getSession();
  const levels = s.save.levels;
  if (levels[key] >= UPGRADES[key].maxLevel) return { ok: false, reason: 'maxed' };

  const result = buyUpgrade(levels, key, s.save.coins);
  if (!result) return { ok: false, reason: 'poor' };

  commit({ ...s.save, coins: result.coins, levels: result.levels });
  if (s.world) applyUpgrades(s.world, result.levels);
  return { ok: true, spent: result.spent };
}

export function priceOf(key: UpgradeKey): number {
  return nextCost(key, getSave().levels);
}

export function isMaxed(key: UpgradeKey): boolean {
  const s = getSession();
  return s.save.levels[key] >= UPGRADES[key].maxLevel;
}

/** Buy a ship and make it current. */
export function buyShip(key: ShipKey): boolean {
  const s = getSession();
  const next = unlockShip(s.save, key);
  if (!next) return false;
  commit(next);
  return true;
}

export function selectShip(key: ShipKey): void {
  const s = getSession();
  if (!s.save.unlockedShips.includes(key)) return;
  commit({ ...s.save, ship: key });
}

/** Fold the finished run into the permanent record and return the summary. */
export function finishRun(): RunSummary {
  const s = getSession();
  const world = s.world;
  const summary: RunSummary = {
    score: world?.score ?? 0,
    wave: world?.wave ?? 0,
    kills: world?.stats.kills ?? 0,
    coins: world?.coins ?? 0,
    accuracy: world && world.stats.shotsFired > 0 ? world.stats.shotsHit / world.stats.shotsFired : 0,
    msAlive: world?.stats.msAlive ?? 0,
  };

  commit(recordRun(s.save, { score: summary.score, wave: summary.wave, kills: summary.kills }));
  return summary;
}

/** Wipe all progress. Exposed from the menu behind a confirmation. */
export function wipeProgress(): SaveData {
  const fresh = resetSave();
  const s = getSession();
  s.save = fresh;
  s.world = null;
  return fresh;
}
