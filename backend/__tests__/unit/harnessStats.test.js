/**
 * harnessStats.test.js — the aggregate an operator reads to answer "how is it
 * going?".
 *
 * A summary is the kind of code that is quietly wrong for months: nobody notices a
 * denominator that counts the wrong runs, or a failure total that quietly excludes
 * refusals. So the cases here are mostly about WHAT IS COUNTED — the empty journal,
 * a refused step, an unfinished plan, a malformed record — rather than about
 * formatting.
 *
 * The other thing under test is honesty. The response merges two sources with
 * different lifetimes (a durable run ring and in-process counters), and the one
 * thing it must never do is present them as a single comparable number.
 */

const {
  harnessSummary,
  summariseRuns,
  summariseTelemetry,
  planIsFinished,
} = require('../../services/harness/harnessStats.js');

const run = (over = {}) => ({
  at: '2026-09-18T10:00:00.000Z',
  outcome: 'completed',
  rounds: 2,
  durationMs: 1200,
  nudged: false,
  plan: null,
  steps: [],
  ...over,
});

const step = (over = {}) => ({
  tool: 'repo_search',
  status: 'ok',
  plane: 'repo',
  outcome: null,
  retried: false,
  ...over,
});

describe('harnessStats — an empty journal is not an error', () => {
  it('returns a zeroed shape rather than throwing or nulling', () => {
    // The state on a fresh deploy, and the state a UI must render without special
    // casing: every field present, nothing to divide by.
    const summary = summariseRuns([]);

    expect(summary.runs).toBe(0);
    expect(summary.rounds.avg).toBe(0);
    expect(summary.durationMs.avg).toBe(0);
    expect(summary.steps).toEqual({ total: 0, byStatus: {}, byPlane: {}, retried: 0, failed: 0 });
    expect(summary.recent).toEqual([]);
  });

  it('tolerates a missing or malformed list', () => {
    expect(summariseRuns(null).runs).toBe(0);
    expect(summariseRuns('nope').runs).toBe(0);
    expect(summariseRuns([null, 'x', 42]).runs).toBe(0);
  });
});

describe('harnessStats — what gets counted', () => {
  it('counts runs, outcomes, rounds and durations', () => {
    const summary = summariseRuns([
      run({ outcome: 'completed', rounds: 2, durationMs: 1000 }),
      run({ outcome: 'cancelled', rounds: 0, durationMs: 400 }),
      run({ outcome: 'completed', rounds: 4, durationMs: 2500 }),
    ]);

    expect(summary.runs).toBe(3);
    expect(summary.byOutcome).toEqual({ completed: 2, cancelled: 1 });
    expect(summary.rounds).toEqual({ total: 6, avg: 2, max: 4 });
    expect(summary.durationMs.avg).toBe(1300);
    expect(summary.durationMs.max).toBe(2500);
  });

  it('counts a DENIED step as failed, because it did not do what was asked', () => {
    // The number an operator reads as "how often does work not happen". A refusal
    // is work that did not happen, and excluding it would flatter the summary.
    const summary = summariseRuns([run({
      steps: [
        step({ status: 'ok' }),
        step({ status: 'denied', outcome: 'permission' }),
        step({ status: 'error', outcome: 'not-found' }),
        step({ status: 'running' }),
      ],
    })]);

    expect(summary.steps.total).toBe(4);
    expect(summary.steps.failed).toBe(2);
    expect(summary.byFailureKind).toEqual({ permission: 1, 'not-found': 1 });
  });

  it('falls back to a usable kind when a step has no classification', () => {
    // An older record, or a path that predates the taxonomy.
    const summary = summariseRuns([run({
      steps: [step({ status: 'denied', outcome: null }), step({ status: 'error', outcome: null })],
    })]);
    expect(summary.byFailureKind).toEqual({ permission: 1, error: 1 });
  });

  it('separates the planes, and counts retries', () => {
    const summary = summariseRuns([run({
      steps: [
        step({ plane: 'repo', retried: true }),
        step({ plane: 'repo' }),
        step({ plane: 'addon' }),
        step({ plane: 'cloud' }),
      ],
    })]);

    expect(summary.steps.byPlane).toEqual({ repo: 2, addon: 1, cloud: 1 });
    expect(summary.steps.retried).toBe(1);
  });

  it('counts plans that were published, and whether they finished', () => {
    // The most useful single number for "is the agent finishing what it starts".
    const open = { items: [{ status: 'done' }, { status: 'pending' }] };
    const done = { items: [{ status: 'done' }] };
    const blocked = { items: [{ status: 'blocked' }] };

    const summary = summariseRuns([
      run({ plan: open }), run({ plan: done }), run({ plan: blocked }), run({ plan: null }),
    ]);

    expect(summary.plans).toEqual({ published: 3, finished: 1, unfinished: 2 });
  });

  it('counts a nudged turn, which is the act-vs-answer policy firing', () => {
    const summary = summariseRuns([run({ nudged: true }), run({ nudged: false }), run({})]);
    expect(summary.nudged).toBe(1);
  });

  it('keeps a bounded per-run digest, oldest first', () => {
    const summary = summariseRuns([
      run({ at: '2026-09-18T12:00:00.000Z', outcome: 'cancelled', steps: [step({ status: 'denied', outcome: 'permission' })] }),
      run({ at: '2026-09-18T09:00:00.000Z', steps: [step(), step()] }),
    ]);

    // `recent` reads like a log — the ring arrives newest-first, so it is reversed.
    expect(summary.recent.map((r) => r.at)).toEqual(['2026-09-18T09:00:00.000Z', '2026-09-18T12:00:00.000Z']);
    expect(summary.recent[0]).toMatchObject({ outcome: 'completed', steps: 2, failed: 0, plan: null });
    expect(summary.recent[1]).toMatchObject({ outcome: 'cancelled', failed: 1, rounds: 2 });
  });
});

