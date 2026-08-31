/**
 * petsService.test.js — unit tests for the pure simulation helpers in the
 * Pets feature. No network, no DynamoDB — only deterministic decay/mood/level
 * math so the game's rules stay locked down as the feature evolves.
 */

const {
  clamp,
  applyDecay,
  deriveMood,
  computeLevel,
} = require('../../services/petsService');

describe('petsService.clamp', () => {
  test('clamps into the 0–100 range', () => {
    expect(clamp(150)).toBe(100);
    expect(clamp(-20)).toBe(0);
    expect(clamp(57.49)).toBe(57.5);
  });
});

describe('petsService.applyDecay', () => {
  const NOW = Date.UTC(2026, 7, 31, 12, 0, 0); // fixed epoch ms
  const hourMs = 3600000;

  test('no decay when no time has elapsed', () => {
    const stats = { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100 };
    expect(applyDecay(stats, new Date(NOW).toISOString(), NOW)).toEqual(stats);
  });

  test('decays tracked stats linearly over time', () => {
    const stats = { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100 };
    const result = applyDecay(stats, new Date(NOW - 2 * hourMs).toISOString(), NOW);
    expect(result.hunger).toBeCloseTo(58, 5); // 70 - 6*2
    expect(result.happiness).toBeCloseTo(70, 5); // 80 - 5*2
    expect(result.energy).toBeCloseTo(72, 5); // 80 - 4*2
    expect(result.cleanliness).toBeCloseTo(79, 5); // 85 - 3*2
  });

  test('never decays a stat below zero', () => {
    const stats = { hunger: 5, happiness: 80, energy: 80, cleanliness: 85, health: 100 };
    const result = applyDecay(stats, new Date(NOW - 10 * hourMs).toISOString(), NOW);
    expect(result.hunger).toBe(0);
  });

  test('loses health while a tracked stat is critical', () => {
    const stats = { hunger: 0, happiness: 80, energy: 80, cleanliness: 85, health: 100 };
    const result = applyDecay(stats, new Date(NOW - 3 * hourMs).toISOString(), NOW);
    expect(result.health).toBeCloseTo(70, 5); // 100 - 10*3
  });

  test('regenerates health while thriving', () => {
    const stats = { hunger: 80, happiness: 80, energy: 80, cleanliness: 85, health: 50 };
    const result = applyDecay(stats, new Date(NOW - 2 * hourMs).toISOString(), NOW);
    expect(result.health).toBeCloseTo(62, 5); // 50 + 6*2
  });

  test('health never exceeds 100 when regenerating', () => {
    const stats = { hunger: 80, happiness: 80, energy: 80, cleanliness: 85, health: 99 };
    const result = applyDecay(stats, new Date(NOW - 5 * hourMs).toISOString(), NOW);
    expect(result.health).toBe(100);
  });
});

describe('petsService.deriveMood', () => {
  test('passed pets are always "passed"', () => {
    expect(deriveMood({ hunger: 50, happiness: 50, energy: 50, cleanliness: 50, health: 100 }, false)).toBe('passed');
  });

  test('critical health wins over everything else', () => {
    expect(deriveMood({ hunger: 0, happiness: 0, energy: 0, cleanliness: 0, health: 5 }, true)).toBe('critical');
  });

  test('sick at low health', () => {
    expect(deriveMood({ hunger: 50, happiness: 50, energy: 50, cleanliness: 50, health: 20 }, true)).toBe('sick');
  });

  test('starving beats lonely and dirty', () => {
    expect(deriveMood({ hunger: 0, happiness: 0, energy: 50, cleanliness: 0, health: 80 }, true)).toBe('starving');
  });

  test('ecstatic requires all stats high', () => {
    expect(deriveMood({ hunger: 90, happiness: 90, energy: 90, cleanliness: 90, health: 95 }, true)).toBe('ecstatic');
  });

  test('happy at moderately high stats', () => {
    expect(deriveMood({ hunger: 70, happiness: 70, energy: 50, cleanliness: 65, health: 90 }, true)).toBe('happy');
  });
});

describe('petsService.computeLevel', () => {
  test('starts at level 1 with zero progress', () => {
    expect(computeLevel(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 50 });
  });

  test('levels up every 50 XP', () => {
    expect(computeLevel(50)).toEqual({ level: 2, xpIntoLevel: 0, xpForLevel: 50 });
    expect(computeLevel(130)).toEqual({ level: 3, xpIntoLevel: 30, xpForLevel: 50 });
  });
});
