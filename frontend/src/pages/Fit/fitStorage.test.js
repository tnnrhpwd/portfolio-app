import { buildPlan } from './fitProgram';
import {
  FIT_STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  allTraining,
  bodyWeightChange,
  bodyWeightSeries,
  buildDraft,
  coachPayload,
  convertWeight,
  createEmptyState,
  createRun,
  createSessionFromDraft,
  currentWeekProgress,
  dataReadout,
  draftTimedEntries,
  estimateOneRepMax,
  exercisePRs,
  formatDateLabel,
  formatWeight,
  fromKilograms,
  latestCheckIn,
  loadFitState,
  median,
  nextRotationDay,
  normalizeState,
  parseDate,
  recentRunDistance,
  recommendedSettings,
  rotationIndexAfter,
  runTotals,
  saveFitState,
  sessionCardioMinutes,
  sessionSetCount,
  sessionVolume,
  summarizeDraft,
  tidyDraft,
  toKilograms,
  totalVolume,
  upsertCheckIn,
  weekStart,
  weeklyRunSeries,
  weeklyStreak,
  weeklyVolumeSeries,
} from './fitStorage';

// ── Fixtures ─────────────────────────────────────────────────────────────
const lift = (exerciseId, name, sets, extra = {}) => ({ exerciseId, name, kind: 'lift', muscle: 'chest', sets, ...extra });
const cardio = (exerciseId, name, minutes, done = true) => ({
  exerciseId,
  name,
  kind: 'cardio',
  muscle: 'cardio',
  minutes,
  done,
});

const session = (date, blocks, extra = {}) => ({
  id: `s-${date}-${Math.random().toString(36).slice(2, 6)}`,
  date,
  dayId: 'd1',
  dayName: 'Push',
  focus: 'Chest · Shoulders · Triceps',
  unit: 'kg',
  durationMin: 45,
  rpe: '',
  notes: '',
  blocks,
  ...extra,
});

const run = (date, distance, minutes, extra = {}) => ({ id: `r-${date}`, date, distance, unit: 'km', minutes, ...extra });
const checkIn = (date, weight, unit = 'kg') => ({ date, weight, unit });

const withSessions = (sessions, extra = {}) => ({ ...createEmptyState(), sessions, ...extra });

// 2026-09-09 is a Wednesday, so its week starts Monday 2026-09-07.
const NOW = new Date('2026-09-09T12:00:00');

describe('unit conversion', () => {
  it('converts between kilograms and pounds', () => {
    expect(toKilograms(100, 'kg')).toBe(100);
    expect(toKilograms(100, 'lb')).toBeCloseTo(45.359, 3);
    expect(fromKilograms(45.359237, 'lb')).toBeCloseTo(100, 3);
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.5, 1);
    expect(convertWeight(45.4, 'lb', 'kg')).toBeCloseTo(20.6, 1);
    expect(convertWeight(60, 'kg', 'kg')).toBe(60);
  });

  it('formats a weight without trailing noise', () => {
    expect(formatWeight(60, 'kg')).toBe('60 kg');
    expect(formatWeight(62.5, 'kg')).toBe('62.5 kg');
    expect(formatWeight(0, 'lb')).toBe('0 lb');
  });
});

describe('dates', () => {
  it('parses a stored date-only string as a local date, not UTC midnight', () => {
    // The regression this guards: new Date('2026-09-07') is 2026-09-06 19:00 in
    // US Central, which silently moved a session into the previous week.
    const parsed = parseDate('2026-09-07');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(7);
    expect(parsed.getHours()).toBe(0);
    expect(parseDate(new Date('2026-09-07T00:00:00')).getDate()).toBe(7);
  });

  it('treats Monday as the start of the week', () => {
    expect(weekStart(new Date('2026-09-09T12:00:00')).getDay()).toBe(1);
    expect(weekStart(new Date('2026-09-13T12:00:00')).getDate()).toBe(7); // Sunday belongs to the week before
    expect(formatDateLabel('2026-09-07')).toEqual(expect.stringMatching(/\w/));
    expect(formatDateLabel('not-a-date')).toBe('—');
  });

  it('computes a median, and null for nothing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([undefined, 'x'])).toBeNull();
  });
});

