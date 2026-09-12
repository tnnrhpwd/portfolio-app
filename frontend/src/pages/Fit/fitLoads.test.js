import { buildPlan, getExercise } from './fitProgram';
import {
  ANCHOR_LIFTS,
  ANCHOR_STANDARDS,
  applyLoads,
  buildLoadContext,
  describeContext,
  describeRunning,
  distanceUnitFor,
  formatDuration,
  formatPace,
  loadForItem,
  longestRun,
  paceFromRuns,
  planLoadSummary,
  roundDownTo,
  runAdvice,
  stepFor,
} from './fitLoads';

const PROFILE = {
  goal: 'muscle',
  level: 'intermediate',
  daysPerWeek: 4,
  sessionMinutes: 45,
  equipment: ['gym', 'barbell', 'running'],
  heightCm: 180,
  bodyWeight: 82,
  lifts: {},
};

const contextFor = (profile = PROFILE, checkIns = [], units = 'kg') => buildLoadContext({ profile, checkIns, units });

const itemFor = (exerciseId, overrides = {}) => ({
  exerciseId,
  name: getExercise(exerciseId)?.name,
  reps: '6–8',
  sets: 4,
  ...overrides,
});

describe('constants', () => {
  it('covers the five reference lifts the whole model hangs off', () => {
    expect(ANCHOR_LIFTS.map((lift) => lift.id)).toEqual(['bench', 'squat', 'deadlift', 'ohp', 'row']);
    expect(Object.keys(ANCHOR_STANDARDS).sort()).toEqual(['bench', 'deadlift', 'ohp', 'row', 'squat']);
  });

  it('orders the body-weight ratios beginner < intermediate < advanced', () => {
    Object.values(ANCHOR_STANDARDS).forEach((standard) => {
      expect(standard.beginner).toBeLessThan(standard.intermediate);
      expect(standard.intermediate).toBeLessThan(standard.advanced);
    });
  });
});

describe('rounding', () => {
  it('always rounds down, so the first session is not a test', () => {
    expect(roundDownTo(72.4, 2.5)).toBe(70);
    expect(roundDownTo(72.6, 2.5)).toBe(72.5);
    expect(roundDownTo(0, 2.5)).toBe(0);
    expect(roundDownTo(10, 0)).toBe(0);
    expect(roundDownTo(Number.NaN, 2.5)).toBe(0);
  });

  it('uses a smaller jump for dumbbells than for a barbell', () => {
    expect(stepFor({ step: 'barbell' }, 'kg')).toBe(2.5);
    expect(stepFor({ step: 'dumbbell' }, 'kg')).toBe(1);
    expect(stepFor({ step: 'barbell' }, 'lb')).toBe(5);
    expect(stepFor({ step: 'dumbbell' }, 'lb')).toBe(2.5);
    expect(stepFor(undefined, 'kg')).toBe(2.5);
  });
});

