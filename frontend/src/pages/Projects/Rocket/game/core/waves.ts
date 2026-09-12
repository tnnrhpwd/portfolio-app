/**
 * Rocket — wave composition.
 *
 * A wave is a *schedule*, generated up front from the run's RNG: a list of
 * `{ atMs, kind, pattern, side }` entries the engine releases as time passes.
 * Generating it in one go (instead of rolling per frame) is what makes waves
 * assertable and lets the HUD show a threat estimate before the wave starts.
 */

import { TUNING } from './constants';
import { nextChance, nextFloat, nextInt, nextPick } from './rng';
import { ENEMY_DEFS } from './tables';
import type { EnemyKind, EnemyPattern, PendingSpawn, RngState } from './types';

export interface WavePlan {
  wave: number;
  isBoss: boolean;
  /** Ms the wave lasts; 0 for a boss wave, which ends when the boss dies. */
  durationMs: number;
  spawns: PendingSpawn[];
  /** Rough difficulty score (total enemy hull), for the HUD/menu. */
  threat: number;
}

/** Hard ceiling so a hacked save can't schedule 10,000 spawns. */
const MAX_SPAWNS = 96;

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % TUNING.bossEvery === 0;
}

export function waveDurationMs(wave: number): number {
  if (isBossWave(wave)) return 0;
  const raw = TUNING.waveBaseMs + TUNING.wavePerWaveMs * (wave - 1);
  return Math.min(TUNING.waveMaxMs, raw);
}

/** Enemy hull at a given wave. */
export function enemyHpFor(kind: EnemyKind, wave: number): number {
  const base = ENEMY_DEFS[kind].hp;
  return Math.round(base * (1 + TUNING.enemyHpGrowth * (wave - 1)));
}

/** Enemy speed multiplier at a given wave (capped so late waves stay playable). */
export function enemySpeedFor(kind: EnemyKind, wave: number): number {
  const mult = Math.min(
    TUNING.maxSpeedMultiplier,
    1 + TUNING.enemySpeedGrowth * (wave - 1),
  );
  return ENEMY_DEFS[kind].speed * mult;
}

/** Which kinds can appear at this wave, with spawn weights. */
function kindWeights(wave: number): Array<{ kind: EnemyKind; weight: number }> {
  const unlocked = (kind: EnemyKind): boolean => {
    const from = TUNING.unlockWave[kind as keyof typeof TUNING.unlockWave];
    return from === undefined || wave >= from;
  };

  const table: Array<{ kind: EnemyKind; weight: number }> = [
    { kind: 'debris', weight: 34 },
    { kind: 'asteroid', weight: 26 },
    { kind: 'mine', weight: 16 },
    { kind: 'drone', weight: 15 },
    { kind: 'gunship', weight: 9 },
  ];

  return table.filter((e) => unlocked(e.kind));
}

function pickKind(wave: number, rng: RngState): EnemyKind {
  const pool = kindWeights(wave);
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let roll = nextFloat(rng) * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }
  return pool[pool.length - 1].kind;
}

const PATTERNS: Record<EnemyKind, EnemyPattern[]> = {
  debris: ['drift', 'rush'],
  asteroid: ['drift', 'weave'],
  mine: ['drift', 'hover'],
  drone: ['strafe', 'weave'],
  gunship: ['hover', 'drift'],
  boss: ['hover'],
};

const SIDES: Array<PendingSpawn['side']> = ['left', 'center', 'right', 'random'];

/**
 * Build the schedule for one wave.
 *
 * Pacings: the gap between spawn events tightens with the wave but never below
 * ~380ms, and every event is jittered ±25% so waves don't arrive like a metronome.
 */
export function generateWave(wave: number, rng: RngState): WavePlan {
  const isBoss = isBossWave(wave);
  const durationMs = waveDurationMs(wave);
  const spawns: PendingSpawn[] = [];

  if (isBoss) {
    spawns.push({ atMs: 900, kind: 'boss', pattern: 'hover', side: 'center' });
    // A little chaff so the arena isn't empty while the boss is on screen.
    const escorts = Math.min(10, 3 + Math.floor(wave / 2));
    for (let i = 0; i < escorts; i++) {
      spawns.push({
        atMs: 2600 + i * 1800,
        kind: 'debris',
        pattern: 'drift',
        side: nextPick(rng, SIDES),
      });
    }
    return { wave, isBoss, durationMs, spawns, threat: enemyHpFor('boss', wave) + escorts * 6 };
  }

  const cadence = Math.max(380, 1180 - wave * 58);
  let at = 350;

  while (at < durationMs - 500 && spawns.length < MAX_SPAWNS) {
    const kind = pickKind(wave, rng);
    spawns.push({
      atMs: Math.round(at),
      kind,
      pattern: nextPick(rng, PATTERNS[kind]),
      side: nextPick(rng, SIDES),
    });
    // Occasional pair, so waves have a little texture.
    if (nextChance(rng, 0.18) && spawns.length < MAX_SPAWNS) {
      spawns.push({
        atMs: Math.round(at + nextInt(rng, 120, 260)),
        kind,
        pattern: nextPick(rng, PATTERNS[kind]),
        side: nextPick(rng, SIDES),
      });
    }
    at += cadence * (0.75 + nextFloat(rng) * 0.5);
  }

  const threat = spawns.reduce((sum, s) => sum + enemyHpFor(s.kind, wave), 0);
  return { wave, isBoss, durationMs, spawns, threat };
}