describe('estimated one-rep max', () => {
  it('uses Epley, so a heavy triple and a set of ten can be compared', () => {
    expect(estimateOneRepMax(100, 1)).toBeCloseTo(103.3, 1);
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.7, 1);
    expect(estimateOneRepMax(50, 10)).toBeCloseTo(66.7, 1);
  });

  it('returns 0 for anything that was not actually performed', () => {
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(estimateOneRepMax(undefined, undefined)).toBe(0);
  });
});

describe('session totals', () => {
  const block = {
    type: 'lift',
    title: 'Main lifts',
    entries: [
      lift('bench', 'Barbell bench press', [
        { reps: 8, weight: 80, done: true },
        { reps: 8, weight: 80, done: true },
        { reps: 8, weight: 80, done: false },
      ]),
      lift('ohp', 'Overhead press', [{ reps: 10, weight: 0, done: true }]),
    ],
  };

  it('counts volume from completed sets only', () => {
    expect(sessionVolume(session('2026-09-09', [block]), 'kg')).toBe(1280);
  });

  it('counts sets from completed sets only, and never counts cardio as a set', () => {
    const s = session('2026-09-09', [
      block,
      { type: 'cardio', title: 'Finisher', entries: [cardio('intervals-bike', 'Bike intervals', 12)] },
    ]);
    expect(sessionSetCount(s)).toBe(3);
    expect(sessionCardioMinutes(s)).toBe(12);
  });

  it('ignores cardio that was skipped', () => {
    const s = session('2026-09-09', [
      { type: 'cardio', title: 'Finisher', entries: [cardio('intervals-bike', 'Bike intervals', 12, false)] },
    ]);
    expect(sessionCardioMinutes(s)).toBe(0);
  });

  it('converts a pounds session into kilograms and back for the total', () => {
    const s = session(
      '2026-09-09',
      [{ type: 'lift', title: 'Main lifts', entries: [lift('bench', 'Bench', [{ reps: 5, weight: 185, done: true }])] }],
      { unit: 'lb' }
    );
    expect(sessionVolume(s, 'kg')).toBe(420); // 185 lb × 5 = 925 lb ≈ 419.6 kg
    expect(sessionVolume(s, 'lb')).toBe(925);
  });

  it('sums across every logged session', () => {
    expect(totalVolume([session('2026-09-07', [block]), session('2026-09-08', [block])], 'kg')).toBe(2560);
  });

  it('summarises a draft before it is saved', () => {
    expect(summarizeDraft({ unit: 'kg', blocks: [block] })).toEqual({ sets: 3, volume: 1280, cardioMinutes: 0, exercises: 2 });
    expect(summarizeDraft(null)).toEqual({ sets: 0, volume: 0, cardioMinutes: 0, exercises: 0 });
  });
});

describe('training days include runs', () => {
  it('counts a run as a training day, because it is one', () => {
    const state = { ...createEmptyState(), sessions: [session('2026-09-07', [])], runs: [run('2026-09-08', 5, 30)] };
    expect(allTraining(state)).toHaveLength(2);
    expect(currentWeekProgress(allTraining(state), 2, NOW).onTrack).toBe(true);
  });

  it('counts a run towards the weekly streak', () => {
    const state = {
      ...createEmptyState(),
      sessions: [session('2026-09-07', [])],
      runs: [run('2026-09-08', 5, 30), run('2026-09-02', 4, 24), run('2026-08-31', 6, 36)],
    };
    expect(weeklyStreak(allTraining(state), 2, NOW)).toBe(2);
  });
});

