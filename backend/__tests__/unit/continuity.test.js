/**
 * continuity.test.js — what the next turn is told about the last one.
 *
 * The rule this suite protects is about NOISE as much as content. A note that
 * appears on every turn is a note the model learns to skim past, so it has to earn
 * its place: an unfinished plan is news, a finished one is not; a failed step is
 * news, a successful one is not. Most of these cases are therefore asserting that
 * nothing is returned.
 *
 * The second thing under test is what the note does with a refusal, because that is
 * where the harness has already learned something the model cannot see: a denied
 * step must not be retried, and the previous turn's `permission` classification is
 * the only place that fact exists by the time the next turn starts.
 */

const {
  continuityNote,
  continuityNoteFromRuns,
  hasOpenPlan,
  failedSteps,
} = require('../../services/harness/continuity.js');

/** A finished run: plan all done, every step ok. */
const finishedRun = (over = {}) => ({
  id: 'run_1',
  outcome: 'completed',
  plan: { items: [{ id: 'p1', text: 'raise the limit', status: 'done' }] },
  steps: [{ tool: 'repo_edit_file', status: 'ok', outcome: null }],
  ...over,
});

describe('continuity — what earns a place in the note', () => {
  it('says NOTHING about a turn that finished cleanly', () => {
    // The common case, and the one that decides whether this feature is signal or
    // wallpaper. A completed turn is not news.
    expect(continuityNote(finishedRun())).toBeNull();
  });

  it('says nothing when there is no previous run at all', () => {
    expect(continuityNote(null)).toBeNull();
    expect(continuityNoteFromRuns([])).toBeNull();
    expect(continuityNoteFromRuns(null)).toBeNull();
  });

  it('says nothing about a chat turn that recorded no steps and no plan', () => {
    expect(continuityNote({ id: 'r', outcome: 'completed', steps: [], plan: null })).toBeNull();
  });
});

describe('continuity — an unfinished plan', () => {
  const unfinished = () => finishedRun({
    plan: {
      items: [
        { id: 'p1', text: 'find the limit', status: 'done' },
        { id: 'p2', text: 'raise it', status: 'in_progress' },
        { id: 'p3', text: 'run the costs suite', status: 'pending' },
      ],
    },
  });

  it('reports progress and names the step it was on', () => {
    const note = continuityNote(unfinished());

    expect(note).toContain('WHERE THE LAST TURN LEFT OFF');
    expect(note).toContain('unfinished (1/3 done)');
    // The current step is the anchor a "keep going" needs.
    expect(note).toContain('it was working on: raise it');
    expect(note).toContain('· [in_progress] raise it');
    expect(note).toContain('· [pending] run the costs suite');
    // Work that finished is not repeated: it is context for the user, not the model.
    expect(note).not.toContain('find the limit');
  });

  it('tells the model to resume rather than restart, without insisting', () => {
    const note = continuityNote(unfinished());
    expect(note).toMatch(/pick up from the step above rather than starting again/);
    // The user may well have moved on — a stale plan must not hijack the turn.
    expect(note).toMatch(/If they have moved on, ignore this/);
  });

  it('treats BLOCKED as unfinished, because it is waiting on someone', () => {
    const note = continuityNote(finishedRun({
      plan: { items: [{ id: 'p1', text: 'needs the API key', status: 'blocked' }] },
    }));
    expect(note).toContain('[blocked] needs the API key');
  });

  it('bounds a long plan instead of pasting it into every prompt', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, text: `step ${i}`, status: 'pending' }));
    const note = continuityNote(finishedRun({ plan: { items: many } }));

    expect(note).toMatch(/…and 6 more/);
    expect(note.length).toBeLessThanOrEqual(600);
  });

  it('is null for a plan with no items, and for a plan that is all done', () => {
    expect(hasOpenPlan({ plan: { items: [] } })).toBe(false);
    expect(hasOpenPlan({ plan: { items: [{ status: 'done' }] } })).toBe(false);
    expect(hasOpenPlan({})).toBe(false);
    expect(continuityNote(finishedRun({ plan: { items: [{ id: 'p', text: 'x', status: 'done' }] } }))).toBeNull();
  });
});

