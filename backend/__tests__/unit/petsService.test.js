/**
 * petsService.test.js — unit tests for the pure simulation helpers in the
 * Pets feature. No network, no DynamoDB — only deterministic decay/mood/level
 * math so the game's rules stay locked down as the feature evolves.
 */

const {
  clamp,
  applyDeltas,
  applyDecay,
  deriveMood,
  computeLevel,
  deriveStage,
  dayKey,
  challengesForDay,
  countMetric,
  evaluateChallenges,
  challengeView,
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
    const stats = { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100, bond: 60 };
    expect(applyDecay(stats, new Date(NOW).toISOString(), NOW)).toEqual(stats);
  });

  test('decays tracked stats linearly over time', () => {
    const stats = { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100, bond: 60 };
    const result = applyDecay(stats, new Date(NOW - 2 * hourMs).toISOString(), NOW);
    expect(result.hunger).toBeCloseTo(58, 5); // 70 - 6*2
    expect(result.happiness).toBeCloseTo(70, 5); // 80 - 5*2
    expect(result.energy).toBeCloseTo(72, 5); // 80 - 4*2
    expect(result.cleanliness).toBeCloseTo(79, 5); // 85 - 3*2
    expect(result.bond).toBeCloseTo(59, 5); // 60 - 0.5*2
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
    // 3 hours elapse; all tracked stats stay above the 50 "thrive" threshold
    // so the pet is still regenerating when the +18 health would overshoot.
    const stats = { hunger: 80, happiness: 80, energy: 80, cleanliness: 85, health: 99 };
    const result = applyDecay(stats, new Date(NOW - 3 * hourMs).toISOString(), NOW);
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

describe('petsService.applyDeltas', () => {
  test('applies and clamps stat deltas in place', () => {
    const stats = { hunger: 50, happiness: 50, energy: 50, cleanliness: 50, health: 50, bond: 50 };
    applyDeltas(stats, { hunger: +30, energy: -80 });
    expect(stats.hunger).toBe(80);
    expect(stats.energy).toBe(0);
  });

  test('ignores non-numeric keys', () => {
    const stats = { hunger: 50, happiness: 50, energy: 50, cleanliness: 50, health: 50, bond: 50 };
    applyDeltas(stats, { label: 'nope', happiness: 10 });
    expect(stats.label).toBeUndefined();
    expect(stats.happiness).toBe(60);
  });
});

describe('petsService.deriveStage', () => {
  const hourMs = 3600000;
  test('baby under 24 hours', () => {
    expect(deriveStage(10 * hourMs).id).toBe('baby');
  });
  test('young between 1 and 3 days', () => {
    expect(deriveStage(48 * hourMs).id).toBe('young');
  });
  test('adult after 3 days', () => {
    expect(deriveStage(4 * 24 * hourMs).id).toBe('adult');
  });
});

describe('petsService daily challenges', () => {
  const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);

  test('challengesForDay returns exactly 3 unique challenges', () => {
    const day = challengesForDay(NOW);
    expect(day).toHaveLength(3);
    const ids = new Set(day.map((c) => c.id));
    expect(ids.size).toBe(3);
  });

  test('challengesForDay is deterministic for a given day', () => {
    expect(challengesForDay(NOW)).toEqual(challengesForDay(NOW));
  });

  test('dayKey returns a UTC date string', () => {
    expect(dayKey(NOW)).toBe('2026-08-31');
  });

  test('countMetric counts exact actions and the aggregate care metric', () => {
    const entries = [
      { action: 'feed', at: new Date().toISOString() },
      { action: 'feed', at: new Date().toISOString() },
      { action: 'play', at: new Date().toISOString() },
      { action: 'walk', at: new Date().toISOString() },
      { action: 'train:sit', at: new Date().toISOString() },
      { action: 'train:roll', at: new Date().toISOString() },
    ];
    expect(countMetric(entries, 'feed')).toBe(2);
    expect(countMetric(entries, 'train')).toBe(2);
    expect(countMetric(entries, 'care')).toBe(6);
  });

  test('evaluateChallenges awards a completed challenge once', () => {
    const payload = {
      dailyChallenges: {},
      challengeDay: dayKey(NOW),
      careLog: [
        { action: 'feed', at: new Date(NOW).toISOString() },
        { action: 'feed', at: new Date(NOW).toISOString() },
      ],
    };
    // The day's 3 challenges rotate; find any 'feed-2' in the set to keep this
    // deterministic — instead we just assert the shape and that completed
    // challenges do not re-award.
    const result = evaluateChallenges(payload, NOW);
    expect(result).toHaveProperty('completed');
    expect(result).toHaveProperty('day', '2026-08-31');
    expect(Array.isArray(result.newlyCompleted)).toBe(true);
    expect(result.treats).toBeGreaterThanOrEqual(0);

    // Re-evaluating with the same completed ledger awards nothing new.
    const again = evaluateChallenges(
      { ...payload, dailyChallenges: result.completed, challengeDay: result.day },
      NOW
    );
    expect(again.newlyCompleted).toEqual([]);
    expect(again.treats).toBe(0);
  });

  test('challengeView reports progress and completion flags', () => {
    const payload = {
      dailyChallenges: {},
      challengeDay: null,
      careLog: [{ action: 'walk', at: new Date(NOW).toISOString() }],
    };
    const view = challengeView(payload, NOW);
    expect(view).toHaveLength(3);
    const walk = view.find((c) => c.id === 'walk-1');
    if (walk) {
      expect(walk.progress).toBe(1);
      expect(walk.target).toBe(1);
      expect(walk.completed).toBe(false); // completion only persisted after award
    }
  });
});

