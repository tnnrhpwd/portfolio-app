import { ADDON_STEP_TYPES, MAX_ADDON_STEPS, stepsFromEvents, upsertStep } from './agentSteps.js';

/** An addon event as the SSE stream delivers it. */
const at = (type, extra = {}) => ({ ts: 1000, type, ...extra });

const open = (callId, tool, extra = {}) => at('tool.start', { callId, tool, args: { a: 1 }, ...extra });
const close = (callId, tool, extra = {}) => at('tool.end', { callId, tool, ok: true, durationMs: 387, ...extra });

describe('opening a step', () => {
  it('adds a running row shaped for StepList', () => {
    const [step] = upsertStep([], open('c1', 'screen_capture', { args: { region: 'x' } }));

    expect(step).toMatchObject({
      id: 'c1',
      index: 1,
      tool: 'screen_capture',
      plane: 'addon',          // → the "PC" badge
      label: 'screen capture', // words in the row, real name in the detail
      status: 'running',
      argsPreview: { region: 'x' },
      ms: null,
      error: null,
    });
  });

  it('keeps the arrival order and numbers the rows', () => {
    const steps = stepsFromEvents([open('c1', 'a'), open('c2', 'b'), open('c3', 'c')]);
    expect(steps.map((s) => [s.id, s.index])).toEqual([['c1', 1], ['c2', 2], ['c3', 3]]);
  });

  it('ignores a duplicate start, so one call is one row', () => {
    const once = upsertStep([], open('c1', 'a'));
    expect(upsertStep(once, open('c1', 'a'))).toBe(once);
  });

  it('stops at the cap rather than growing without bound', () => {
    let steps = [];
    for (let i = 0; i < MAX_ADDON_STEPS + 5; i += 1) steps = upsertStep(steps, open(`c${i}`, 'a'));
    expect(steps).toHaveLength(MAX_ADDON_STEPS);
    expect(steps[0].id).toBe('c0'); // the newest are the ones dropped
  });

  it('tolerates a missing callId (an older addon)', () => {
    const steps = upsertStep([], at('tool.start', { tool: 'a' }));
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe('a-1000');
  });

  it('has no arguments to show when the addon omitted them', () => {
    const [step] = upsertStep([], at('tool.start', { callId: 'c1', tool: 'save_note' }));
    expect(step.argsPreview).toBeNull();
    // NOT `argsRedacted`: absent arguments are not the same claim as withheld
    // ones, and that flag renders "private argument" in the UI.
    expect(step.argsRedacted).toBe(false);
  });
});

describe('closing a step', () => {
  it('updates the SAME row rather than appending a second', () => {
    const steps = stepsFromEvents([open('c1', 'shell_run'), close('c1', 'shell_run')]);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'ok', ms: 387 });
  });

  it('keeps the id, index and arguments through the close', () => {
    const steps = stepsFromEvents([open('c1', 'shell_run', { args: { command: 'dir' } }), close('c1', 'shell_run')]);
    expect(steps[0]).toMatchObject({ id: 'c1', index: 1, argsPreview: { command: 'dir' } });
  });

  it('records a failure as an error, with what the tool said', () => {
    const steps = stepsFromEvents([open('c1', 'uia_invoke'), close('c1', 'uia_invoke', { ok: false, error: 'element not found' })]);
    expect(steps[0]).toMatchObject({ status: 'error', error: 'element not found' });
  });

  it('sorts a REFUSAL into its own status, not a red row', () => {
    // The prefix is the only difference between a decision and a fault, which is
    // the same rule the journal applies server-side.
    const denied = stepsFromEvents([open('c1', 'shell_run'), close('c1', 'shell_run', { ok: false, error: 'Denied: refused on the PC' })]);
    const cancelled = stepsFromEvents([open('c2', 'shell_run'), close('c2', 'shell_run', { ok: false, error: 'Cancelled: the user stopped the turn' })]);
    expect(denied[0].status).toBe('denied');
    expect(cancelled[0].status).toBe('denied');
  });

  it('clips a long result and says how much it dropped', () => {
    const long = 'x'.repeat(500);
    const steps = stepsFromEvents([open('c1', 'repo_search'), close('c1', 'repo_search', { resultPreview: long })]);
    expect(steps[0].resultPreview).toContain('…[500 chars]');
    expect(steps[0].resultPreview.length).toBeLessThan(150);
  });

  it('ignores an end for a step it never saw, rather than inventing a row', () => {
    expect(upsertStep([], close('unknown', 'a'))).toEqual([]);
  });

  it('leaves ms null when the addon did not time the step', () => {
    const steps = stepsFromEvents([open('c1', 'a'), at('tool.end', { callId: 'c1', tool: 'a', ok: true })]);
    expect(steps[0].ms).toBeNull();
  });
});

describe('guards', () => {
  it('drops the HISTORY the stream replays on subscribe', () => {
    const ev = open('c1', 'a');
    expect(upsertStep([], ev, { since: 2000 })).toEqual([]);
    expect(upsertStep([], { ...ev, ts: 3000 }, { since: 2000 })).toHaveLength(1);
  });

  it('returns the SAME array when nothing changes, so React skips the render', () => {
    const steps = stepsFromEvents([open('c1', 'a')]);
    const untouched = [
      steps,
      upsertStep(steps, at('skill.run', { slug: 'x' })),
      upsertStep(steps, null),
      upsertStep(steps, 'nope'),
      upsertStep(steps, at('tool.end', { callId: 'never-seen', ok: true })),
    ];
    for (const result of untouched) expect(result).toBe(steps);
  });

  it('starts from nothing without throwing', () => {
    expect(upsertStep(undefined, open('c1', 'a'))).toHaveLength(1);
    expect(stepsFromEvents(null)).toEqual([]);
  });

  it('subscribes to exactly the two types it is built from', () => {
    // The URL filter and the mapper must agree: a type handled but not requested
    // never arrives, and one requested but not handled is a wasted listener.
    expect([...ADDON_STEP_TYPES].sort()).toEqual(['tool.end', 'tool.start']);
  });
});
