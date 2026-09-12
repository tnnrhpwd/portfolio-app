/**
 * Rocket — deterministic RNG.
 *
 * The world carries its own generator state so a run is reproducible from a
 * seed. That is what makes wave composition and drop tables testable: assert
 * against a fixed seed instead of "whatever `Math.random` did today".
 *
 * mulberry32 — small, fast, and good enough for gameplay spread.
 */

import type { RngState } from './types';

export const DEFAULT_SEED = 0x5eed1234;

export function createRng(seed: number = DEFAULT_SEED): RngState {
  // Force to uint32 and avoid a zero state.
  const s = (seed >>> 0) || DEFAULT_SEED;
  return { s };
}

/** Uniform float in [0, 1). Advances the state. */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform float in [min, max). */
export function nextRange(rng: RngState, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

/** True with probability `p`. */
export function nextChance(rng: RngState, p: number): boolean {
  return nextFloat(rng) < p;
}

/** Pick one element. Throws on an empty list so a bad table fails loudly. */
export function nextPick<T>(rng: RngState, items: readonly T[]): T {
  if (!items.length) throw new Error('nextPick called with an empty list');
  return items[nextInt(rng, 0, items.length - 1)];
}