describe('weeks, targets, and streaks', () => {
  it('tracks progress against this week only', () => {
    const sessions = [session('2026-09-07', []), session('2026-09-09', []), session('2026-08-31', [])];
    expect(currentWeekProgress(sessions, 3, NOW)).toEqual({
      done: 2,
      target: 3,
      remaining: 1,
      ratio: 2 / 3,
      onTrack: false,
    });
    expect(currentWeekProgress(sessions, 2, NOW).onTrack).toBe(true);
    expect(currentWeekProgress([], 0, NOW).target).toBe(1);
  });

  it('counts consecutive weeks that hit the target', () => {
    const sessions = [
      session('2026-09-07', []),
      session('2026-09-08', []),
      session('2026-08-31', []),
      session('2026-09-02', []),
      session('2026-08-24', []),
      session('2026-08-26', []),
      session('2026-08-17', []),
      session('2026-08-10', []),
      session('2026-08-12', []),
    ];
    expect(weeklyStreak(sessions, 2, NOW)).toBe(3);
  });

  it('does not let an unfinished current week break the streak', () => {
    const sessions = [session('2026-08-31', []), session('2026-09-02', []), session('2026-09-07', [])];
    expect(weeklyStreak(sessions, 2, NOW)).toBe(1);
  });

  it('returns no streak when the target is nonsense', () => {
    expect(weeklyStreak([session('2026-09-07', [])], 0, NOW)).toBe(0);
  });

  it('builds an oldest-to-newest weekly volume series', () => {
    const sessions = [
      session('2026-09-07', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 10, done: true }])] },
      ]),
      session('2026-09-08', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 20, done: true }])] },
      ]),
    ];
    const series = weeklyVolumeSeries(sessions, 3, 'kg', NOW);
    expect(series).toHaveLength(3);
    expect(series[2].isCurrent).toBe(true);
    expect(series[0].volume).toBe(0);
    expect(series[2].volume).toBe(300);
    expect(series[2].sessions).toBe(2);
  });
});

describe('personal records', () => {
  const sessions = [
    session('2026-09-01', [
      { type: 'lift', title: 'Main lifts', entries: [lift('bench', 'Bench press', [{ reps: 5, weight: 100, done: true }])] },
    ]),
    session('2026-09-08', [
      {
        type: 'lift',
        title: 'Main lifts',
        entries: [
          lift('bench', 'Bench press', [
            { reps: 10, weight: 80, done: true },
            { reps: 3, weight: 110, done: true },
          ]),
          lift('squat', 'Back squat', [{ reps: 5, weight: 140, done: true }]),
        ],
      },
    ]),
  ];

  it('separates the heaviest set from the best estimated 1RM', () => {
    const bench = exercisePRs(sessions, 'kg').find((record) => record.exerciseId === 'bench');
    expect(bench.bestWeight).toBe(110);
    expect(bench.bestWeightReps).toBe(3);
    expect(bench.bestE1rm).toBeCloseTo(121, 1);
    expect(bench.bestE1rmReps).toBe(3);
    expect(bench.totalSets).toBe(3);
    expect(bench.sessions).toBe(2);
    expect(bench.lastDate).toBe('2026-09-08');
  });

  it('ranks records by estimated 1RM', () => {
    expect(exercisePRs(sessions, 'kg').map((record) => record.exerciseId)).toEqual(['squat', 'bench']);
  });

  it('honours the requested display unit', () => {
    expect(exercisePRs(sessions, 'lb')[0].bestWeight).toBeCloseTo(308.6, 1);
  });

  it('skips movements that were never completed', () => {
    const empty = session('2026-09-08', [
      { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 5, weight: 100, done: false }])] },
    ]);
    expect(exercisePRs([empty], 'kg')).toEqual([]);
    expect(exercisePRs([], 'kg')).toEqual([]);
  });
});