describe('harnessStats — plans', () => {
  it('treats `blocked` as unfinished, like continuity does', () => {
    expect(planIsFinished({ items: [{ status: 'done' }, { status: 'blocked' }] })).toBe(false);
    expect(planIsFinished({ items: [{ status: 'done' }] })).toBe(true);
  });

  it('reports null for a run with no plan, so `published` stays honest', () => {
    // null, not false: a chat turn that never published a plan is not an unfinished
    // one, and counting it as such would make the harness look worse than it is.
    expect(planIsFinished(null)).toBeNull();
    expect(planIsFinished({ items: [] })).toBeNull();
  });
});

describe('harnessStats — telemetry, and saying what it is', () => {
  it('derives tools-per-turn and keeps the intent split', () => {
    const summary = summariseTelemetry({ total: 4, toolCalls: 10, byIntent: { tool: 3, chat: 1 }, deniedToolCalls: 2, adminTurns: 4 });

    expect(summary).toMatchObject({ turns: 4, toolCalls: 10, toolsPerTurn: 2.5, deniedToolCalls: 2, adminTurns: 4 });
    expect(summary.byIntent).toEqual({ tool: 3, chat: 1 });
  });

  it('does not divide by zero on a fresh process', () => {
    expect(summariseTelemetry({}).toolsPerTurn).toBe(0);
  });

  it('carries a `since` so volatile numbers cannot be read as durable', () => {
    const summary = summariseTelemetry({ total: 1 }, '2026-09-18T08:00:00.000Z');
    expect(summary.since).toBe('2026-09-18T08:00:00.000Z');
  });

  it('labels the two sources separately in the combined summary', () => {
    // The failure this prevents: presenting an in-process counter and a durable ring
    // as one comparable number.
    const summary = harnessSummary({
      runs: [run()],
      telemetry: { total: 2 },
      startedAt: '2026-09-18T08:00:00.000Z',
    });

    expect(summary.runs.runs).toBe(1);
    expect(summary.telemetry.turns).toBe(2);
    expect(summary.notes.join(' ')).toMatch(/in-process only and resets/);
    expect(summary.notes.join(' ')).toMatch(/durable per-user turn ring/);
    expect(summary.notes.join(' ')).toMatch(/denied counts as failed/);
    expect(summary.generatedAt).toEqual(expect.any(String));
  });
});
