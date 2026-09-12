/**
 * fitLoads.js — where the actual kilos come from.
 *
 * The generator (`fitProgram.js`) decides *what* you do. This module decides
 * **how much**, and it is deliberately separated for two reasons:
 *
 *   1. **Loads depend on the athlete, not the split.** Change your body weight
 *      or your bench and the numbers should update — but that must not shuffle
 *      the week's exercise selection out from under you.
 *   2. **A generated number has to be explainable.** Every prescription carries
 *      a `basis` string saying which working set or body-weight ratio it came
 *      from and how it was rounded, because "75 kg" with no reasoning is worse
 *      than no number at all.
 *
 * Method, in one paragraph: each of the five reference lifts gets an estimated
 * 1RM — from the working set you typed, or from a body-weight ratio for your
 * experience level when you have not typed one. A movement's load is a fraction
 * of its reference 1RM (1.0 for the lift itself, ~0.3 for a triceps pushdown),
 * converted into a weight for the prescribed rep count with the Epley formula,
 * then **rounded down** to a weight you can actually load. Rounding down is
 * intentional: the first session should feel slightly easy, not heroic.
 */

import {
  GOAL_OPTIONS,
  LEVEL_OPTIONS,
  buildPlanNotes,
  getExercise,
  topOfRepRange,
} from './fitProgram';
import { convertWeight, estimateOneRepMax, fromKilograms, parseDate, toKilograms } from './fitStorage';

/** The five lifts the whole load model hangs off, and the form rows for them. */
export const ANCHOR_LIFTS = [
  { id: 'bench', label: 'Bench press', hint: 'Barbell or dumbbell bench' },
  { id: 'squat', label: 'Squat', hint: 'Back squat, front squat, or leg press' },
  { id: 'deadlift', label: 'Deadlift', hint: 'Conventional or Romanian' },
  { id: 'ohp', label: 'Overhead press', hint: 'Standing or seated barbell press' },
  { id: 'row', label: 'Row', hint: 'Barbell row, or a heavy cable row' },
];

export const ANCHOR_IDS = ANCHOR_LIFTS.map((lift) => lift.id);

const ANCHOR_LABELS = ANCHOR_LIFTS.reduce((acc, lift) => {
  acc[lift.id] = lift.label.toLowerCase();
  return acc;
}, {});

/**
 * Body-weight multiples for a single estimated 1RM, by experience level.
 *
 * These are mainstream strength-standard midpoints, not targets: they exist to
 * put a *sensible first number* on the bar, and every one of them is replaced
 * by what the athlete actually lifts as soon as they log a session.
 */
export const ANCHOR_STANDARDS = {
  bench: { beginner: 0.5, intermediate: 0.75, advanced: 1.0 },
  squat: { beginner: 0.7, intermediate: 1.1, advanced: 1.5 },
  deadlift: { beginner: 0.9, intermediate: 1.45, advanced: 1.8 },
  ohp: { beginner: 0.35, intermediate: 0.55, advanced: 0.7 },
  row: { beginner: 0.45, intermediate: 0.7, advanced: 0.85 },
};

/** The smallest jump you can actually load, per unit. */
export const STEP_BY_KIND = {
  barbell: { kg: 2.5, lb: 5 },
  dumbbell: { kg: 1, lb: 2.5 },
  machine: { kg: 2.5, lb: 5 },
};

export function roundDownTo(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.floor(value / step + 1e-9) * step;
}

export function stepFor(load, unit) {
  const kind = (load && load.step) || 'barbell';
  return (STEP_BY_KIND[kind] || STEP_BY_KIND.barbell)[unit] || 2.5;
}

// ── Context ──────────────────────────────────────────────────────────────
/**
 * Everything the load model needs, derived once per render.
 *
 * `e1rmKg` is always kilograms internally so kg and lb athletes get identical
 * advice; the display unit is applied at the very end.
 */