describe('buildLoadContext', () => {
  it('estimates every reference lift from body weight when nothing is entered', () => {
    const context = contextFor();
    expect(context.hasBodyWeight).toBe(true);
    expect(context.hasEnteredLifts).toBe(false);
    // 82 kg intermediate: bench 0.75, squat 1.1, deadlift 1.45.
    expect(Math.round(context.e1rmKg.bench)).toBe(62);
    expect(Math.round(context.e1rmKg.squat)).toBe(90);
    expect(Math.round(context.e1rmKg.deadlift)).toBe(119);
    expect(context.source.bench).toBe('bodyweight');
  });

  it('prefers a working set the athlete actually typed', () => {
    const context = contextFor({ ...PROFILE, lifts: { bench: { weight: 100, reps: 5 } } });
    // 100 × (1 + 5/30) = 116.7
    expect(Math.round(context.e1rmKg.bench)).toBe(117);
    expect(context.source.bench).toBe('entered');
    expect(context.hasEnteredLifts).toBe(true);
    // The lifts with nothing entered still fall back to body weight.
    expect(context.source.squat).toBe('bodyweight');
  });

  it('lets the newest check-in override the profile body weight', () => {
    const context = contextFor(PROFILE, [
      { date: '2026-08-01', weight: 90 },
      { date: '2026-09-08', weight: 78 },
    ]);
    expect(context.bodyWeight).toBe(78);
    expect(context.checkInCount).toBe(2);
  });

  it('reports honestly when it has nothing to work from', () => {
    const context = contextFor({ ...PROFILE, bodyWeight: '', lifts: {} });
    expect(context.hasBodyWeight).toBe(false);
    expect(context.e1rmKg.bench).toBeUndefined();
    expect(describeContext(context).join(' ')).toMatch(/Add your body weight/i);
  });

  it('keeps kilograms and pounds consistent', () => {
    const metric = contextFor({ ...PROFILE, bodyWeight: 82 }, [], 'kg');
    const imperial = contextFor({ ...PROFILE, bodyWeight: 181 }, [], 'lb');
    // 181 lb ≈ 82.1 kg — the estimate should land within a kilo of the metric one.
    expect(Math.abs(metric.e1rmKg.bench - imperial.e1rmKg.bench)).toBeLessThan(1.5);
  });

  it('summarises its assumptions in one readable line', () => {
    const lines = describeContext(contextFor(PROFILE, [{ date: '2026-09-08', weight: 80 }]));
    expect(lines.join(' ')).toMatch(/Estimated 1RM/);
    expect(lines.join(' ')).toMatch(/latest check-in \(80 kg\)/);
  });
});

describe('loadForItem', () => {
  it('puts a real number on a barbell lift, rounded down to a loadable weight', () => {
    const load = loadForItem(itemFor('bench'), contextFor());
    expect(load.kind).toBe('weight');
    expect(load.unit).toBe('kg');
    expect(load.perHand).toBe(false);
    // 62 kg e1RM at 8 reps → 62 / (1 + 8/30) = 49.5 → 47.5 on a barbell.
    expect(load.weight).toBe(47.5);
    expect(load.text).toBe('47.5 kg');
    expect(load.from).toBe('bodyweight');
  });

  it('halves a dumbbell movement and says so', () => {
    const load = loadForItem(itemFor('db-bench'), contextFor());
    expect(load.kind).toBe('weight');
    expect(load.perHand).toBe(true);
    expect(load.text).toMatch(/per hand$/);
    expect(load.weight).toBeGreaterThan(0);
    // Per hand has to be roughly half of the same movement done bilaterally.
    const barbell = loadForItem(itemFor('bench'), contextFor());
    expect(load.weight).toBeLessThan(barbell.weight);
  });

  it('scales an isolation exercise off its reference lift', () => {
    const context = contextFor();
    const anchor = loadForItem(itemFor('bench'), context);
    const accessory = loadForItem(itemFor('rope-pushdown'), context);
    expect(accessory.weight).toBeLessThan(anchor.weight);
    expect(accessory.weight).toBeGreaterThan(0);
  });

  it('explains every number it produces, in one line', () => {
    // The basis renders under every movement, so it has to stay short — the
    // rounding rule and the progression advice live in the day's block note.
    const withBodyWeight = loadForItem(itemFor('bench'), contextFor());
    expect(withBodyWeight.basis).toBe('bench press ≈ 75% of body weight · 8 reps');

    const derived = loadForItem(itemFor('rope-pushdown'), contextFor());
    expect(derived.basis).toBe('35% of bench press · 12 reps');

    const fromEntered = loadForItem(
      itemFor('bench'),
      contextFor({ ...PROFILE, lifts: { bench: { weight: 100, reps: 5 } } })
    );
    expect(fromEntered.basis).toBe('your bench press · 117 kg est. 1RM · 8 reps');
    expect(fromEntered.basis.length).toBeLessThan(60);
  });

  it('treats bodyweight and timed movements as their own kind of prescription', () => {
    const pushup = loadForItem(itemFor('pushup'), contextFor());
    expect(pushup.kind).toBe('bodyweight');
    expect(pushup.text).toBe('Bodyweight');
    expect(pushup.basis).toMatch(/bench/i); // the regression/progression note

    const plank = loadForItem(itemFor('plank', { holdSeconds: 45, restSeconds: 45 }), contextFor());
    expect(plank.kind).toBe('timed');
    expect(plank.seconds).toBe(45);
    expect(plank.basis).toMatch(/stop the set when the position breaks/i);
  });

  it('returns nothing rather than guessing when there is no basis', () => {
    expect(loadForItem(itemFor('bench'), contextFor({ ...PROFILE, bodyWeight: '' }))).toBeNull();
    expect(loadForItem(itemFor('bench'), null)).toBeNull();
    expect(loadForItem({ exerciseId: 'not-a-movement' }, contextFor())).toBeNull();
    expect(loadForItem(null, contextFor())).toBeNull();
  });

  it('respects the athlete’s unit', () => {
    const load = loadForItem(itemFor('bench'), contextFor({ ...PROFILE, bodyWeight: 181 }, [], 'lb'));
    expect(load.unit).toBe('lb');
    expect(load.text).toMatch(/lb$/);
    // A pound barbell moves in 5 lb jumps, so the number is always a multiple.
    expect(load.weight % 5).toBe(0);
  });
});