describe('continuity — a failed or refused step', () => {
  it('names the steps that did not succeed, by KIND', () => {
    // The kind is the whole point: `permission` means asking again is pointless,
    // `invalid-input` means the arguments were the problem. A bare "it failed"
    // would leave the model to guess which.
    const note = continuityNote(finishedRun({
      plan: null,
      steps: [
        { tool: 'repo_search', status: 'ok', outcome: null },
        { tool: 'repo_edit_file', status: 'error', outcome: 'not-found' },
        { tool: 'repo_run', status: 'error', outcome: 'fatal' },
      ],
    }));

    expect(note).toContain('repo_edit_file (not-found)');
    expect(note).toContain('repo_run (fatal)');
    // Successful steps are not listed: they are not why anything is outstanding.
    expect(note).not.toContain('repo_search');
  });

  it('tells the model not to retry a refusal on its own', () => {
    const note = continuityNote(finishedRun({
      plan: null,
      steps: [{ tool: 'pc_do', status: 'denied', outcome: 'permission' }],
    }));

    expect(note).toContain('pc_do (permission)');
    expect(note).toMatch(/Do not retry a refused step on your own/);
  });

  it('still reports a refusal recorded without a classification', () => {
    // `status: 'denied'` is set by the journal itself; an older record (or one from
    // a path that predates the taxonomy) has no `outcome` and must still be read as
    // a refusal rather than as an anonymous error.
    const note = continuityNote(finishedRun({
      plan: null,
      steps: [{ tool: 'repo_commit_changes', status: 'denied', outcome: null }],
    }));

    expect(note).toContain('repo_commit_changes (permission)');
    expect(note).toMatch(/Do not retry a refused step/);
  });

  it('caps the list rather than reporting a wall of failures', () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ tool: `t${i}`, status: 'error', outcome: 'fatal' }));
    const note = continuityNote(finishedRun({ plan: null, steps }));
    expect(note).toMatch(/\(\+3 more\)/);
  });

  it('counts only failures, not every step', () => {
    const steps = [
      { tool: 'a', status: 'ok', outcome: null },
      { tool: 'b', status: 'running', outcome: null },
      { tool: 'c', status: 'error', outcome: 'fatal' },
    ];
    expect(failedSteps({ steps }).map((s) => s.tool)).toEqual(['c']);
  });
});

describe('continuity — a cancelled turn', () => {
  it('says the USER stopped it, and not to resume unasked', () => {
    // A cancellation is the user's decision. Without this the model re-plans work
    // they deliberately stopped, or asks why it stopped.
    const note = continuityNote(finishedRun({ outcome: 'cancelled', plan: null, steps: [] }));

    expect(note).toContain('The user STOPPED that turn part-way through');
    expect(note).toMatch(/Do not resume it unless they ask/);
  });

  it('combines with an unfinished plan, which is when it matters most', () => {
    const note = continuityNote(finishedRun({
      outcome: 'cancelled',
      plan: { items: [{ id: 'p1', text: 'half done thing', status: 'in_progress' }] },
    }));

    expect(note).toContain('STOPPED');
    expect(note).toContain('half done thing');
  });
});

describe('continuity — only the most recent turn is consulted', () => {
  it('uses the newest run and ignores the older ones', () => {
    // Two turns back is history. The model needs to know what it was doing, not to
    // be walked through the session.
    const runs = [
      { id: 'new', outcome: 'completed', plan: null, steps: [] },
      { id: 'old', outcome: 'completed', plan: { items: [{ id: 'p1', text: 'ancient work', status: 'pending' }] }, steps: [] },
    ];

    expect(continuityNoteFromRuns(runs)).toBeNull();
  });

  it('survives a malformed record without throwing', () => {
    // It runs inside a prompt builder for every tool turn.
    for (const run of [{}, { steps: 'nope' }, { plan: { items: 'nope' } }, { plan: {}, steps: [null] }]) {
      expect(() => continuityNote(run)).not.toThrow();
    }
    expect(continuityNote({ steps: [null] })).toBeNull();
  });
});