describe('running storage', () => {
  it('creates a run with sane defaults and coerced numbers', () => {
    const created = createRun({ distance: '5.234', minutes: '30.44', effort: '', pain: 'shin' });
    expect(created.distance).toBe(5.23);
    expect(created.minutes).toBe(30.4);
    expect(created.effort).toBeNull();
    expect(created.pain).toBe('shin');
    expect(created.unit).toBe('km');
    expect(created.id).toEqual(expect.stringMatching(/^run-/));
  });

  it('totals distance, time, count, and the longest run', () => {
    const runs = [run('2026-09-01', 5, 30), run('2026-09-04', 8, 48), run('2026-09-06', 3, 18)];
    expect(runTotals(runs, 'km')).toEqual({ distance: 16, minutes: 96, count: 3, longest: 8 });
    expect(runTotals([], 'km')).toEqual({ distance: 0, minutes: 0, count: 0, longest: 0 });
  });

  it('ignores runs logged in a different unit', () => {
    expect(runTotals([run('2026-09-01', 5, 30), { ...run('2026-09-02', 3, 20), unit: 'mi' }], 'km').count).toBe(1);
  });

  it('charts distance per week and flags the current one', () => {
    const runs = [run('2026-09-07', 5, 30), run('2026-09-08', 4, 24), run('2026-08-31', 10, 60)];
    const series = weeklyRunSeries(runs, 3, 'km', NOW);
    expect(series[2].distance).toBe(9);
    expect(series[2].isCurrent).toBe(true);
    expect(series[1].distance).toBe(10);
    expect(series[0].distance).toBe(0);
  });

  it('reports distance in the last 7 days for the 10% rule', () => {
    const runs = [run('2026-09-08', 5, 30), run('2026-09-02', 4, 24), run('2026-08-01', 12, 70)];
    expect(recentRunDistance(runs, 7, NOW)).toBe(9);
  });
});

describe('body weight check-ins', () => {
  it('keeps one check-in per day, newest wins', () => {
    let checkIns = upsertCheckIn([], checkIn('2026-09-08', 82));
    checkIns = upsertCheckIn(checkIns, checkIn('2026-09-09', 81.5));
    checkIns = upsertCheckIn(checkIns, checkIn('2026-09-08', 82.4));
    expect(checkIns).toHaveLength(2);
    expect(checkIns.find((item) => item.date === '2026-09-08').weight).toBe(82.4);
  });

  it('ignores an empty entry rather than storing a zero', () => {
    expect(upsertCheckIn([], { date: '2026-09-09', weight: '' })).toEqual([]);
    expect(upsertCheckIn([], null)).toEqual([]);
  });

  it('finds the newest check-in whatever order they arrive in', () => {
    const checkIns = [checkIn('2026-09-01', 84), checkIn('2026-09-09', 81)];
    expect(latestCheckIn(checkIns).weight).toBe(81);
    expect(latestCheckIn([])).toBeNull();
  });

  it('charts the last recorded weight per week, converted to the display unit', () => {
    const checkIns = [checkIn('2026-09-07', 80), checkIn('2026-09-09', 79.5), checkIn('2026-08-31', 81)];
    const series = bodyWeightSeries(checkIns, 3, 'kg', NOW);
    expect(series[2].weight).toBe(79.5);
    expect(series[1].weight).toBe(81);
    expect(series[0].weight).toBeNull();
  });

  it('reports the 30-day change, and null when there is nothing to compare', () => {
    const checkIns = [checkIn('2026-08-15', 84), checkIn('2026-09-09', 81.6)];
    expect(bodyWeightChange(checkIns, 30, 'kg', NOW)).toBe(-2.4);
    expect(bodyWeightChange([checkIn('2026-09-09', 81)], 30, 'kg', NOW)).toBeNull();
    expect(bodyWeightChange([], 30, 'kg', NOW)).toBeNull();
  });
});

describe('rotation', () => {
  const plan = buildPlan({ daysPerWeek: 3 }, 1);

  it('returns the day the plan suggests next, and wraps', () => {
    expect(nextRotationDay(plan, 0).name).toBe('Push');
    expect(nextRotationDay(plan, 2).name).toBe('Legs');
    expect(nextRotationDay(plan, 3).name).toBe('Push');
    expect(nextRotationDay(null, 2)).toBeNull();
  });

  it('advances to the day after the one that was logged', () => {
    expect(rotationIndexAfter(plan, plan.days[0].id, 0)).toBe(1);
    expect(rotationIndexAfter(plan, plan.days[2].id, 0)).toBe(0);
    expect(rotationIndexAfter(null, 'd1', 4)).toBe(0);
  });
});