export function buildLoadContext({ profile = {}, checkIns = [], units = 'kg' } = {}) {
  const level = LEVEL_OPTIONS.find((l) => l.id === profile.level) ? profile.level : 'intermediate';
  const sorted = (checkIns || []).slice().sort((a, b) => parseDate(b.date) - parseDate(a.date));
  const latest = sorted[0];
  const bodyWeight = latest?.weight || Number(profile.bodyWeight) || null;
  const bodyWeightKg = bodyWeight ? toKilograms(bodyWeight, units) : null;
  const heightCm = Number(profile.heightCm) || null;

  const e1rmKg = {};
  const source = {};
  ANCHOR_IDS.forEach((id) => {
    const entered = profile.lifts?.[id];
    const weight = Number(entered?.weight) || 0;
    if (weight > 0) {
      e1rmKg[id] = toKilograms(estimateOneRepMax(weight, Number(entered?.reps) || 5), units);
      source[id] = 'entered';
    } else if (bodyWeightKg) {
      e1rmKg[id] = bodyWeightKg * ANCHOR_STANDARDS[id][level];
      source[id] = 'bodyweight';
    }
  });

  return {
    unit: units,
    level,
    bodyWeight,
    bodyWeightKg,
    heightCm,
    e1rmKg,
    source,
    hasBodyWeight: Boolean(bodyWeightKg),
    hasEnteredLifts: Object.values(source).includes('entered'),
    checkInCount: sorted.length,
  };
}

/** A one-line readout of the model's assumptions, for the UI. */
export function describeContext(context) {
  if (!context) return [];
  const lines = [];
  if (!context.hasBodyWeight) {
    lines.push('Add your body weight (or a working set below) and every prescribed weight appears.');
    return lines;
  }
  lines.push(
    `Estimated 1RM from ${context.hasEnteredLifts ? 'your working sets' : 'your body weight'} — ` +
      ANCHOR_IDS.filter((id) => context.e1rmKg[id])
        .map((id) => `${ANCHOR_LABELS[id]} ${Math.round(convertWeight(context.e1rmKg[id], 'kg', context.unit))} ${context.unit}`)
        .join(' · ')
  );
  if (context.checkInCount > 0) lines.push(`Using your latest check-in (${context.bodyWeight} ${context.unit}).`);
  return lines;
}

// ── Per-movement load ────────────────────────────────────────────────────
/**
 * One short line explaining where a number came from.
 *
 * Deliberately terse: this renders under every single movement, so the
 * rounding rule and the "beat the top of the range" advice live once per day
 * in the block note instead of being repeated six times down the card.
 */
function describeBasis({ exercise, context, reps, perHand, step }) {
  const load = exercise.load;
  const factor = load.factor ?? 1;
  const refLabel = ANCHOR_LABELS[load.ref] || load.ref;
  const refE1rm = Math.round(convertWeight(context.e1rmKg[load.ref], 'kg', context.unit));
  const per = perHand ? ' per hand' : '';

  if (context.source[load.ref] === 'entered') {
    return factor === 1
      ? `your ${refLabel} · ${refE1rm} ${context.unit} est. 1RM · ${reps} reps`
      : `${Math.round(factor * 100)}% of your ${refLabel} · ${reps} reps`;
  }
  return factor === 1
    ? `${refLabel} ≈ ${Math.round(ANCHOR_STANDARDS[load.ref][context.level] * 100)}% of body weight · ${reps} reps`
    : `${Math.round(factor * 100)}% of ${refLabel} · ${reps} reps${per}`;
}


/**
 * The prescription for one plan item, or `null` when no honest number exists
 * (bodyweight movements, or an athlete who has told us nothing yet).
 */
