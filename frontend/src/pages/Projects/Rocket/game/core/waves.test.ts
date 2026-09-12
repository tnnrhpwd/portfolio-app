import { TUNING } from './constants';
import { createRng } from './rng';
import {
  enemyHpFor,
  enemySpeedFor,
  generateWave,
  isBossWave,
  waveDurationMs,
} from './waves';
import { ENEMY_DEFS } from './tables';
import type { EnemyKind } from './types';

const kindsIn = (wave: number, seed = 7): EnemyKind[] => {
  const plan = generateWave(wave, createRng(seed));
  return [...new Set(plan.spawns.map((s) => s.kind))];
};

describe('wave shape', () => {
  it('opens gently: wave 1 is debris only', () => {
    // Mines, drones and gunships unlock later, so the first wave can teach movement.
    expect(kindsIn(1)).toEqual(['debris']);
  });

  it('unlocks each kind at its configured wave', () => {
    for (const [kind, from] of Object.entries(TUNING.unlockWave)) {
      if (kind === 'debris') continue;
      expect(kindsIn(from as number)).toContain(kind);
    }
  });

  it('flags a boss every Nth wave and no others', () => {
    for (let wave = 1; wave <= 15; wave++) {
      expect(isBossWave(wave)).toBe(wave % TUNING.bossEvery === 0);
    }
    expect(isBossWave(0)).toBe(false);
  });

  it('sends exactly one boss, plus escorts', () => {
    const plan = generateWave(TUNING.bossEvery, createRng(3));
    expect(plan.isBoss).toBe(true);
    expect(plan.spawns.filter((s) => s.kind === 'boss')).toHaveLength(1);
    expect(plan.spawns.length).toBeGreaterThan(1);
    expect(plan.durationMs).toBe(0); // a boss wave ends when the boss dies
  });

  it('caps the wave length', () => {
    expect(waveDurationMs(1)).toBe(TUNING.waveBaseMs);
    // 199 is deliberately not a boss wave (those last until the boss dies).
    expect(isBossWave(199)).toBe(false);
    expect(waveDurationMs(199)).toBe(TUNING.waveMaxMs);
  });

  it('schedules spawns in ascending time, inside the wave', () => {
    const plan = generateWave(8, createRng(11));
    let previous = -1;
    for (const spawn of plan.spawns) {
      expect(spawn.atMs).toBeGreaterThanOrEqual(previous);
      previous = spawn.atMs;
      expect(spawn.atMs).toBeLessThanOrEqual(plan.durationMs);
    }
  });

  it('escalates: later waves are heavier than early ones', () => {
    expect(generateWave(9, createRng(5)).threat).toBeGreaterThan(generateWave(1, createRng(5)).threat);
    expect(generateWave(12, createRng(5)).spawns.length).toBeGreaterThan(
      generateWave(2, createRng(5)).spawns.length,
    );
  });

  it('is deterministic for a given seed, and different across seeds', () => {
    const a = generateWave(6, createRng(99));
    const b = generateWave(6, createRng(99));
    const c = generateWave(6, createRng(100));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.spawns).not.toEqual(c.spawns);
  });

  it('never schedules absurd numbers of spawns', () => {
    for (let wave = 1; wave <= 60; wave++) {
      expect(generateWave(wave, createRng(wave)).spawns.length).toBeLessThanOrEqual(96);
    }
  });
});

describe('wave scaling', () => {
  it('grows enemy hull with the wave', () => {
    expect(enemyHpFor('asteroid', 10)).toBeGreaterThan(enemyHpFor('asteroid', 1));
    expect(enemyHpFor('asteroid', 1)).toBe(ENEMY_DEFS.asteroid.hp);
  });

  it('grows speed but caps it, so late waves stay readable', () => {
    expect(enemySpeedFor('asteroid', 5)).toBeGreaterThan(enemySpeedFor('asteroid', 1));
    const capped = enemySpeedFor('asteroid', 500);
    expect(capped).toBeCloseTo(ENEMY_DEFS.asteroid.speed * TUNING.maxSpeedMultiplier);
  });

  it('makes a boss the toughest thing on screen', () => {
    expect(enemyHpFor('boss', 5)).toBeGreaterThan(enemyHpFor('gunship', 5) * 3);
  });
});