describe('buildDraft', () => {
  const plan = buildPlan({ goal: 'muscle', daysPerWeek: 3, equipment: ['gym', 'barbell'] }, 21);
  const pushDay = plan.days[0];
  const liftItem = pushDay.blocks.find((block) => block.type === 'lift').items[0];

  it('mirrors the plan day, one editable entry per movement', () => {
    const draft = buildDraft(pushDay, [], 'kg', '2026-09-09');
    expect(draft.dayId).toBe(pushDay.id);
    expect(draft.dayName).toBe('Push');
    expect(draft.date).toBe('2026-09-09');
    expect(draft.unit).toBe('kg');
    expect(draft.durationMin).toBe(String(pushDay.estimatedMinutes));

    const entry = draft.blocks.find((block) => block.type === 'lift').entries[0];
    expect(entry.prescription).toBe(`${liftItem.sets} × ${liftItem.reps}`);
    expect(entry.sets).toHaveLength(liftItem.sets);
    expect(entry.restSeconds).toBe(liftItem.restSeconds);
  });

  it('starts with nothing ticked, so only confirmed work is counted', () => {
    const draft = buildDraft(pushDay, [], 'kg');
    draft.blocks.forEach((block) =>
      block.entries.forEach((entry) => {
        if (entry.kind === 'cardio') expect(entry.done).toBe(false);
        else entry.sets.forEach((set) => expect(set.done).toBe(false));
      })
    );
    expect(sessionSetCount(draft)).toBe(0);
  });

  it('pre-fills the reps from the plan even before any history exists', () => {
    const draft = buildDraft(pushDay, [], 'kg');
    const entry = draft.blocks.find((block) => block.type === 'lift').entries[0];
    // Top of the prescribed range: 6–8 → 8.
    entry.sets.forEach((set) => expect(Number(set.reps)).toBe(8));
  });

  it('pre-fills the weight from what you lifted last time, overriding the prescription', () => {
    const previous = session('2026-09-01', [
      {
        type: 'lift',
        title: 'Main lifts',
        entries: [lift(liftItem.exerciseId, liftItem.name, [{ reps: 6, weight: 92.5, done: true }])],
      },
    ]);
    const draft = buildDraft(pushDay, [previous], 'kg');
    const entry = draft.blocks.flatMap((block) => block.entries).find((item) => item.exerciseId === liftItem.exerciseId);
    entry.sets.forEach((set) => {
      expect(set.weight).toBe(92.5);
      expect(set.reps).toBe(6);
      expect(set.done).toBe(false);
    });
  });

  it('carries a timed hold’s seconds so the sheet can offer a timer', () => {
    const conditioning = buildPlan({ daysPerWeek: 4, equipment: ['gym'] }, 4).days[3];
    const draft = buildDraft(conditioning, [], 'kg');
    const holds = draftTimedEntries(draft);
    expect(holds.length).toBeGreaterThan(0);
    holds.forEach((entry) => {
      expect(entry.holdSeconds).toBeGreaterThan(0);
      expect(entry.timed).toBe(true);
    });
  });

  it('returns null for a missing day', () => {
    expect(buildDraft(null, [], 'kg')).toBeNull();
    expect(draftTimedEntries(null)).toEqual([]);
  });
});

describe('tidy and save', () => {
  it('drops rows that were neither ticked nor filled in', () => {
    const draft = {
      unit: 'kg',
      blocks: [
        {
          type: 'lift',
          title: 'Main lifts',
          entries: [
            lift('bench', 'Bench', [{ reps: '', weight: '', done: false }]),
            lift('squat', 'Squat', [{ reps: 5, weight: 100, done: true }]),
          ],
        },
      ],
    };
    const tidy = tidyDraft(draft);
    expect(tidy.blocks[0].entries).toHaveLength(1);
    expect(tidy.blocks[0].entries[0].exerciseId).toBe('squat');
  });

  it('stamps a saved session with an id, a timestamp, and a usable duration', () => {
    const draft = { ...buildDraft(buildPlan({ daysPerWeek: 3 }, 1).days[0], [], 'kg'), durationMin: '52' };
    const saved = createSessionFromDraft(draft);
    expect(saved.id).toEqual(expect.stringMatching(/^session-/));
    expect(saved.savedAt).toEqual(expect.any(String));
    expect(saved.dayName).toBe('Push');
    expect(saved.durationMin).toBe(52);

    expect(createSessionFromDraft({ ...draft, durationMin: '' }).durationMin).toBeNull();
  });
});