export function loadForItem(item, context) {
  if (!item || !context) return null;
  const exercise = getExercise(item.exerciseId);
  if (!exercise) return null;

  if (item.holdSeconds) {
    return {
      kind: 'timed',
      seconds: item.holdSeconds,
      text: `${item.holdSeconds}s hold`,
      basis: `Hold for ${item.holdSeconds}s per set with ${item.restSeconds}s rest. Stop the set when the position breaks, not when the clock runs out.`,
    };
  }

  if (!exercise.load) {
    if (exercise.bodyweight) {
      return {
        kind: 'bodyweight',
        text: 'Bodyweight',
        basis: exercise.bwNote || 'Bodyweight — progress by adding reps, slowing the tempo, or moving to a harder variation.',
      };
    }
    return null;
  }

  const refKg = context.e1rmKg[exercise.load.ref];
  if (!refKg) return null;

  const reps = topOfRepRange(item.reps);
  const perHand = Boolean(exercise.load.perHand);
  const step = stepFor(exercise.load, context.unit);
  const totalKg = refKg * (exercise.load.factor ?? 1);
  const loadKg = totalKg / (1 + reps / 30);
  const inUnit = fromKilograms(loadKg, context.unit);
  const weight = roundDownTo(perHand ? inUnit / 2 : inUnit, step);

  if (weight <= 0) return null;

  return {
    kind: 'weight',
    weight,
    unit: context.unit,
    perHand,
    step,
    reps,
    from: context.source[exercise.load.ref] || 'bodyweight',
    text: `${weight} ${context.unit}${perHand ? ' per hand' : ''}`,
    basis: describeBasis({ exercise, context, reps, perHand, step }),
  };
}

/**
 * Attach loads to every item in a plan. Pure: it returns a new plan, so the
 * caller decides whether to persist it.
 */
export function applyLoads(plan, context) {
  if (!plan) return plan;
  const days = (plan.days || []).map((day) => ({
    ...day,
    blocks: (day.blocks || []).map((block) => ({
      ...block,
      items: (block.items || []).map((item) => ({ ...item, load: loadForItem(item, context) })),
    })),
  }));
  const next = { ...plan, days };
  if (!context?.hasBodyWeight) next.weightsFrom = null;
  else next.weightsFrom = context.hasEnteredLifts ? 'entered' : 'bodyweight';
  // The notes explain where the numbers came from, so they have to be rebuilt
  // whenever the numbers change.
  next.notes = buildPlanNotes(next);
  return next;
}

/** How much weight moved is prescribed this week, for the plan summary. */
export function planLoadSummary(plan, context) {
  if (!plan || !context?.hasBodyWeight) return null;
  const weighted = plan.days
    .flatMap((day) => day.blocks.flatMap((block) => block.items))
    .filter((item) => item.load && item.load.kind === 'weight');
  if (!weighted.length) return null;
  const top = weighted
    .slice()
    .sort((a, b) => b.load.weight * (10 - b.load.reps) - a.load.weight * (10 - a.load.reps))
    .slice(0, 3);
  return top.map((item) => `${item.name} ${item.load.text}`);
}

// ── Running ──────────────────────────────────────────────────────────────
/** Imperial athletes think in miles; metric ones think in kilometres. */
export function distanceUnitFor(units) {
  return units === 'lb' ? 'mi' : 'km';
}

/** Average pace in minutes per distance unit, weighted by distance run. */
export function paceFromRuns(runs = [], distanceUnit = 'km') {
  const usable = runs.filter(
    (run) => Number(run.distance) > 0 && Number(run.minutes) > 0 && (run.unit || distanceUnit) === distanceUnit
  );
  if (!usable.length) return null;
  const distance = usable.reduce((sum, run) => sum + Number(run.distance), 0);
  const minutes = usable.reduce((sum, run) => sum + Number(run.minutes), 0);
  return distance > 0 && minutes > 0 ? minutes / distance : null;
}

