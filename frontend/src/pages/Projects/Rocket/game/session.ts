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

import { applyUpgrades, createWorld, resizeWorld, startWave } from './core/engine';
import { buyUpgrade, nextCost, UPGRADES } from './core/upgrades';
import type { ShipKey, UpgradeKey, World } from './core/types';
import { cloudPushSave, isLoggedIn, submitScore, syncProgressToLocal } from './cloud';
import { loadSave, persistSave, recordRun, resetSave, unlockShip, type SaveData } from './save';
import { VIEW_HEIGHT, VIEW_WIDTH } from './ui/theme';

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

const CLOUD_PUSH_DELAY_MS = 4000;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSync: Promise<void> | null = null;

/**
 * Every save write goes through here, which is what makes cloud sync automatic:
 * the write is stamped (so the merge can tell which device is newer) and a push is
 * scheduled a few seconds later. Debouncing matters because coins are banked on
 * every pickup — without it a single wave would fire dozens of writes.
 */
function commit(save: SaveData): void {
  const stamped = { ...save, updatedAt: Date.now() };
  getSession().save = stamped;
  persistSave(stamped);
  scheduleCloudPush();
}

function scheduleCloudPush(): void {
  if (!isLoggedIn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void cloudPushSave(getSave());
  }, CLOUD_PUSH_DELAY_MS);
}

/**
 * Adopt the profile's progress into this device, once per game instance.
 *
 * Offline-first by design: if the profile is unreachable the local save simply
 * stands, and play is unaffected. Repeated calls share one attempt, so booting
 * twice (a rotation) does not re-pull.
 */
export function syncCloud(): Promise<void> {
  if (!cloudSync) {
    cloudSync = (async () => {
      const merged = await syncProgressToLocal(getSession().save);
      getSession().save = merged;
    })();
  }
  return cloudSync;
}

/**
 * Resolves once the boot sync has settled — immediately if it already has.
 *
 * Scenes read this instead of relying only on a change notification, because the
 * sync can finish before a scene exists: it would then render pre-merge numbers
 * and never hear about the merge at all ("signed in on a new device and still saw
 * zero coins").
 */
export function whenCloudSynced(): Promise<void> {
  return cloudSync ?? Promise.resolve();
}

/**
 * Publish a personal-best wave to the public leaderboard.
 *
 * Only on a new best: public rows cannot be edited, so re-submitting the same
 * wave every run would just pile up duplicates on the board.
 */
function maybeSubmitScore(summary: RunSummary): void {
  const save = getSave();
  if (summary.wave <= save.submittedWave) return;
  if (!isLoggedIn()) return;
  void (async () => {
    const published = await submitScore(summary.wave, summary.score);
    // Re-read the save: a run is 40 seconds of banked coins, and this resolves
    // well after `finishRun` returned.
    if (published) commit({ ...getSession().save, submittedWave: summary.wave });
  })();
}

/** A fresh run on the saved ship/upgrades. Any previous run is discarded. */
export function startRun(seed = Math.floor(Math.random() * 0xffffff)): World {
  const s = getSession();
  s.seed = seed;
  s.world = createWorld({
    // The arena is the shape of the active design box: speeds scale with the
    // height and spawn lanes with the width, so portrait is not a different game.
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    ship: s.save.ship,
    levels: s.save.levels,
    seed,
  });
  return s.world;
}

export function currentWorld(): World | null {
  return getSession().world;
}

/**
 * The run to carry into the current design box, or `null` when there is nothing
 * to resume.
 *
 * The game is destroyed and recreated when the device rotates, and this is what
 * puts the player back into the same arena afterwards. A finished run is not
 * resumable — rotating on the menu must not resurrect the run the player just
 * quit — so `null` sends the caller to a fresh run instead.
 */
export function fitRunToView(): World | null {
  const world = getSession().world;
  if (!world || world.status === 'dead') return null;
  if (world.width !== VIEW_WIDTH || world.height !== VIEW_HEIGHT) {
    resizeWorld(world, VIEW_WIDTH, VIEW_HEIGHT);
  }
  return world;
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

  // End the world as well. The game is rebuilt when the device rotates and boot
  // resumes a live run, so anything still marked 'running' comes back to life —
  // including a run the player deliberately quit. `dead` is the engine's "this
  // attempt is over" status, and it is what makes `fitRunToView` refuse it.
  if (world) world.status = 'dead';

  maybeSubmitScore(summary);
  return summary;
}

/** Wipe all progress. Exposed from the menu behind a confirmation. */
export function wipeProgress(): SaveData {
  const fresh = resetSave();
  const s = getSession();
  s.save = fresh;
  s.world = null;
  // Publish the wipe, or signing in elsewhere would bring the old progress back.
  scheduleCloudPush();
  return fresh;
}