describe('normalizeState and migration', () => {
  it('starts empty with every collection present', () => {
    const state = createEmptyState();
    expect(state.sessions).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(state.checkIns).toEqual([]);
    expect(state.coach).toBeNull();
    expect(state.pain.area).toBe('none');
    expect(state.profile.equipment).toEqual(expect.any(Array));
  });

  it('migrates a v1 payload instead of discarding it', () => {
    const v1 = {
      version: 1,
      profile: { goal: 'strength', level: 'advanced', daysPerWeek: 5, sessionMinutes: 60, equipment: 'gym', units: 'lb' },
      units: 'lb',
      plan: buildPlan({ daysPerWeek: 5 }, 3),
      sessions: [session('2026-09-08', [])],
      rotationIndex: 2,
    };
    const migrated = normalizeState(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.profile.equipment).toEqual(['gym', 'barbell']);
    expect(migrated.units).toBe('lb');
    expect(migrated.sessions).toHaveLength(1);
    expect(migrated.rotationIndex).toBe(2);
    // Collections that did not exist in v1 arrive as empty, not undefined.
    expect(migrated.runs).toEqual([]);
    expect(migrated.checkIns).toEqual([]);
  });

  it('maps every v1 equipment string', () => {
    expect(normalizeState({ profile: { equipment: 'dumbbells' } }).profile.equipment).toEqual(['dumbbells']);
    expect(normalizeState({ profile: { equipment: 'bodyweight' } }).profile.equipment).toEqual([]);
  });

  it('degrades to the empty state on corrupt or partial data', () => {
    expect(normalizeState(null)).toEqual(createEmptyState());
    expect(normalizeState('nope')).toEqual(createEmptyState());

    const partial = normalizeState({ sessions: 'nope', plan: { days: 'no' }, pain: null });
    expect(partial.sessions).toEqual([]);
    expect(partial.plan).toBeNull();
    expect(partial.units).toBe('kg');
    expect(partial.pain.area).toBe('none');
    expect(partial.profile.goal).toEqual(expect.any(String));
  });
});

describe('localStorage round trip', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  const installStorage = (impl) => {
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: impl });
    } catch {
      globalThis.localStorage.getItem = impl.getItem;
      globalThis.localStorage.setItem = impl.setItem;
      globalThis.localStorage.removeItem = impl.removeItem;
    }
  };

  const memoryStorage = () => {
    const store = new Map();
    return {
      store,
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    };
  };

  let memory;

  beforeEach(() => {
    memory = memoryStorage();
    installStorage(memory);
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('starts empty when nothing has been saved', () => {
    expect(loadFitState()).toEqual(createEmptyState());
  });

  it('round-trips a plan, sessions, runs, and check-ins', () => {
    const state = {
      ...createEmptyState(),
      units: 'lb',
      rotationIndex: 2,
      plan: buildPlan({ daysPerWeek: 3 }, 1),
      sessions: [session('2026-09-09', [{ type: 'lift', title: 'A', entries: [] }])],
      runs: [run('2026-09-08', 5, 30)],
      checkIns: [checkIn('2026-09-09', 180, 'lb')],
    };
    saveFitState(state);

    const loaded = loadFitState();
    expect(loaded.units).toBe('lb');
    expect(loaded.rotationIndex).toBe(2);
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.runs).toHaveLength(1);
    expect(loaded.checkIns).toHaveLength(1);
    expect(loaded.plan.days).toHaveLength(3);
    expect(memory.store.has(FIT_STORAGE_KEY)).toBe(true);
  });

  it('reads the legacy key when the new one is absent', () => {
    memory.store.set(LEGACY_STORAGE_KEYS[0], JSON.stringify({ profile: { equipment: 'gym' }, sessions: [] }));
    const loaded = loadFitState();
    expect(loaded.profile.equipment).toEqual(['gym', 'barbell']);
  });

  it('reports success or failure instead of throwing when storage is unavailable', () => {
    installStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadFitState()).toEqual(createEmptyState());
    expect(saveFitState(createEmptyState())).toBe(false);
  });
});

