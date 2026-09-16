/**
 * agentTerminalUtils.test.js — the /simple console's two sources, one shape.
 *
 * The console is fed by an SSE stream (local addon) and a polled step array
 * (cloud run). Both must produce the same line shape, dedupe correctly on a
 * re-poll, and never show a tool's arguments when the addon stripped them.
 */

import {
  TERMINAL_MAX_LINES,
  formatClock,
  formatDuration,
  previewArgs,
  eventToLine,
  cloudStepToLine,
  mergeLines,
} from './agentTerminalUtils.js';

const ev = (type, over = {}) => ({ seq: 1, ts: '2026-09-15T10:00:00.000Z', type, ...over });

describe('agentTerminalUtils · small formatters', () => {
  test('clock and duration read like a terminal', () => {
    expect(formatClock('2026-09-15T10:00:00.000Z')).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(formatClock('not a date')).toBe('--:--:--');
    expect(formatDuration(120)).toBe('120ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });

  test('args are one short parenthetical, and absent when stripped', () => {
    expect(previewArgs({ path: 'a/b.js' })).toBe('path=a/b.js');
    expect(previewArgs({ n: 3, ok: true })).toBe('n=3 ok=true');
    // The addon strips args for PII tools rather than redacting them, so there is
    // nothing to show — and nothing may be invented.
    expect(previewArgs({})).toBe('');
    expect(previewArgs(null)).toBe('');
    expect(previewArgs({ text: 'x'.repeat(400) }).length).toBeLessThanOrEqual(120);
  });
});

describe('agentTerminalUtils · SSE events', () => {
  test('a tool call is running until its result arrives', () => {
    const start = eventToLine(ev('tool.start', { tool: 'fs_write', args: { path: 'a.js' }, callId: 'c1' }));
    expect(start).toMatchObject({ glyph: '▶', status: 'running', text: 'fs_write', detail: 'path=a.js', source: 'local' });

    const ok = eventToLine(ev('tool.end', { tool: 'fs_write', ok: true, durationMs: 240, callId: 'c1' }));
    expect(ok).toMatchObject({ glyph: '✓', status: 'ok', text: 'fs_write', detail: '240ms' });

    const bad = eventToLine(ev('tool.end', { tool: 'fs_write', ok: false, error: 'EACCES', durationMs: 12, callId: 'c2' }));
    expect(bad).toMatchObject({ glyph: '✗', status: 'error', text: 'fs_write failed', detail: 'EACCES · 12ms' });
  });

  test('a start and its end are two distinct lines', () => {
    const a = eventToLine(ev('tool.start', { tool: 't', callId: 'c1' }));
    const b = eventToLine(ev('tool.end', { tool: 't', ok: true, callId: 'c1' }));
    expect(a.key).not.toBe(b.key);
  });

  test('stages, steps and messages are readable without the raw payload', () => {
    expect(eventToLine(ev('agent.stage', { stage: 'PLANNING', loop: 'inner' })))
      .toMatchObject({ glyph: '◆', text: 'stage → planning', detail: 'inner loop', status: 'note' });
    expect(eventToLine(ev('agent.stage', { stage: 'SOMETHING_NEW' })).text).toBe('stage → SOMETHING_NEW');
    expect(eventToLine(ev('agent.step', { step: 4, modelId: 'claude-haiku' })))
      .toMatchObject({ glyph: '·', text: 'step 4', detail: 'claude-haiku' });
    expect(eventToLine(ev('agent.message', { role: 'assistant', content: 'Looking at the file' })).text)
      .toBe('assistant: Looking at the file');
    expect(eventToLine(ev('agent.meta', { summary: 'Repeating the same click' })))
      .toMatchObject({ glyph: '◇', detail: 'self-review', status: 'note' });
  });

  test('outcomes carry their reason', () => {
    expect(eventToLine(ev('goal.done', { result: 'All files sorted' }))).toMatchObject({ glyph: '◼', status: 'ok', detail: 'All files sorted' });
    expect(eventToLine(ev('goal.failed', { reason: 'max-steps-reached' }))).toMatchObject({ glyph: '✗', status: 'error', detail: 'max-steps-reached' });
    expect(eventToLine(ev('goal.blocked', { reason: 'needs a password' }))).toMatchObject({ glyph: '⏸', status: 'error' });
    expect(eventToLine(ev('goal.stalled', { reason: 'no progress' }))).toMatchObject({ glyph: '△', status: 'error' });
    expect(eventToLine(ev('agent.stopped', { reason: 'user requested stop' }))).toMatchObject({ glyph: '■', status: 'error' });
  });

  test('an approval prompt says what needs approving', () => {
    expect(eventToLine(ev('approval.pending', { toolName: 'shell_run', args: { cmd: 'rm -rf x' } })))
      .toMatchObject({ glyph: '⏳', text: 'needs approval: shell_run', detail: 'cmd=rm -rf x', status: 'note' });
    expect(eventToLine(ev('approval.resolved', { toolName: 'shell_run', approved: false })))
      .toMatchObject({ text: 'denied: shell_run', status: 'error' });
  });

  test('an unknown event type is shown, not dropped', () => {
    // A gap in a log is worse than an unfamiliar line in it.
    const line = eventToLine(ev('something.new', { x: 1 }));
    expect(line).toMatchObject({ text: 'something.new', status: 'plain' });
  });

  test('junk produces no line', () => {
    for (const bad of [null, undefined, {}, 'tool.start', 42]) {
      expect(eventToLine(bad)).toBeNull();
    }
  });
});

describe('agentTerminalUtils · cloud steps', () => {
  test('a tool step leads with the tool and its arguments', () => {
    const line = cloudStepToLine({ ts: '2026-09-15T10:00:01.000Z', kind: 'tool', text: 'Calling list_repo_tree', meta: { tool: 'list_repo_tree', args: { path: 'frontend' } } });
    expect(line).toMatchObject({ source: 'cloud', glyph: '▶', status: 'running', text: 'calling list_repo_tree', detail: 'path=frontend' });
  });

  test('the other kinds keep the agent’s own words', () => {
    expect(cloudStepToLine({ kind: 'thought', text: 'I should read the file first' }))
      .toMatchObject({ glyph: '·', text: 'I should read the file first' });
    expect(cloudStepToLine({ kind: 'plan', text: 'Plan:\n1. a\n2. b' }))
      .toMatchObject({ glyph: '≡', text: 'Plan: 1. a 2. b' });
    expect(cloudStepToLine({ kind: 'tool-result', text: 'ok', meta: { tool: 'x' } }))
      .toMatchObject({ glyph: '✓', status: 'ok' });
    expect(cloudStepToLine({ kind: 'error', text: 'no provider' }))
      .toMatchObject({ glyph: '✗', status: 'error' });
    expect(cloudStepToLine({ kind: 'result', text: 'done' }))
      .toMatchObject({ glyph: '◼', status: 'ok' });
  });

  test('junk produces no line', () => {
    expect(cloudStepToLine(null)).toBeNull();
    expect(cloudStepToLine('nope')).toBeNull();
  });
});

describe('agentTerminalUtils · merging', () => {
  const line = (key) => ({ key, text: key });

  test('appends newest last and drops duplicates by key', () => {
    const first = mergeLines([], [line('a'), line('b')]);
    expect(first.map((l) => l.key)).toEqual(['a', 'b']);
    // The cloud source is polled, so every poll re-sends every step.
    const again = mergeLines(first, [line('a'), line('b')]);
    expect(again).toBe(first);
    expect(mergeLines(first, [line('b'), line('c')]).map((l) => l.key)).toEqual(['a', 'b', 'c']);
  });

  test('keeps the newest lines when the cap is reached', () => {
    const many = Array.from({ length: TERMINAL_MAX_LINES + 20 }, (_, i) => line(`k${i}`));
    const merged = mergeLines([], many);
    expect(merged).toHaveLength(TERMINAL_MAX_LINES);
    expect(merged[0].key).toBe('k20');
    expect(merged[merged.length - 1].key).toBe(`k${TERMINAL_MAX_LINES + 19}`);
  });

  test('tolerates junk on either side', () => {
    expect(mergeLines(null, [line('a')])).toHaveLength(1);
    expect(mergeLines([line('a')], null)).toHaveLength(1);
    expect(mergeLines([line('a')], [null, undefined])).toHaveLength(1);
  });
});
