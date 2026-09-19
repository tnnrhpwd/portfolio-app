import { agentStopMessage } from './agentStopMessage.js';

/**
 * What the chat says when an agent run ends without an answer.
 *
 * Both cases below are the responses from a real transcript:
 *
 *     🤖 Agent stopped — goal status=done (goal status=done).
 *     🤖 Agent stopped — stalled (stalled).
 *
 * The user's reply was *"i gave no description of what it tried and it just gave
 * up with a simple error"*. The step count and `stepLog` were both in the response
 * the whole time; the old template rendered neither.
 */

const stepLog = [
  { tool: 'screen_capture', args: {}, ok: true, result: 'ok' },
  { tool: 'find_visual_target', args: {}, ok: true, result: '{"x":120,"y":340}' },
  { tool: 'click_at', args: {}, ok: true, result: 'clicked' },
  { tool: 'type_text', args: {}, ok: false, result: 'Error: no window is focused' },
];

describe('agentStopMessage — it says what happened and what was tried', () => {
  it('explains the stall case that prompted this', () => {
    const out = agentStopMessage({
      status: 'stalled',
      reason: 'it kept trying without getting anywhere for 4 steps in a row — the same approach was not working — so it stopped rather than repeat itself.',
      steps: 9,
      stepLog,
    });

    expect(out).toContain('The agent stopped before finishing');
    expect(out).toContain('Why:');
    expect(out).toContain('for 4 steps in a row');
    expect(out).toContain('How far it got:** 9 steps');
  });

  it('names the steps it tried, with what went wrong', () => {
    const out = agentStopMessage({ status: 'stalled', reason: 'it stalled.', steps: 9, stepLog });

    expect(out).toContain('What it tried');
    expect(out).toContain('`screen capture` — worked');
    // The failing step carries the reason, which is the actionable part.
    expect(out).toContain('`type text` — Error: no window is focused');
    // Tool names are snake_case tokens; the message must not show them raw.
    expect(out).not.toContain('screen_capture');
  });

  it('flags a run where NOTHING was attempted', () => {
    // The important distinction: this request never ran at all, which is a
    // different problem from a run that tried and gave up.
    const out = agentStopMessage({
      status: 'goal-ended',
      reason: 'nothing was attempted — the goal was already marked "done" before the agent looked at it, so it stopped immediately.',
      steps: 0,
      stepLog: [],
    });

    expect(out).toContain('Nothing was attempted');
    expect(out).toContain('already marked "done"');
    expect(out).not.toContain('The agent stopped before finishing');
    // No fabricated evidence when there is none.
    expect(out).not.toContain('What it tried');
  });

  it('does not repeat the status token twice', () => {
    // The literal regression: `— goal status=done (goal status=done)`.
    //
    // An OLD addon build still sends the raw token as the reason, so the token
    // legitimately appears once — echoing back what we were given beats inventing an
    // explanation. What must never happen again is printing it twice, which is what
    // the old template did by rendering `status` and `reason` as separate clauses
    // when both held the same string.
    const out = agentStopMessage({ status: 'goal status=done', reason: 'goal status=done', steps: 0 });

    expect(out.match(/goal status=done/g) || []).toHaveLength(1);
  });

  it('says it once even when status and reason are identical, as before', () => {
    // A new addon sends a sentence; the token is then only in `status`, which this
    // message deliberately does not render at all.
    const out = agentStopMessage({ status: 'stalled', reason: 'stalled', steps: 3 });

    expect(out.match(/stalled/g) || []).toHaveLength(1);
  });

  it('says less rather than guessing when a detail is missing', () => {
    const out = agentStopMessage({ status: 'stopped' });

    expect(out).toContain('The agent stopped before finishing');
    // No reason from the addon → say the token, do not invent a cause.
    expect(out).toContain('stopped');
    expect(out).not.toContain('How far it got');
    expect(out).not.toContain('What it tried');
  });

  it('never renders an empty Why', () => {
    expect(agentStopMessage({})).toMatch(/\*\*Why:\*\* \S/);
    expect(agentStopMessage({ reason: '   ' })).toMatch(/\*\*Why:\*\* \S/);
  });
});

describe('agentStopMessage — bounding the evidence', () => {
  it('shows the LAST few steps, since the end is where it went wrong', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ tool: `tool_${i}`, ok: true, result: 'ok' }));
    const out = agentStopMessage({ status: 'stalled', reason: 'it stalled.', steps: 12, stepLog: many });

    expect(out).toContain('last 6 of 12');
    expect(out).toContain('`tool 11`');
    expect(out).not.toContain('`tool 5`');
    // …and accounts for what it did not show.
    expect(out).toContain('and 6 earlier steps');
  });

  it('clips a long tool result instead of pasting it whole', () => {
    const out = agentStopMessage({
      status: 'stalled',
      reason: 'it stalled.',
      steps: 1,
      stepLog: [{ tool: 'shell_run', ok: false, result: 'x'.repeat(900) }],
    });

    const bullet = out.split('\n').find((l) => l.startsWith('- `shell run`'));
    expect(bullet.length).toBeLessThan(200);
    expect(bullet.endsWith('…')).toBe(true);
  });

  it('singularises one step', () => {
    expect(agentStopMessage({ status: 'stalled', reason: 'r', steps: 1 })).toContain('1 step.');
  });
});