describe('recommendedSettings', () => {
  it('says nothing until there is enough history to be honest about', () => {
    const result = recommendedSettings(withSessions([session('2026-09-07', [])]), NOW);
    expect(result.daysPerWeek).toBeNull();
    expect(result.sessionMinutes).toBeNull();
    expect(result.reasons.join(' ')).toMatch(/Log a few sessions/i);
  });

  it('recommends the days actually trained, not the days prescribed', () => {
    const sessions = [];
    // Three consecutive weeks at 4, 4 and 3 days — median 4.
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].forEach((date, index) =>
      sessions.push(session(date, [], { durationMin: 45 + index }))
    );
    ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'].forEach((date) => sessions.push(session(date, [], { durationMin: 40 })));
    ['2026-08-24', '2026-08-25', '2026-08-26'].forEach((date) => sessions.push(session(date, [], { durationMin: 50 })));

    const result = recommendedSettings(withSessions(sessions), NOW);
    expect(result.daysPerWeek).toBe(4);
    expect(result.reasons.join(' ')).toMatch(/averaged/i);
  });

  it('snaps the session length to a real option and clamps the week to 3–6', () => {
    const sessions = Array.from({ length: 7 }, (_, index) =>
      session(`2026-09-0${index + 1}`, [], { durationMin: 58 })
    );
    const result = recommendedSettings(withSessions(sessions), NOW);
    expect(result.sessionMinutes).toBe(60);
    expect(result.daysPerWeek).toBeLessThanOrEqual(6);
    expect(result.daysPerWeek).toBeGreaterThanOrEqual(3);
  });

  it('mentions completed sets per session when there are enough sessions', () => {
    const sessions = Array.from({ length: 4 }, (_, index) =>
      session(`2026-09-0${index + 1}`, [
        {
          type: 'lift',
          title: 'A',
          entries: [lift('bench', 'Bench', [{ reps: 5, weight: 60, done: true }, { reps: 5, weight: 60, done: true }])],
        },
      ])
    );
    expect(recommendedSettings(withSessions(sessions), NOW).reasons.join(' ')).toMatch(/2 sets per session/);
  });

  it('handles an entirely empty state', () => {
    expect(recommendedSettings(createEmptyState(), NOW).daysPerWeek).toBeNull();
  });
});

describe('dataReadout', () => {
  it('always reports this week, even with no other data at all', () => {
    const readout = dataReadout(createEmptyState(), null, NOW);
    expect(readout.map((item) => item.label)).toEqual(['This week']);
    expect(readout[0].value).toBe('0/4');
    expect(readout[0].note).toMatch(/session/i);
  });

  it('reports this week, the streak, and the volume trend', () => {
    const sessions = [
      session('2026-09-07', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 50, done: true }])] },
      ]),
      session('2026-08-31', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 50, done: true }])] },
      ]),
      session('2026-08-24', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 50, done: true }])] },
      ]),
      session('2026-08-17', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 50, done: true }])] },
      ]),
      session('2026-08-10', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 50, done: true }])] },
      ]),
      session('2026-08-03', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 100, done: true }])] },
      ]),
      session('2026-07-27', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 100, done: true }])] },
      ]),
      session('2026-07-20', [
        { type: 'lift', title: 'A', entries: [lift('bench', 'Bench', [{ reps: 10, weight: 100, done: true }])] },
      ]),
    ];
    const readout = dataReadout(withSessions(sessions, { plan: { weeklyTarget: 1 } }), null, NOW);
    const labels = readout.map((item) => item.label);
    expect(labels).toContain('This week');
    expect(labels).toContain('Volume trend');
    expect(readout.find((item) => item.label === 'Volume trend').value).toMatch(/^-/);
  });

  it('reports running, body-weight change, and a reported pain area', () => {
    const state = {
      ...createEmptyState(),
      runs: [run('2026-09-08', 5, 30)],
      checkIns: [checkIn('2026-08-15', 84), checkIn('2026-09-09', 81.6)],
      pain: { area: 'knee', severity: 3, timing: '', notes: '' },
    };
    const readout = dataReadout(state, null, NOW);
    const byLabel = Object.fromEntries(readout.map((item) => [item.label, item]));
    expect(byLabel.Running.value).toMatch(/5 km/);
    expect(byLabel['Body weight'].value).toBe('-2.4 kg');
    expect(byLabel['Pain reported'].value).toMatch(/knee 3\/10/);
  });

  it('explains when the prescribed weights come from entered lifts', () => {
    const state = withSessions([session('2026-09-08', [], { durationMin: 45 })]);
    const readout = dataReadout(state, { hasBodyWeight: true, hasEnteredLifts: true }, NOW);
    expect(readout.map((item) => item.label)).toContain('Weight source');
  });
});

