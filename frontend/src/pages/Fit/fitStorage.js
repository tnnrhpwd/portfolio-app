/**
 * fitStorage.js — persistence and statistics for /fit.
 *
 * Everything here is pure except `loadFitState` / `saveFitState` /
 * `clearFitState`, which are the only functions that touch `localStorage`.
 * Keeping the maths out of the component is what lets the tracker's numbers
 * (volume, PRs, streaks, recommendations) be unit-tested directly instead of
 * through a rendered page.
 *
 * Two storage rules worth knowing:
 *   - **Guests never write.** The page only calls `saveFitState` for a signed-in
 *     athlete, so a visitor gets recommendations and leaves no trace.
 *   - **Weights remember their own unit.** Every session is stamped with the
 *     unit it was entered in, so switching kg ⇄ lb never silently rewrites
 *     history. Statistics normalise through kilograms internally and convert
 *     back out for display.
 */

import { DEFAULT_PROFILE, SESSION_LENGTH_OPTIONS, formatPrescription, topOfRepRange } from './fitProgram';

export const FIT_STORAGE_KEY = 'fit.state.v2';
/** Read-only fallback: a v1 payload is migrated on load rather than discarded. */
export const LEGACY_STORAGE_KEYS = ['fit.state.v1'];
export const FIT_STATE_VERSION = 2;

const KG_PER_LB = 0.45359237;
export const UNITS = [
  { id: 'kg', label: 'kg' },
  { id: 'lb', label: 'lb' },
];

// ── Unit maths ───────────────────────────────────────────────────────────
export function toKilograms(value, unit) {
  const n = Number(value) || 0;
  return unit === 'lb' ? n * KG_PER_LB : n;
}

export function fromKilograms(kg, unit) {
  const n = Number(kg) || 0;
  return unit === 'lb' ? n / KG_PER_LB : n;
}

/** Convert a weight between units, rounded to 1 decimal (25 kg → 55.1 lb). */
export function convertWeight(value, from, to) {
  if (from === to) return Number(value) || 0;
  return Math.round(fromKilograms(toKilograms(value, from), to) * 10) / 10;
}