export function formatPace(minutesPerUnit, distanceUnit = 'km') {
  if (!Number.isFinite(minutesPerUnit) || minutesPerUnit <= 0) return null;
  const totalSeconds = Math.round(minutesPerUnit * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds} /${distanceUnit}`;
}

export function formatDuration(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function longestRun(runs = []) {
  return runs.reduce((max, run) => Math.max(max, Number(run.distance) || 0), 0);
}

/**
 * The running week, dosed by goal and paced off the athlete's own runs.
 *
 * Deterministic by (goal, level, equipment) — a prescription should not change
 * shape because a shuffle landed differently. Distances are only quoted when
 * there is a logged pace to derive them from; otherwise the athlete gets a
 * duration and an effort description, which is the honest answer.
 */
export function runAdvice({ equipment = [], goal = 'muscle', level = 'intermediate', units = 'kg', runs = [] } = {}) {
  if (!Array.isArray(equipment) || !equipment.includes('running')) return [];

  const goalOption = GOAL_OPTIONS.find((g) => g.id === goal) || GOAL_OPTIONS[0];
  const levelOption = LEVEL_OPTIONS.find((l) => l.id === level) || LEVEL_OPTIONS[1];
  const distanceUnit = distanceUnitFor(units);
  const pace = paceFromRuns(runs, distanceUnit);
  const target = goalOption.runsPerWeek;

  const easyMinutes = Math.max(
    15,
    goalOption.easyMinutes + (levelOption.id === 'advanced' ? 5 : 0) - (levelOption.id === 'beginner' ? 5 : 0)
  );

  const withDistance = (base) => {
    const distance = pace ? Math.round((base.minutes / pace) * 10) / 10 : null;
    return {
      ...base,
      distance,
      distanceUnit: distance ? distanceUnit : null,
      prescription: distance
        ? `${base.minutes} min · ≈${distance} ${distanceUnit}`
        : `${base.minutes} min`,
    };
  };

  const easy = () =>
    withDistance({
      exerciseId: 'run-easy',
      name: 'Easy run',
      minutes: easyMinutes,
      cue: pace
        ? `Keep it slower than ${formatPace(pace, distanceUnit)} — you should be able to talk.`
        : 'Conversational pace. If you cannot speak a full sentence, slow down.',
    });

  const sessions = [];

  if (levelOption.id === 'beginner') {
    sessions.push(
      withDistance({
        exerciseId: 'run-walk',
        name: 'Run / walk',
        minutes: 25,
        cue: '4 min running, 1 min walking × 5. The walking is training, not failure.',
      })
    );
  } else {
    sessions.push(easy());
  }

  if (goalOption.id === 'endurance' && target >= 3) {
    sessions.push(
      withDistance({
        exerciseId: 'run-long',
        name: 'Long easy run',
        minutes: easyMinutes + 20,
        cue: 'Slowest run of the week. Going faster than easy defeats the purpose.',
      })
    );
  }

  while (sessions.length < Math.max(1, target - 1)) sessions.push(easy());

  if (target >= 2) {
    const quality = levelOption.id === 'beginner'
      ? {
          exerciseId: 'run-intervals',
          name: 'Intro intervals',
          minutes: 20,
          cue: '8 × 1 min brisk / 2 min easy. Brisk means hard but repeatable.',
        }
      : goalOption.id === 'endurance' && levelOption.id === 'advanced'
      ? {
          exerciseId: 'run-hills',
          name: 'Hill repeats',
          minutes: 25,
          cue: '8–10 × 30 s uphill, walk back down. Stop the session when the effort drops.',
        }
      : {
          exerciseId: 'run-tempo',
          name: 'Tempo run',
          minutes: 25,
          cue: '15 min at "comfortably hard", then easy to finish. Not a sprint.',
        };
    sessions.push(withDistance(quality));
  }

  return sessions.slice(0, Math.max(1, target));
}

/** A plain-language readout of the running week for the progress card. */
export function describeRunning({ runs = [], units = 'kg' } = {}) {
  const distanceUnit = distanceUnitFor(units);
  const pace = paceFromRuns(runs, distanceUnit);
  const totalDistance = runs.reduce((sum, run) => sum + (Number(run.distance) || 0), 0);
  const totalMinutes = runs.reduce((sum, run) => sum + (Number(run.minutes) || 0), 0);
  return {
    distanceUnit,
    pace,
    paceLabel: formatPace(pace, distanceUnit),
    totalDistance: Math.round(totalDistance * 10) / 10,
    totalMinutes: Math.round(totalMinutes),
    runs: runs.length,
    longest: Math.round(longestRun(runs) * 10) / 10,
  };
}
