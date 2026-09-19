/**
 * harnessStats.js — what the harness has been doing, in aggregate.
 *
 * Six phases of behaviour now exist and every one of them is invisible in the
 * aggregate: you can see ONE turn's steps in the chat, but not "what is the agent
 * doing over time, where does it fail, and what is it costing me". The data was
 * already being written in two places and read by nothing —
 * `routingTelemetry.getRoutingStats()` (in-process counters) and the durable
 * per-user run ring (`stepJournal.readRuns`). This is the surface that reads them.
 *
 * Two decisions shape it:
 *
 *   1. **Pure functions over plain objects.** `summariseRuns`/`summariseTelemetry`
 *      take data, not clients. A summary is the kind of code that is quietly wrong
 *      for months, and it has to be testable with literals rather than a mocked
 *      DynamoDB.
 *   2. **The response says what it is and is not.** The run ring is DURABLE and
 *      per-user; the telemetry counters are IN-PROCESS and reset on deploy. Merging
 *      them into one unnamed number would be a lie, so the two halves are labelled
 *      and the volatile one carries its own `since`.
 *
 * What is deliberately NOT here: per-step detail. The journal keeps that, per turn,
 * for the chat to render. This answers "how is it going", not "what did it do at
 * 14:32" — the question the operator actually asks while standing back.
 */

/** Failure kinds the taxonomy can assign (see toolOutcome.js). */
const FAILURE_KINDS = ['transient', 'invalid-input', 'not-found', 'permission', 'fatal'];

const EMPTY = Object.freeze({
  runs: 0,
  byOutcome: {},
  byFailureKind: {},
  steps: { total: 0, byStatus: {}, byPlane: {}, retried: 0, failed: 0 },
  plans: { published: 0, finished: 0, unfinished: 0 },
  rounds: { total: 0, avg: 0, max: 0 },
  durationMs: { total: 0, avg: 0, max: 0 },
  nudged: 0,
});

/** Count occurrences of a value, skipping null/undefined. */
function tally(counts, key) {
  if (key == null || key === '') return counts;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}

/**
 * Is this plan's work finished? Mirrors continuity.js: `blocked` is unfinished
 * because it is still waiting on something.
 */
function planIsFinished(plan) {
  const items = plan?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.every((item) => item?.status === 'done');
}

/**
 * Summarise the durable run ring — the runs `readRuns` returns (newest first).
 *
 * @param {object[]} runs
 * @returns {object} the aggregate plus `recent`, a bounded per-run digest for the
 *   operator to scan without opening the chat
 */
function summariseRuns(runs) {
  const list = Array.isArray(runs) ? runs.filter((r) => r && typeof r === 'object') : [];
  if (list.length === 0) return { ...EMPTY, recent: [] };

  const summary = {
    runs: list.length,
    byOutcome: {},
    byFailureKind: {},
    steps: { total: 0, byStatus: {}, byPlane: {}, retried: 0, failed: 0 },
    plans: { published: 0, finished: 0, unfinished: 0 },
    rounds: { total: 0, avg: 0, max: 0 },
    durationMs: { total: 0, avg: 0, max: 0 },
    nudged: 0,
    recent: [],
  };

  for (const run of list) {
    tally(summary.byOutcome, run.outcome || 'unknown');
    if (run.nudged) summary.nudged++;

    const rounds = Number(run.rounds) || 0;
    summary.rounds.total += rounds;
    summary.rounds.max = Math.max(summary.rounds.max, rounds);

    const duration = Number(run.durationMs) || 0;
    summary.durationMs.total += duration;
    summary.durationMs.max = Math.max(summary.durationMs.max, duration);

    const steps = Array.isArray(run.steps) ? run.steps.filter(Boolean) : [];
    for (const step of steps) {
      summary.steps.total++;
      tally(summary.steps.byStatus, step.status);
      tally(summary.steps.byPlane, step.plane);
      if (step.retried) summary.steps.retried++;
      // `denied` counts as failed here: the step did not do what was asked, which
      // is the question this number answers.
      if (step.status === 'error' || step.status === 'denied') {
        summary.steps.failed++;
        tally(summary.byFailureKind, step.outcome || (step.status === 'denied' ? 'permission' : 'error'));
      }
    }

    const finished = planIsFinished(run.plan);
    if (finished !== null) {
      summary.plans.published++;
      if (finished) summary.plans.finished++;
      else summary.plans.unfinished++;
    }

    summary.recent.push({
      at: run.at || null,
      outcome: run.outcome || 'unknown',
      rounds,
      steps: steps.length,
      failed: steps.filter((s) => s.status === 'error' || s.status === 'denied').length,
      plan: finished === null ? null : (finished ? 'finished' : 'unfinished'),
      durationMs: duration,
    });
  }

  summary.rounds.avg = Number((summary.rounds.total / summary.runs).toFixed(2));
  summary.durationMs.avg = Math.round(summary.durationMs.total / summary.runs);
  // The ring is newest-first; `recent` reads better oldest-first, like a log.
  summary.recent.reverse();
  return summary;
}

/**
 * Summarise the in-process telemetry counters (`getRoutingStats()`).
 *
 * ⚠️ These are **since this process started** and are NOT per-user: they are
 * bounded, low-cardinality counters by design (see routingTelemetry.js), reset by a
 * deploy. The caller must present them as such — `since` is returned so it can.
 *
 * @param {object} stats
 * @param {string} [startedAt] when the process began serving
 */
function summariseTelemetry(stats = {}, startedAt = null) {
  const total = Number(stats.total) || 0;
  const toolCalls = Number(stats.toolCalls) || 0;
  return {
    since: startedAt,
    turns: total,
    byIntent: { ...(stats.byIntent || {}) },
    toolCalls,
    toolsPerTurn: total ? Number((toolCalls / total).toFixed(2)) : 0,
    deniedToolCalls: Number(stats.deniedToolCalls) || 0,
    adminTurns: Number(stats.adminTurns) || 0,
  };
}

/** The whole picture, as one object. */
function harnessSummary({ runs = [], telemetry = {}, startedAt = null } = {}) {
  const runSummary = summariseRuns(runs);
  return {
    generatedAt: new Date().toISOString(),
    // Anything the reader must know before trusting a number.
    notes: [
      'runs/plans/steps come from the durable per-user turn ring (last 10 turns).',
      `telemetry is in-process only and resets when the server restarts${startedAt ? ` (started ${startedAt})` : ''}.`,
      'A step that was denied counts as failed: it did not do what was asked.',
    ],
    runs: runSummary,
    telemetry: summariseTelemetry(telemetry, startedAt),
    failureKinds: FAILURE_KINDS,
  };
}

module.exports = {
  harnessSummary,
  summariseRuns,
  summariseTelemetry,
  planIsFinished,
  FAILURE_KINDS,
};