describe('coachPayload', () => {
  const state = {
    ...createEmptyState(),
    units: 'kg',
    profile: { ...createEmptyState().profile, heightCm: 180, bodyWeight: 82, lifts: { bench: { weight: 90, reps: 5 } } },
    sessions: [
      session('2026-09-08', [
        {
          type: 'lift',
          title: 'Main lifts',
          entries: [lift('bench', 'Barbell bench press', [{ reps: 5, weight: 90, done: true }])],
        },
      ], { rpe: '8', notes: 'felt good' }),
    ],
    runs: [run('2026-09-07', 5, 30, { effort: 5, pain: '' })],
    checkIns: [checkIn('2026-09-09', 82)],
    pain: { area: 'knee', severity: '3', timing: 'the next day', notes: 'dull ache' },
  };

  it('sends the athlete’s own training in a bounded, flat shape', () => {
    const payload = coachPayload(state, { bodyWeight: 82 }, 'Should I deload?');
    expect(payload.profile.bodyWeight).toBe(82);
    expect(payload.profile.lifts.bench).toEqual({ weight: 90, reps: 5 });
    expect(payload.sessions[0]).toEqual({
      date: '2026-09-08',
      dayName: 'Push',
      sets: 1,
      volume: 450,
      cardioMinutes: 0,
      rpe: '8',
      notes: 'felt good',
    });
    expect(payload.runs[0]).toEqual({ date: '2026-09-07', distance: 5, unit: 'km', minutes: 30, effort: 5, pain: '' });
    expect(payload.checkIns).toEqual([{ date: '2026-09-09', weight: 82 }]);
    expect(payload.pain).toEqual({ area: 'knee', severity: 3, timing: 'the next day', notes: 'dull ache' });
    expect(payload.question).toBe('Should I deload?');
  });

  it('sends the load text so the advice can name a real number', () => {
    const plan = buildPlan({ daysPerWeek: 3, equipment: ['gym', 'barbell'] }, 42);
    plan.days[0].blocks[1].items[0].load = { kind: 'weight', text: '72.5 kg' };
    const payload = coachPayload({ ...state, plan }, { bodyWeight: 82 });
    expect(payload.plan.days[0].items[0]).toEqual(
      expect.objectContaining({ load: '72.5 kg', prescription: expect.stringMatching(/\d/) })
    );
  });

  it('represents "no pain" and an unset severity sensibly', () => {
    const payload = coachPayload({ ...createEmptyState(), pain: { area: 'none', severity: '', timing: '', notes: '' } });
    expect(payload.pain.severity).toBeNull();
    expect(payload.pain.area).toBe('none');
    expect(payload.plan.days).toEqual([]);
    expect(payload.sessions).toEqual([]);
  });

  it('caps how much history it sends', () => {
    const many = Array.from({ length: 60 }, (_, index) => session(`2026-07-${String((index % 28) + 1).padStart(2, '0')}`, []));
    const payload = coachPayload({ ...state, sessions: many });
    expect(payload.sessions.length).toBe(20);
    // Most recent first, so the coach reads the current block first.
    expect(payload.sessions[0].date >= payload.sessions[1].date).toBe(true);
  });
});

describe('body weight overrides the profile in the load context', () => {
  it('is visible through allTraining and the readout without extra plumbing', () => {
    const state = { ...createEmptyState(), checkIns: [checkIn('2026-09-09', 78)] };
    expect(latestCheckIn(state.checkIns).weight).toBe(78);
    expect(allTraining(state)).toEqual([]);
  });

  it('keeps the stored unit on each check-in', () => {
    const state = { ...createEmptyState(), checkIns: upsertCheckIn([], { date: '2026-09-09', weight: 180, unit: 'lb' }) };
    expect(state.checkIns[0].unit).toBe('lb');
  });
});