export function formatWeight(value, unit) {
  const n = Number(value) || 0;
  if (n === 0) return `0 ${unit}`;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}`;
}

// ── Dates ────────────────────────────────────────────────────────────────
/**
 * Parse a stored date.
 *
 * `new Date('2026-09-09')` is parsed as **UTC** midnight, which lands on the
 * previous day for anyone west of UTC — so a session logged this morning would
 * be counted in last week. Date-only strings are therefore parsed as local
 * dates, which is exactly what `todayISO()` writes.
 */
export function parseDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(input);
}

export function todayISO(now = new Date()) {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday 00:00 of the week containing `date` — the week boundary for streaks. */
export function weekStart(date = new Date()) {
  const d = parseDate(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

export function formatDateLabel(dateInput, { withYear = false } = {}) {
  const d = parseDate(dateInput);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Median of a numeric list; `null` for an empty list. */
export function median(values) {
  const sorted = (values || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ── Persistence ──────────────────────────────────────────────────────────
export function createEmptyState() {
  return {
    version: FIT_STATE_VERSION,
    profile: { ...DEFAULT_PROFILE, lifts: {} },
    units: 'kg',
    plan: null,
    rotationIndex: 0,
    sessions: [],
    runs: [],
    checkIns: [],
    pain: { area: 'none', severity: '', timing: '', notes: '' },
    coach: null,
  };
}

/** v1 stored a single equipment string; v2 stores a set. */
function migrateEquipment(value) {
  if (Array.isArray(value)) return value;
  if (value === 'gym') return ['gym', 'barbell'];
  if (value === 'dumbbells') return ['dumbbells'];
  if (value === 'bodyweight') return [];
  return [...DEFAULT_PROFILE.equipment];
}

/**
 * Coerce a stored payload into a usable state.
 *
 * A corrupt, missing, or older payload degrades to something usable rather
 * than throwing: a tracking page that white-screens on bad storage is worse
 * than one that asks you to generate a plan again.
 */
export function normalizeState(parsed) {
  const empty = createEmptyState();
  if (!parsed || typeof parsed !== 'object') return empty;

  const profile = { ...empty.profile, ...(parsed.profile || {}) };
  profile.equipment = migrateEquipment(profile.equipment);
  profile.lifts = profile.lifts && typeof profile.lifts === 'object' ? profile.lifts : {};
  if (Number(parsed.version) < 2 && parsed.profile && typeof parsed.profile.units === 'string') {
    // v1 kept the unit on the profile; v2 keeps it on the state.
    parsed.units = parsed.profile.units;
  }

  return {
    ...empty,
    ...parsed,
    version: FIT_STATE_VERSION,
    profile,
    units: parsed.units === 'lb' ? 'lb' : 'kg',
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    checkIns: Array.isArray(parsed.checkIns) ? parsed.checkIns : [],
    pain: { ...empty.pain, ...(parsed.pain || {}) },
    coach: parsed.coach && typeof parsed.coach === 'object' ? parsed.coach : null,
    rotationIndex: Number.isFinite(parsed.rotationIndex) ? parsed.rotationIndex : 0,
    plan: parsed.plan && Array.isArray(parsed.plan.days) ? parsed.plan : null,
  };
}

export function loadFitState() {
  const empty = createEmptyState();
  try {
    const raw = localStorage.getItem(FIT_STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) return normalizeState(JSON.parse(legacy));
      }
      return empty;
    }
    return normalizeState(JSON.parse(raw));
  } catch {
    return empty;
  }
}

export function saveFitState(state) {
  try {
    localStorage.setItem(FIT_STORAGE_KEY, JSON.stringify({ ...state, version: FIT_STATE_VERSION }));
    return true;
  } catch {
    // Private mode / quota — the page still works for this session.
    return false;
  }
}

export function clearFitState() {
  try {
    localStorage.removeItem(FIT_STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────
/** Every entry in a session, regardless of which block it sits in. */
export function sessionEntries(session) {
  if (!session || !Array.isArray(session.blocks)) return [];
  return session.blocks.flatMap((block) => (Array.isArray(block.entries) ? block.entries : []));
}

export function isSetDone(set) {
  return Boolean(set && set.done);
}

/** Completed sets only — an unticked row was prescribed, not performed. */
export function entryPerformedSets(entry) {
  if (!entry) return [];
  if (entry.kind === 'cardio') return entry.done ? [entry] : [];
  return (entry.sets || []).filter(isSetDone);
}

/** Epley estimated one-rep max. Returns 0 when the set was not performed. */
export function estimateOneRepMax(weight, reps) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  return round(w * (1 + r / 30));
}

export function setVolume(set) {
  const w = Number(set?.weight) || 0;
  const r = Number(set?.reps) || 0;
  if (!isSetDone(set) || w <= 0 || r <= 0) return 0;
  return w * r;
}

/** Total weight moved in a session, expressed in `unit`. */
export function sessionVolume(session, unit = 'kg') {
  const sourceUnit = session?.unit || unit;
  let kg = 0;
  sessionEntries(session).forEach((entry) => {
    if (entry.kind === 'cardio') return;
    (entry.sets || []).forEach((set) => {
      if (setVolume(set) > 0) kg += toKilograms(setVolume(set), sourceUnit);
    });
  });
  return Math.round(fromKilograms(kg, unit));
}

export function sessionSetCount(session) {
  return sessionEntries(session).reduce((sum, entry) => {
    // Cardio is measured in minutes, not sets — counting a treadmill block as a
    // "set" would make the two metrics impossible to compare week to week.
    if (entry.kind === 'cardio') return sum;
    return sum + entryPerformedSets(entry).length;
  }, 0);
}

export function sessionExerciseCount(session) {
  return sessionEntries(session).filter((entry) => entryPerformedSets(entry).length > 0).length;
}

export function sessionCardioMinutes(session) {
  return sessionEntries(session).reduce((sum, entry) => {
    if (entry.kind !== 'cardio' || !entry.done) return sum;
    return sum + (Number(entry.minutes) || 0);
  }, 0);
}

export function sessionHasWork(session) {
  return sessionSetCount(session) > 0 || sessionCardioMinutes(session) > 0;
}

/**
 * Everything that counts as a training day: logged sessions *and* runs.
 * Both carry a `.date`, which is all the week maths below needs — and a week
 * where you ran three times and lifted twice is a five-day week, not a two-day
 * one.
 */
export function allTraining(state) {
  return [...(state?.sessions || []), ...(state?.runs || [])];
}

// ── Running ──────────────────────────────────────────────────────────────
export function createRun({ date = todayISO(), distance, unit, minutes, effort, pain, notes } = {}) {
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    distance: round(Number(distance) || 0, 2),
    unit: unit === 'mi' ? 'mi' : 'km',
    minutes: round(Number(minutes) || 0, 1),
    effort: effort === '' || effort === null || effort === undefined ? null : Number(effort),
    pain: pain || '',
    notes: notes || '',
    savedAt: new Date().toISOString(),
  };
}

export function runTotals(runs = [], unit = 'km') {
  const usable = runs.filter((run) => (run.unit || unit) === unit);
  const distance = usable.reduce((sum, run) => sum + (Number(run.distance) || 0), 0);
  const minutes = usable.reduce((sum, run) => sum + (Number(run.minutes) || 0), 0);
  return {
    distance: round(distance, 1),
    minutes: Math.round(minutes),
    count: usable.length,
    longest: round(usable.reduce((max, run) => Math.max(max, Number(run.distance) || 0), 0), 1),
  };
}

/** Distance per week, oldest → newest, for the running chart. */
export function weeklyRunSeries(runs = [], weeks = 8, unit = 'km', now = new Date()) {
  const thisWeek = weekStart(now);
  const series = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 7);
    const inWeek = runs.filter((run) => {
      const t = parseDate(run.date).getTime();
      return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
    });
    series.push({
      key: start.getTime(),
      label: formatDateLabel(start),
      distance: round(inWeek.reduce((sum, run) => sum + (Number(run.distance) || 0), 0), 1),
      minutes: Math.round(inWeek.reduce((sum, run) => sum + (Number(run.minutes) || 0), 0)),
      isCurrent: i === 0,
    });
  }
  return series;
}

/** Distance in the 7 days up to `now` — the number the 10% rule cares about. */
export function recentRunDistance(runs = [], days = 7, now = new Date()) {
  const end = parseDate(now).getTime();
  const start = end - days * 24 * 60 * 60 * 1000;
  return round(
    runs.reduce((sum, run) => {
      const t = parseDate(run.date).getTime();
      return t >= start && t <= end ? sum + (Number(run.distance) || 0) : sum;
    }, 0),
    1
  );
}

// ── Body weight check-ins ────────────────────────────────────────────────
/** One check-in per day; logging again the same day replaces it. */
export function upsertCheckIn(checkIns = [], entry) {
  if (!entry || !entry.date || !Number(entry.weight)) return checkIns;
  const without = checkIns.filter((item) => item.date !== entry.date);
  return without
    .concat({ date: entry.date, weight: Number(entry.weight), unit: entry.unit || 'kg' })
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

export function latestCheckIn(checkIns = []) {
  const sorted = (checkIns || []).slice().sort((a, b) => parseDate(b.date) - parseDate(a.date));
  return sorted[0] || null;
}

/** Body weight at roughly weekly intervals, oldest → newest, in `unit`. */
export function bodyWeightSeries(checkIns = [], weeks = 8, unit = 'kg', now = new Date()) {
  const thisWeek = weekStart(now);
  const series = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 7);
    const inWeek = checkIns
      .filter((item) => {
        const t = parseDate(item.date).getTime();
        return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
      })
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const last = inWeek[inWeek.length - 1];
    series.push({
      key: start.getTime(),
      label: formatDateLabel(start),
      weight: last ? round(convertWeight(last.weight, last.unit || unit, unit), 1) : null,
      isCurrent: i === 0,
    });
  }
  return series;
}

/** Change in body weight over the last `days`, in `unit`. */
export function bodyWeightChange(checkIns = [], days = 30, unit = 'kg', now = new Date()) {
  const sorted = checkIns.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
  if (sorted.length < 2) return null;
  const cutoff = parseDate(now).getTime() - days * 24 * 60 * 60 * 1000;
  const baseline = sorted.find((item) => parseDate(item.date).getTime() >= cutoff) || sorted[0];
  const latest = sorted[sorted.length - 1];
  if (baseline === latest) return null;
  return round(convertWeight(latest.weight, latest.unit || unit, unit) - convertWeight(baseline.weight, baseline.unit || unit, unit), 1);
}

// ── Progress ─────────────────────────────────────────────────────────────
export function sessionsInWeek(entries, weekDate) {
  const start = weekStart(weekDate).getTime();
  const end = addDays(new Date(start), 7).getTime();
  return (entries || []).filter((entry) => {
    const t = parseDate(entry.date).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  });
}

export function currentWeekProgress(training, weeklyTarget, now = new Date()) {
  const done = sessionsInWeek(training, now).length;
  const target = Math.max(1, Number(weeklyTarget) || 1);
  return {
    done,
    target,
    remaining: Math.max(0, target - done),
    ratio: Math.min(1, done / target),
    onTrack: done >= target,
  };
}

/**
 * Consecutive weeks that hit `weeklyTarget`, counting back from this week.
 * The current week only counts once it is complete — an unfinished week never
 * inflates the streak, and never breaks it either.
 */
export function weeklyStreak(training, weeklyTarget, now = new Date()) {
  const target = Number(weeklyTarget) || 0;
  if (target < 1) return 0;

  const counts = new Map();
  (training || []).forEach((entry) => {
    const t = parseDate(entry.date).getTime();
    if (!Number.isFinite(t)) return;
    const key = weekStart(new Date(t)).getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  let cursor = weekStart(now);
  let streak = 0;
  if ((counts.get(cursor.getTime()) || 0) >= target) streak += 1;

  cursor = addDays(cursor, -7);
  while ((counts.get(cursor.getTime()) || 0) >= target) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

/** Oldest → newest volume per week, for the bar chart. */
export function weeklyVolumeSeries(sessions, weeks = 8, unit = 'kg', now = new Date()) {
  const thisWeek = weekStart(now);
  const series = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const weekSessions = sessionsInWeek(sessions, start);
    series.push({
      key: start.getTime(),
      label: formatDateLabel(start),
      sessions: weekSessions.length,
      volume: weekSessions.reduce((sum, s) => sum + sessionVolume(s, unit), 0),
      cardio: weekSessions.reduce((sum, s) => sum + sessionCardioMinutes(s), 0),
      isCurrent: i === 0,
    });
  }
  return series;
}

export function totalVolume(sessions, unit = 'kg') {
  return (sessions || []).reduce((sum, s) => sum + sessionVolume(s, unit), 0);
}

export function totalCardioMinutes(sessions) {
  return (sessions || []).reduce((sum, s) => sum + sessionCardioMinutes(s), 0);
}

/**
 * Personal records per movement: the heaviest set performed and the best
 * estimated 1RM, both already converted into the display unit.
 */
export function exercisePRs(sessions, unit = 'kg', limit = 8) {
  const byExercise = new Map();

  (sessions || []).forEach((session) => {
    const sourceUnit = session?.unit || unit;
    sessionEntries(session).forEach((entry) => {
      if (entry.kind === 'cardio' || !entry.name || !entry.exerciseId) return;
      const performed = entryPerformedSets(entry);
      if (!performed.length) return;

      const record = byExercise.get(entry.exerciseId) || {
        exerciseId: entry.exerciseId,
        name: entry.name,
        muscle: entry.muscle,
        sessions: 0,
        totalSets: 0,
        bestWeight: 0,
        bestWeightReps: 0,
        bestE1rm: 0,
        bestE1rmWeight: 0,
        bestE1rmReps: 0,
        bestVolume: 0,
        lastDate: null,
      };

      record.sessions += 1;
      let sessionBestVolume = 0;

      performed.forEach((set) => {
        const reps = Number(set.reps) || 0;
        const weightKg = toKilograms(set.weight, sourceUnit);
        record.totalSets += 1;
        sessionBestVolume += toKilograms(setVolume(set), sourceUnit);

        if (weightKg > toKilograms(record.bestWeight, unit)) {
          record.bestWeight = fromKilograms(weightKg, unit);
          record.bestWeightReps = reps;
        }
        const e1rmKg = toKilograms(estimateOneRepMax(set.weight, reps), sourceUnit);
        if (e1rmKg > toKilograms(record.bestE1rm, unit)) {
          record.bestE1rm = fromKilograms(e1rmKg, unit);
          record.bestE1rmWeight = fromKilograms(toKilograms(set.weight, sourceUnit), unit);
          record.bestE1rmReps = reps;
        }
      });

      record.bestVolume = Math.max(record.bestVolume, fromKilograms(sessionBestVolume, unit));
      if (!record.lastDate || parseDate(session.date) > parseDate(record.lastDate)) {
        record.lastDate = session.date;
      }
      byExercise.set(entry.exerciseId, record);
    });
  });

  return Array.from(byExercise.values())
    .map((record) => ({
      ...record,
      bestWeight: round(record.bestWeight),
      bestE1rm: round(record.bestE1rm),
      bestVolume: Math.round(record.bestVolume),
    }))
    .sort((a, b) => b.bestE1rm - a.bestE1rm)
    .slice(0, limit);
}

/** The next day in the rotation — where the plan suggests you pick up. */
export function nextRotationDay(plan, rotationIndex = 0) {
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) return null;
  const index = (((Number(rotationIndex) || 0) % plan.days.length) + plan.days.length) % plan.days.length;
  return plan.days[index];
}

export function rotationIndexAfter(plan, dayId, rotationIndex = 0) {
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) return 0;
  const index = plan.days.findIndex((day) => day.id === dayId);
  if (index < 0) return (Number(rotationIndex) || 0) + 1;
  return (index + 1) % plan.days.length;
}

// ── Recommendations from the athlete's own data ──────────────────────────
/**
 * What the logged history says the *settings* should be.
 *
 * Days per week comes from the median number of days actually trained over the
 * last six weeks (not the number prescribed — the number that happened), and
 * session length from the median logged duration, snapped to a real option.
 * Returns `null`s with an explanation when there is not enough history to
 * recommend anything honestly.
 */
export function recommendedSettings(state, now = new Date()) {
  const sessions = state?.sessions || [];
  const runs = state?.runs || [];
  const training = allTraining(state);
  const reasons = [];

  if (training.length < 4) {
    return {
      daysPerWeek: null,
      sessionMinutes: null,
      reasons: ['Log a few sessions and Fit will suggest the days and the session length that actually fit your week.'],
    };
  }

  // Days per week: median of the last six weeks, ignoring empty weeks so one
  // holiday does not drag the recommendation down.
  const counts = [];
  for (let i = 0; i < 6; i += 1) {
    const start = addDays(weekStart(now), -7 * i);
    counts.push(sessionsInWeek(training, start).length);
  }
  const activeWeeks = counts.filter((count) => count > 0);
  const recommendedDays = median(activeWeeks);
  const daysPerWeek = recommendedDays ? Math.min(6, Math.max(3, Math.round(recommendedDays))) : null;
  if (daysPerWeek) {
    reasons.push(
      `You have averaged ${round(median(activeWeeks), 1)} training days a week over the last ${activeWeeks.length} active week${
        activeWeeks.length === 1 ? '' : 's'
      }.`
    );
  }

  // Session length: median of the durations actually logged.
  const durations = sessions.map((session) => Number(session.durationMin)).filter((n) => n > 0 && n <= 240);
  const recommendedMinutes = median(durations);
  let sessionMinutes = null;
  if (recommendedMinutes) {
    const options = SESSION_LENGTH_OPTIONS.map((option) => option.id);
    sessionMinutes = options.reduce((best, option) =>
      Math.abs(option - recommendedMinutes) < Math.abs(best - recommendedMinutes) ? option : best
    );
    reasons.push(`Your logged sessions take about ${Math.round(recommendedMinutes)} min.`);
  } else {
    reasons.push('Add how long each session took and Fit will refine the session length too.');
  }

  // Sets per session: worth saying out loud when the prescription is being
  // consistently trimmed in practice.
  const setCounts = sessions.map(sessionSetCount).filter((n) => n > 0);
  if (setCounts.length >= 3) {
    reasons.push(`You complete about ${Math.round(median(setCounts))} sets per session.`);
  }

  return { daysPerWeek, sessionMinutes, reasons };
}

/**
 * The deterministic read of the athlete's own numbers — always available, and
 * the thing shown even when the LLM coach cannot be reached.
 */
export function dataReadout(state, context = null, now = new Date()) {
  const sessions = state?.sessions || [];
  const runs = state?.runs || [];
  const checkIns = state?.checkIns || [];
  const unit = state?.units || 'kg';
  const weeklyTarget = state?.plan?.weeklyTarget || state?.profile?.daysPerWeek || 4;
  const items = [];

  const training = allTraining(state);
  const progress = currentWeekProgress(training, weeklyTarget, now);
  const streak = weeklyStreak(training, weeklyTarget, now);
  items.push({
    label: 'This week',
    value: `${progress.done}/${progress.target}`,
    note: progress.onTrack
      ? 'Target hit — anything else this week is a bonus.'
      : `${progress.remaining} more session${progress.remaining === 1 ? '' : 's'} to hit the target.`,
  });
  if (streak > 0) {
    items.push({
      label: 'Streak',
      value: `${streak} week${streak === 1 ? '' : 's'}`,
      note: 'Consecutive weeks at or above your session target.',
    });
  }

  // Volume trend: this month against the one before it — 4 weeks vs the 4
  // weeks before those, so the two windows are the same length.
  const last4 = weeklyVolumeSeries(sessions, 4, unit, now).reduce((sum, week) => sum + week.volume, 0);
  const prior4 = weeklyVolumeSeries(sessions, 4, unit, addDays(now, -28)).reduce((sum, week) => sum + week.volume, 0);
  if (prior4 > 0) {
    const change = Math.round(((last4 - prior4) / prior4) * 100);
    items.push({
      label: 'Volume trend',
      value: `${change >= 0 ? '+' : ''}${change}%`,
      note: `Last 4 weeks against the 4 before it (${last4.toLocaleString()} ${unit} vs ${prior4.toLocaleString()} ${unit}).`,
    });
  }

  const cardio = totalCardioMinutes(sessionsInWeek(sessions, now));
  if (cardio > 0) items.push({ label: 'Cardio this week', value: `${cardio} min`, note: 'From inside your logged sessions.' });

  if (runs.length) {
    const totals = runTotals(runs, runs[0].unit || 'km');
    items.push({
      label: 'Running',
      value: `${totals.distance} ${runs[0].unit || 'km'}`,
      note: `${totals.count} run${totals.count === 1 ? '' : 's'} logged · longest ${
        totals.longest
      } ${runs[0].unit || 'km'} · ${totals.minutes} min total.`,
    });
  }

  const weightChange = bodyWeightChange(checkIns, 30, unit, now);
  if (weightChange !== null) {
    items.push({
      label: 'Body weight',
      value: `${weightChange >= 0 ? '+' : ''}${weightChange} ${unit}`,
      note: 'Change over the last 30 days of check-ins.',
    });
  }

  if (context?.hasBodyWeight && context.hasEnteredLifts) {
    items.push({
      label: 'Weight source',
      value: 'Your lifts',
      note: 'Prescribed weights are derived from the working sets you entered, not from a body-weight estimate.',
    });
  }

  const severity = Number(state?.pain?.severity);
  if (state?.pain?.area && state.pain.area !== 'none') {
    items.push({
      label: 'Pain reported',
      value: `${state.pain.area}${severity ? ` ${severity}/10` : ''}`,
      note: 'Ask the coach below, and see a professional if it is sharp, sudden, or getting worse.',
    });
  }

  return items;
}

// ── Coach payload ────────────────────────────────────────────────────────
/** The bounded request body for POST /api/data/fit/coach. */
export function coachPayload(state, context = null, question = '') {
  const unit = state?.units || 'kg';
  const profile = state?.profile || {};
  const plan = state?.plan;
  const profileBodyWeight = Number(profile.bodyWeight);

  const sessions = (state?.sessions || [])
    .slice(-20)
    .reverse()
    .map((session) => ({
      date: session.date,
      dayName: session.dayName,
      sets: sessionSetCount(session),
      volume: sessionVolume(session, unit),
      cardioMinutes: sessionCardioMinutes(session),
      rpe: session.rpe || '',
      notes: session.notes || '',
    }));

  return {
    profile: {
      goal: profile.goal,
      level: profile.level,
      daysPerWeek: profile.daysPerWeek,
      sessionMinutes: profile.sessionMinutes,
      equipment: profile.equipment || [],
      units: unit,
      heightCm: Number(profile.heightCm) || null,
      bodyWeight: context?.bodyWeight ?? (profileBodyWeight > 0 ? profileBodyWeight : null),
      lifts: profile.lifts || {},
    },
    plan: {
      days: (plan?.days || []).map((day) => ({
        name: day.name,
        focus: day.focus,
        items: (day.blocks || [])
          .flatMap((block) => block.items || [])
          .slice(0, 12)
          .map((item) => ({
            name: item.name,
            prescription: formatPrescription(item),
            load: item.load?.text || '',
          })),
      })),
    },
    sessions,
    runs: (state?.runs || []).slice(-20).map((run) => ({
      date: run.date,
      distance: run.distance,
      unit: run.unit,
      minutes: run.minutes,
      effort: run.effort,
      pain: run.pain,
    })),
    checkIns: (state?.checkIns || []).slice(-30).map((item) => ({ date: item.date, weight: item.weight })),
    pain: {
      area: state?.pain?.area || 'none',
      severity: state?.pain?.severity === '' ? null : Number(state?.pain?.severity),
      timing: state?.pain?.timing || '',
      notes: state?.pain?.notes || '',
    },
    question,
  };
}

// ── Drafts (the log sheet) ───────────────────────────────────────────────
/** The most recent performed entry for a movement, used to pre-fill the sheet. */
export function lastPerformedEntry(sessions, exerciseId) {
  const sorted = (sessions || []).slice().sort((a, b) => parseDate(b.date) - parseDate(a.date));
  for (const session of sorted) {
    const entry = sessionEntries(session).find(
      (item) => item.exerciseId === exerciseId && entryPerformedSets(item).length > 0
    );
    if (entry) return entry;
  }
  return null;
}

/**
 * Turn a plan day into an editable, pre-filled log sheet:
 *   - set count / reps / hold time come from the plan
 *   - **the weight comes from the prescribed load**, or from what you lifted
 *     last time if there is history
 *   - nothing is ticked, so only what you actually confirm counts as done
 */
export function buildDraft(day, sessions = [], units = 'kg', date = todayISO()) {
  if (!day) return null;
  return {
    dayId: day.id,
    dayName: day.name,
    focus: day.focus,
    location: day.location || null,
    date,
    unit: units,
    durationMin: day.estimatedMinutes ? String(day.estimatedMinutes) : '',
    rpe: '',
    notes: '',
    blocks: day.blocks.map((block) => ({
      type: block.type,
      title: block.title,
      note: block.note,
      entries: block.items.map((item) => {
        if (item.timed && block.type === 'cardio') {
          return {
            exerciseId: item.exerciseId,
            name: item.name,
            kind: 'cardio',
            muscle: item.muscle || 'cardio',
            minutes: item.minutes,
            distance: item.distance ?? null,
            distanceUnit: item.distanceUnit ?? null,
            prescription: item.prescription || `${item.minutes} min`,
            cue: item.cue,
            done: false,
          };
        }

        const last = lastPerformedEntry(sessions, item.exerciseId);
        const lastSets = last ? entryPerformedSets(last) : [];
        const setCount = Math.max(1, Number(item.sets) || 3);
        const prescribedWeight = item.load && item.load.kind === 'weight' ? item.load.weight : '';

        const sets = Array.from({ length: setCount }, (_, index) => {
          const previous = lastSets[Math.min(index, lastSets.length - 1)];
          return {
            reps: previous?.reps ?? topOfRepRange(item.reps),
            // Prescribed load first, last session second, blank third.
            weight: previous?.weight ?? prescribedWeight,
            done: false,
          };
        });

        return {
          exerciseId: item.exerciseId,
          name: item.name,
          kind: 'lift',
          muscle: item.muscle,
          tier: item.tier,
          unilateral: Boolean(item.unilateral),
          timed: Boolean(item.holdSeconds),
          holdSeconds: item.holdSeconds || null,
          bwNote: item.bwNote || null,
          prescription: formatPrescription(item),
          restSeconds: item.restSeconds,
          load: item.load || null,
          cue: item.cue,
          sets,
        };
      }),
    })),
  };
}

/** Live "what you have logged so far" strip. */
export function summarizeDraft(draft) {
  if (!draft) return { sets: 0, volume: 0, cardioMinutes: 0, exercises: 0 };
  return {
    sets: sessionSetCount(draft),
    volume: sessionVolume(draft, draft.unit || 'kg'),
    cardioMinutes: sessionCardioMinutes(draft),
    exercises: sessionExerciseCount(draft),
  };
}

/** Drop empty, unticked sets so stored history stays readable. */
export function tidyDraft(draft) {
  if (!draft) return draft;
  return {
    ...draft,
    blocks: draft.blocks.map((block) => ({
      ...block,
      entries: block.entries.filter((entry) => {
        if (entry.kind === 'cardio') return true;
        return entry.sets.some((set) => set.done || Number(set.reps) > 0 || Number(set.weight) > 0);
      }),
    })),
  };
}

export function createSessionFromDraft(draft, extra = {}) {
  const tidy = tidyDraft(draft);
  const duration = Number(tidy.durationMin);
  return {
    ...tidy,
    durationMin: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    id: extra.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
    ...extra,
    rpe: extra.rpe ?? tidy.rpe,
    notes: extra.notes ?? tidy.notes,
  };
}

/** Timed holds in a draft, so the sheet can offer a hold timer per movement. */
export function draftTimedEntries(draft) {
  if (!draft) return [];
  return draft.blocks.flatMap((block) => block.entries).filter((entry) => entry.holdSeconds);
}
