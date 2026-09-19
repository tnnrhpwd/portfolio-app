import {
  AGENT_PROGRESS_TYPES,
  progressFromEvent,
  progressFromStatus,
  toolLabel,
} from './agentProgress.js';

/** An event as the addon's SSE stream delivers it. */
const at = (type, extra = {}) => ({ ts: 1000, type, ...extra });

describe('toolLabel', () => {
  it('turns an addon tool name into words', () => {
    expect(toolLabel('screen_capture')).toBe('screen capture');
    expect(toolLabel('uia-invoke')).toBe('uia invoke');
    expect(toolLabel('')).toBe('a step');
    expect(toolLabel(null)).toBe('a step');
  });
});

describe('progressFromEvent — what the note says', () => {
  it('names the tool as it starts', () => {
    expect(progressFromEvent(at('tool.start', { tool: 'screen_capture' })))
      .toBe('Running screen capture…');
  });

  it('reports a finished step with a bounded duration', () => {
    expect(progressFromEvent(at('tool.end', { tool: 'shell_run', ok: true, durationMs: 387 })))
      .toBe('shell run — done in 0.4s');
    expect(progressFromEvent(at('tool.end', { tool: 'shell_run', ok: true, durationMs: 12345 })))
      .toBe('shell run — done in 12s');
    expect(progressFromEvent(at('tool.end', { tool: 'shell_run', ok: true })))
      .toBe('shell run — done');
  });

  it('shows WHY a step did not work, clipped, rather than a bare failure', () => {
    expect(progressFromEvent(at('tool.end', {
      tool: 'uia_invoke', ok: false, error: 'element not found',
    }))).toBe('uia invoke — element not found');

    const long = progressFromEvent(at('tool.end', { tool: 'x', ok: false, error: 'e'.repeat(500) }));
    expect(long).toContain('…');
    expect(long.length).toBeLessThan(110);

    expect(progressFromEvent(at('tool.end', { tool: 'x', ok: false })))
      .toBe('x — did not work');
  });

  it('says what happens next, from the model willCall list', () => {
    expect(progressFromEvent(at('agent.thought', { willCall: ['repo_search', 'repo_read_file'] })))
      .toBe('Next: repo search, repo read file');
    expect(progressFromEvent(at('agent.thought', {}))).toBe('Thinking…');
  });

  it('counts steps when the loop reports them', () => {
    expect(progressFromEvent(at('agent.step', { step: 3, maxSteps: 60 }))).toBe('Step 3 of 60…');
    expect(progressFromEvent(at('agent.step', { step: 3 }))).toBe('Step 3…');
    expect(progressFromEvent(at('agent.step', {}))).toBeNull();
  });

  it('ignores the HISTORY the stream replays on subscribe', () => {
    const start = at('tool.start', { tool: 'screen_capture' });
    expect(progressFromEvent(start, { since: 2000 })).toBeNull();
    expect(progressFromEvent({ ...start, ts: 3000 }, { since: 2000 })).toBe('Running screen capture…');
    // No timestamp means it cannot be judged — show it, because silence is the
    // failure this whole module exists to fix.
    expect(progressFromEvent({ type: 'tool.start', tool: 'x' }, { since: 2000 }))
      .toBe('Running x…');
  });

  it('is total: junk in, null out', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, []]) {
      expect(progressFromEvent(bad)).toBeNull();
    }
    // A type the chat does not speak for (the stream carries many others).
    expect(progressFromEvent(at('skill.repair.attempt', { tool: 'x' }))).toBeNull();
  });
});

describe('progressFromStatus — the poll fallback', () => {
  it('keeps the wording for a run the loop reports', () => {
    expect(progressFromStatus({ running: true, step: 2, stepLog: [{ tool: 'screen_capture' }] }))
      .toBe('Step 2 — screen capture…');
    expect(progressFromStatus({ running: true, step: 1 })).toBe('Step 1…');
  });

  it('says nothing when the loop is idle or the payload is unusable', () => {
    expect(progressFromStatus({ running: false, step: 9 })).toBeNull();
    expect(progressFromStatus(null)).toBeNull();
    expect(progressFromStatus({})).toBeNull();
    expect(progressFromStatus({ running: true, stepLog: 'nope' })).toBe('Step 0…');
  });
});

describe('the subscription list matches the wording', () => {
  it('covers exactly the events the note speaks for', () => {
    // The URL filter, the listeners and the wording must move together: a type
    // handled but not listed never arrives (named SSE events need an explicit
    // listener), and one listed but not handled is a listener that can say nothing.
    const handled = ['tool.start', 'tool.end', 'agent.thought', 'agent.step'];
    expect([...AGENT_PROGRESS_TYPES].sort()).toEqual([...handled].sort());

    const payloads = {
      'tool.start': { tool: 'a' },
      'tool.end': { tool: 'a', ok: true },
      'agent.thought': {},
      'agent.step': { step: 1 },
    };
    for (const type of AGENT_PROGRESS_TYPES) {
      expect(progressFromEvent(at(type, payloads[type]))).not.toBeNull();
    }
  });
});