describe('applyLoads', () => {
  const plan = buildPlan({ ...PROFILE, equipment: ['gym', 'barbell', 'running'] }, 42);

  it('attaches a load to every weighted movement and leaves cardio alone', () => {
    const loaded = applyLoads(plan, contextFor());
    const items = loaded.days.flatMap((day) => day.blocks.flatMap((block) => block.items));
    const lifts = items.filter((item) => getExercise(item.exerciseId)?.load);
    expect(lifts.length).toBeGreaterThan(0);
    lifts.forEach((item) => {
      expect(item.load).toBeTruthy();
      expect(item.load.kind).toBe('weight');
    });
    items
      .filter((item) => item.timed && item.muscle === 'cardio')
      .forEach((item) => expect(item.load).toBeFalsy());
  });

  it('stamps where the weights came from, and refreshes the coaching notes', () => {
    const fromBodyWeight = applyLoads(plan, contextFor());
    expect(fromBodyWeight.weightsFrom).toBe('bodyweight');
    expect(fromBodyWeight.notes.join(' ')).toMatch(/estimated from your body weight/i);

    const fromLifts = applyLoads(plan, contextFor({ ...PROFILE, lifts: { bench: { weight: 90, reps: 5 } } }));
    expect(fromLifts.weightsFrom).toBe('entered');
    expect(fromLifts.notes.join(' ')).toMatch(/working sets you entered/i);
  });

  it('is pure — the original plan is untouched', () => {
    const before = JSON.stringify(plan);
    applyLoads(plan, contextFor());
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('produces no loads at all for an athlete who has told us nothing', () => {
    const loaded = applyLoads(plan, contextFor({ ...PROFILE, bodyWeight: '', lifts: {} }));
    expect(loaded.weightsFrom).toBeNull();
    expect(planLoadSummary(loaded, contextFor({ ...PROFILE, bodyWeight: '', lifts: {} }))).toBeNull();
  });

  it('survives a null plan', () => {
    expect(applyLoads(null, contextFor())).toBeNull();
  });

  it('summarises the heaviest prescriptions for the week', () => {
    const loaded = applyLoads(plan, contextFor());
    const summary = planLoadSummary(loaded, contextFor());
    expect(Array.isArray(summary)).toBe(true);
    expect(summary.length).toBeGreaterThan(0);
    summary.forEach((line) => expect(line).toMatch(/\d/));
  });
});

describe('running', () => {
  it('maps weight unit to the distance unit athletes think in', () => {
    expect(distanceUnitFor('kg')).toBe('km');
    expect(distanceUnitFor('lb')).toBe('mi');
  });

  it('returns no running plan when running was not ticked', () => {
    expect(runAdvice({ equipment: ['gym', 'barbell'], goal: 'lean', level: 'intermediate', units: 'kg' })).toEqual([]);
  });

  it('prescribes duration and effort when there is no pace to work from', () => {
    const sessions = runAdvice({ equipment: ['running'], goal: 'muscle', level: 'intermediate', units: 'kg' });
    expect(sessions.length).toBe(2);
    expect(sessions[0].exerciseId).toBe('run-easy');
    expect(sessions[0].distance).toBeNull();
    expect(sessions[0].prescription).toBe('25 min');
    expect(sessions[0].cue).toMatch(/conversational pace/i);
  });

  it('derives distances once there is a logged pace', () => {
    const runs = [{ date: '2026-09-06', distance: 5, unit: 'km', minutes: 30 }];
    const sessions = runAdvice({ equipment: ['running'], goal: 'muscle', level: 'intermediate', units: 'kg', runs });
    expect(sessions[0].distanceUnit).toBe('km');
    // 6:00 /km pace, 25 min → 4.2 km.
    expect(sessions[0].distance).toBeCloseTo(4.2, 1);
    expect(sessions[0].prescription).toMatch(/25 min · ≈4\.2 km/);
    expect(sessions[0].cue).toMatch(/slower than 6:00 \/km/);
  });

  it('starts a beginner on run/walk rather than a continuous run', () => {
    const sessions = runAdvice({ equipment: ['running'], goal: 'general', level: 'beginner', units: 'kg' });
    expect(sessions[0].exerciseId).toBe('run-walk');
    expect(sessions[0].cue).toMatch(/walking is training/i);
    expect(sessions[1].exerciseId).toBe('run-intervals');
  });

  it('scales the number of sessions with the goal, and the long run with distance goals', () => {
    const lean = runAdvice({ equipment: ['running'], goal: 'lean', level: 'intermediate', units: 'kg' });
    const muscle = runAdvice({ equipment: ['running'], goal: 'muscle', level: 'intermediate', units: 'kg' });
    expect(lean.length).toBeGreaterThan(muscle.length);

    const endurance = runAdvice({ equipment: ['running'], goal: 'endurance', level: 'intermediate', units: 'kg' });
    expect(endurance.some((session) => session.exerciseId === 'run-long')).toBe(true);
    const advancedEndurance = runAdvice({ equipment: ['running'], goal: 'endurance', level: 'advanced', units: 'kg' });
    expect(advancedEndurance.some((session) => session.exerciseId === 'run-hills')).toBe(true);
  });

  it('averages pace weighted by distance, not by run count', () => {
    const pace = paceFromRuns(
      [
        { distance: 1, unit: 'km', minutes: 4 },
        { distance: 9, unit: 'km', minutes: 54 },
      ],
      'km'
    );
    expect(pace).toBeCloseTo(5.8, 2); // 58 min / 10 km, not (4 + 6) / 2
  });

  it('ignores runs logged in the other unit and runs with no data', () => {
    expect(paceFromRuns([{ distance: 5, unit: 'mi', minutes: 40 }], 'km')).toBeNull();
    expect(paceFromRuns([], 'km')).toBeNull();
    expect(paceFromRuns([{ distance: 0, unit: 'km', minutes: 30 }], 'km')).toBeNull();
  });

  it('formats pace and duration the way a runner reads them', () => {
    expect(formatPace(5.5, 'km')).toBe('5:30 /km');
    expect(formatPace(6, 'mi')).toBe('6:00 /mi');
    expect(formatPace(0, 'km')).toBeNull();
    expect(formatPace(null, 'km')).toBeNull();
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(120)).toBe('2 h');
  });

  it('reports the running summary behind the progress card', () => {
    const summary = describeRunning({
      units: 'kg',
      runs: [
        { distance: 5, unit: 'km', minutes: 30 },
        { distance: 3, unit: 'km', minutes: 21 },
      ],
    });
    expect(summary.distanceUnit).toBe('km');
    expect(summary.totalDistance).toBe(8);
    expect(summary.totalMinutes).toBe(51);
    expect(summary.longest).toBe(5);
    expect(summary.paceLabel).toBe('6:23 /km');
    expect(longestRun([])).toBe(0);
  });
});
