/**
 * Deterministic randomness for the game core.
 *
 * Every rule in the core that needs randomness accepts an `Rng` function so
 * that behavior is fully reproducible in tests and replays. `Rng` returns a
 * number in the half-open interval [0, 1).
 */
export type Rng = () => number;

/** Clamps a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Returns a seeded PRNG (mulberry32). Identical seeds produce identical sequences. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a uniformly random integer in [min, max] (inclusive). */
export function rollInt(min: number, max: number, rand: Rng = Math.random): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Picks a uniformly random element from a non-empty array. */
export function pick<T>(items: readonly T[], rand: Rng = Math.random): T {
  return items[Math.floor(rand() * items.length)];
}
