/**
 * Unit tests for the addon chat's formatting module.
 *
 * Run: node renderer/chat/chat-format.test.js
 *
 * Plain node + assert, matching the other addon renderer tests (no Jest here — the
 * renderer has no bundler and this module is a classic script).
 *
 * The DRIFT test is the important one: this module mirrors wording owned by two
 * frontend ES modules that it cannot import (see the header of chat-format.js). It
 * reads those files and asserts every shared fragment is still there, so a wording
 * change on the website fails the addon's test run instead of quietly making the
 * same event say two different things on two surfaces.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fmt = require('./chat-format');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FRONTEND_PROGRESS = path.join(REPO_ROOT, 'frontend', 'src', 'utils', 'simpleAddon', 'agentProgress.js');
const FRONTEND_STOP = path.join(REPO_ROOT, 'frontend', 'src', 'utils', 'simpleAddon', 'agentStopMessage.js');

function readSource(file) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (e) {
    return null;
  }
}

console.log('\nchat-format.test: wording stays in step with /net');

test('both website modules are where this mirror expects them', () => {
  assert(readSource(FRONTEND_PROGRESS), `missing ${FRONTEND_PROGRESS}`);
  assert(readSource(FRONTEND_STOP), `missing ${FRONTEND_STOP}`);
});

test('every shared wording fragment still appears on the website', () => {
  const frontend = `${readSource(FRONTEND_PROGRESS) || ''}\n${readSource(FRONTEND_STOP) || ''}`;
  const missing = [];
  for (const anchor of fmt.WORDING_ANCHORS) {
    if (!frontend.includes(anchor)) missing.push(anchor);
  }
  assert.deepStrictEqual(missing, [], `the website no longer says: ${JSON.stringify(missing)}`);
});

test('every shared wording fragment is actually used in this module', () => {
  const own = readSource(path.join(__dirname, 'chat-format.js')) || '';
  const unused = fmt.WORDING_ANCHORS.filter((anchor) => {
    // The anchors are declared once in WORDING_ANCHORS; a second occurrence is a use.
    const occurrences = own.split(anchor).length - 1;
    return occurrences < 2;
  });
  assert.deepStrictEqual(unused, [], `declared but not used: ${JSON.stringify(unused)}`);
});

console.log('\nchat-format.test: the live note (progressFromEvent)');

test('tool.start names the tool in words', () => {
  assert.strictEqual(fmt.progressFromEvent({ type: 'tool.start', tool: 'screen_capture' }), 'Running screen capture…');
});

test('tool.end reports the duration on success', () => {
  assert.strictEqual(
    fmt.progressFromEvent({ type: 'tool.end', tool: 'uia_snapshot', ok: true, durationMs: 431 }),
    'uia snapshot — done in 0.4s',
  );
  assert.strictEqual(
    fmt.progressFromEvent({ type: 'tool.end', tool: 'uia_snapshot', ok: true, durationMs: 2400 }),
    'uia snapshot — done in 2s',
  );
  assert.strictEqual(fmt.progressFromEvent({ type: 'tool.end', tool: 'x', ok: true }), 'x — done');
});

test('tool.end reports the failure reason rather than a bare "failed"', () => {
  assert.strictEqual(
    fmt.progressFromEvent({ type: 'tool.end', tool: 'window_focus', ok: false, error: 'window "Edge  " not found' }),
    'window focus — window "Edge " not found',
  );
  assert.strictEqual(fmt.progressFromEvent({ type: 'tool.end', tool: 'window_focus', ok: false }), 'window focus — did not work');
});

test('a long failure reason is flattened and clipped to one line', () => {
  const why = 'Error: ' + 'x'.repeat(400);
  const note = fmt.progressFromEvent({ type: 'tool.end', tool: 't', ok: false, error: why });
  assert(note.length < 120, `note too long: ${note.length}`);
  assert(note.endsWith('…'), note);
  assert(!note.includes('\n'));
});

test('agent.thought names what is next, or says it is thinking', () => {
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.thought', willCall: ['uia_snapshot', 'click_at'] }), 'Next: uia snapshot, click at');
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.thought', willCall: [] }), 'Thinking…');
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.thought' }), 'Thinking…');
});

test('agent.step shows the budget only when there is one', () => {
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.step', step: 7, maxSteps: 60 }), 'Step 7 of 60…');
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.step', step: 7 }), 'Step 7…');
  assert.strictEqual(fmt.progressFromEvent({ type: 'agent.step' }), null);
});

test('replayed history is filtered by `since` — the ring replays on subscribe', () => {
  const event = { type: 'tool.start', tool: 'screen_capture', ts: 1000 };
  assert.strictEqual(fmt.progressFromEvent(event, { since: 2000 }), null);
  assert.strictEqual(fmt.progressFromEvent(event, { since: 500 }), 'Running screen capture…');
});

test('an untimestamped event is shown rather than dropped', () => {
  assert.strictEqual(fmt.progressFromEvent({ type: 'tool.start', tool: 'x' }, { since: 9999 }), 'Running x…');
});

test('junk in, null out — never a throw, never a bogus sentence', () => {
  for (const bad of [null, undefined, 'nope', 42, [], {}]) {
    assert.strictEqual(fmt.progressFromEvent(bad), null, String(bad));
  }
  assert.strictEqual(fmt.progressFromEvent({ type: 'something.else' }), null);
});

test('the poll fallback names the last step and stays quiet when nothing runs', () => {
  assert.strictEqual(fmt.progressFromStatus({ running: true, step: 4, stepLog: [{ tool: 'text_type' }] }), 'Step 4 — text type…');
  assert.strictEqual(fmt.progressFromStatus({ running: true, step: 4 }), 'Step 4…');
  assert.strictEqual(fmt.progressFromStatus({ running: false, step: 4 }), null);
  assert.strictEqual(fmt.progressFromStatus(null), null);
});

console.log('\nchat-format.test: the step rows');

test('a finished stepLog becomes one row per tool call', () => {
  const rows = fmt.stepsFromStepLog([
    { tool: 'uia_snapshot', ok: true, result: 'ok' },
    { tool: 'click_at', ok: false, result: 'Error: no target' },
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].status, 'ok');
  assert.strictEqual(rows[0].label, 'uia snapshot');
  assert.strictEqual(rows[1].status, 'error');
  assert.strictEqual(rows[1].detail, 'Error: no target');
  assert.strictEqual(rows[0].ok, true);
  assert.strictEqual(rows[1].ok, false);
});

test('a non-string result is summarised as JSON, never "[object Object]"', () => {
  const rows = fmt.stepsFromStepLog([{ tool: 'pc_status', ok: true, result: { online: true, tools: 53 } }]);
  assert(rows[0].detail.includes('"online":true'), rows[0].detail);
  assert(!rows[0].detail.includes('[object Object]'));
});

test('stepsFromStepLog tolerates junk', () => {
  assert.deepStrictEqual(fmt.stepsFromStepLog(null), []);
  assert.deepStrictEqual(fmt.stepsFromStepLog('nope'), []);
  assert.deepStrictEqual(fmt.stepsFromStepLog([]), []);
  const rows = fmt.stepsFromStepLog([null, { tool: 'x' }]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].tool, 'a step');
  assert.strictEqual(rows[0].status, 'error');
});

test('tool.end CLOSES the row tool.start opened — it does not append a second', () => {
  let steps = fmt.applyStepEvent([], { seq: 1, type: 'tool.start', tool: 'screen_capture', callId: 'c1' });
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].status, 'running');
  steps = fmt.applyStepEvent(steps, { seq: 2, type: 'tool.end', tool: 'screen_capture', callId: 'c1', ok: true, durationMs: 1200 });
  assert.strictEqual(steps.length, 1, 'the finished step must replace the running one');
  assert.strictEqual(steps[0].status, 'ok');
  assert.strictEqual(steps[0].ms, 1200);
});

test('two interleaved calls are matched by callId, not by position', () => {
  let steps = [];
  steps = fmt.applyStepEvent(steps, { type: 'tool.start', tool: 'a', callId: 'one' });
  steps = fmt.applyStepEvent(steps, { type: 'tool.start', tool: 'b', callId: 'two' });
  steps = fmt.applyStepEvent(steps, { type: 'tool.end', tool: 'b', callId: 'two', ok: true, durationMs: 10 });
  steps = fmt.applyStepEvent(steps, { type: 'tool.end', tool: 'a', callId: 'one', ok: false });
  assert.deepStrictEqual(steps.map((s) => [s.tool, s.status]), [['a', 'error'], ['b', 'ok']]);
});

test('a tool.end with no matching start is still shown, named', () => {
  const steps = fmt.applyStepEvent([], { type: 'tool.end', tool: 'skill_run', ok: true, durationMs: 300 });
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].tool, 'skill_run');
  assert.strictEqual(steps[0].status, 'ok');
});

test('the no-callId fallback closes the OLDEST open row of that name', () => {
  let steps = [];
  steps = fmt.applyStepEvent(steps, { seq: 1, type: 'tool.start', tool: 'uia_find' });
  steps = fmt.applyStepEvent(steps, { seq: 2, type: 'tool.start', tool: 'uia_find' });
  steps = fmt.applyStepEvent(steps, { seq: 3, type: 'tool.end', tool: 'uia_find', ok: true });
  assert.deepStrictEqual(steps.map((s) => s.status), ['ok', 'running']);
});

test('an irrelevant event leaves the list alone, and does not mutate the input', () => {
  const before = [{ id: 'a', tool: 'x', status: 'running' }];
  const after = fmt.applyStepEvent(before, { type: 'agent.thought', text: 'hi' });
  assert.deepStrictEqual(after, before);
  assert.notStrictEqual(after, before, 'a new array is returned so the caller can compare identity');
});

test('the summary counts steps, failures and total time', () => {
  assert.strictEqual(fmt.summariseSteps([{ status: 'ok', ms: 900 }, { status: 'error', ms: 1500 }]), '2 steps · 1 failed · 2.4s');
  assert.strictEqual(fmt.summariseSteps([{ status: 'running', ms: null }]), '1 step');
  assert.strictEqual(fmt.summariseSteps([]), '0 steps');
});

console.log('\nchat-format.test: what the bubble says when the run ends');

test('an answer is the answer', () => {
  const out = fmt.runOutcome({ actionable: true, result: 'I opened Edge.', steps: 3, stepLog: [] });
  assert.strictEqual(out.kind, 'answer');
  assert.strictEqual(out.text, 'I opened Edge.');
});

test('a blank answer falls through to the stop report rather than an empty bubble', () => {
  const out = fmt.runOutcome({ actionable: true, result: '   ', steps: 2, reason: 'it stalled.', stepLog: [] });
  assert.strictEqual(out.kind, 'stopped');
  assert(out.text.includes('it stalled.'));
});

test('a failure announces itself with the Error: prefix', () => {
  const out = fmt.runOutcome({ actionable: true, error: 'no-active-goal' });
  assert.strictEqual(out.kind, 'error');
  assert.strictEqual(out.text, 'Error: no-active-goal');
});

test('a low-confidence action asks instead of acting', () => {
  const out = fmt.runOutcome({ actionable: false, needsDisambiguation: true, question: 'Do you want me to actually do this?' });
  assert.strictEqual(out.kind, 'question');
  assert.strictEqual(out.text, 'Do you want me to actually do this?');
});

test('a non-actionable message shows the conversational reply', () => {
  assert.strictEqual(fmt.runOutcome({ actionable: false, chatReply: 'Hello!' }).text, 'Hello!');
  const bare = fmt.runOutcome({ actionable: false });
  assert(bare.text.length > 20, 'a non-actionable message with no reply must still say something');
});

test('the goal slug rides along so the bubble can link to it', () => {
  assert.strictEqual(fmt.runOutcome({ actionable: true, result: 'done', goalSlug: 'open-edge' }).goalSlug, 'open-edge');
});

test('a stop with NOTHING attempted reads differently from a stop mid-work', () => {
  const nothing = fmt.agentStopMessage({ status: 'goal-ended', reason: 'nothing was attempted.', steps: 0, stepLog: [] });
  assert(nothing.includes('🤖 **Nothing was attempted**'), nothing);

  const midwork = fmt.agentStopMessage({ status: 'stalled', reason: 'it kept trying.', steps: 9, stepLog: [{ tool: 'screen_capture', ok: true }] });
  assert(midwork.includes('🤖 **The agent stopped before finishing**'), midwork);
  assert(!midwork.includes('Nothing was attempted'));
});

test('the stop report names what it tried, newest last', () => {
  const log = [];
  for (let i = 0; i < 8; i++) log.push({ tool: `tool_${i}`, ok: i % 2 === 0, result: i % 2 === 0 ? 'ok' : 'Error: nope' });
  const text = fmt.agentStopMessage({ status: 'max-steps', reason: 'it used its whole budget.', steps: 60, stepLog: log });
  assert(text.includes('**What it tried** (last 6 of 8):'), text);
  assert(text.includes('- `tool 7` — Error: nope'), text);
  assert(text.includes('- `tool 6` — worked'), text);
  assert(text.includes('…and 2 earlier steps.'), text);
  assert(text.includes('**How far it got:** 60 steps.'), text);
});

test('a stop report with no stepLog says less instead of inventing detail', () => {
  const text = fmt.agentStopMessage({ status: 'stopped', reason: 'it was stopped.', steps: 1 });
  assert(!text.includes('What it tried'), text);
  assert(text.includes('**How far it got:** 1 step.'), text);
});

test('a missing reason still explains rather than printing a bare token', () => {
  const text = fmt.agentStopMessage({ status: 'stalled' });
  assert(text.includes('it stopped (stalled).'), text);
});

console.log('\nchat-format.test: wiring');

test('the SSE type filter is built from AGENT_PROGRESS_TYPES, not a second list', () => {
  const chatJs = readSource(path.join(__dirname, '..', 'chat.js'));
  assert(chatJs, 'renderer/chat.js is missing');
  assert(
    chatJs.includes('AGENT_PROGRESS_TYPES'),
    'renderer/chat.js must build its SSE `types` filter from AGENT_PROGRESS_TYPES — a named SSE event that is not listed never arrives',
  );
});

/**
 * ⚠️ The bug this exists for: chat.html loads CLASSIC scripts, so every top-level
 * `const` in them shares ONE lexical scope. `chat-format.js` and `appearance.js` both
 * declared `const API`, which is not a shadow — it is a SyntaxError that kills the
 * whole file, and the chat window rendered its "failed to load its own scripts"
 * fallback with no other clue.
 *
 * So this asserts what the page actually requires: no top-level name declared twice
 * across the scripts chat.html loads. Method: a top-level binding is a line starting
 * with `const`/`let`/`var`/`function`/`async function` at column 0. Anything nested
 * is indented, so it is not a page-level binding.
 */
test('no two scripts on the chat page declare the same top-level name', () => {
  const sources = ['appearance/appearance.js', 'chat/chat-format.js', 'chat/chat-store.js', '../chat.js'];
  const owners = new Map();
  const clashes = [];

  for (const rel of sources) {
    const src = readSource(path.join(__dirname, '..', rel)) || readSource(path.join(__dirname, rel));
    assert(src, `could not read ${rel} — the collision check must not pass by reading nothing`);
    for (const match of src.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = match[1];
      if (owners.has(name)) clashes.push(`${name} (${owners.get(name)} + ${rel})`);
      else owners.set(name, rel);
    }
  }

  assert.deepStrictEqual(clashes, [], `classic scripts share one scope — rename or wrap in an IIFE: ${clashes.join(', ')}`);
});

console.log(`\nchat-format.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
