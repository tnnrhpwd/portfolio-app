/**
 * stop-reason.test.js — the translation from a loop stop token to an explanation.
 *
 * Two of the cases below are copied verbatim from a real chat transcript that read:
 *
 *     🤖 Agent stopped — goal status=done (goal status=done).
 *     🤖 Agent stopped — stalled (stalled).
 *
 * which is what the user saw, and what prompted this file.
 */

const assert = require('assert');
const { OUTCOMES, classifyStop, goalStatusFrom, stopReport } = require('./stop-reason');

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

// ── Classification ──────────────────────────────────────────────────────────
test('classify: the reasons the loop actually produces', () => {
    assert.strictEqual(classifyStop('goal-done-sentinel'), OUTCOMES.DONE);
    assert.strictEqual(classifyStop('goal status=done'), OUTCOMES.GOAL_ENDED);
    assert.strictEqual(classifyStop('goal status=paused'), OUTCOMES.GOAL_ENDED);
    assert.strictEqual(classifyStop('goal status=blocked'), OUTCOMES.GOAL_ENDED);
    assert.strictEqual(classifyStop('goal status=failed'), OUTCOMES.GOAL_ENDED);
    assert.strictEqual(classifyStop('goal status=missing'), OUTCOMES.GOAL_ENDED);
    assert.strictEqual(classifyStop('stalled'), OUTCOMES.STALLED);
    assert.strictEqual(classifyStop('stalled after 6 consecutive no-progress ticks'), OUTCOMES.STALLED);
    assert.strictEqual(classifyStop('max-steps-reached'), OUTCOMES.MAX_STEPS);
    assert.strictEqual(classifyStop('run-timeout'), OUTCOMES.TIMEOUT);
    assert.strictEqual(classifyStop('manual'), OUTCOMES.STOPPED);
    assert.strictEqual(classifyStop('llm-error'), OUTCOMES.ERROR);
});

test('classify: an unrecognised reason is never a guess', () => {
    // A future stop reason must not be silently reinterpreted as something with a
    // different meaning — it degrades to STOPPED and the raw text is preserved.
    assert.strictEqual(classifyStop('something-new'), OUTCOMES.STOPPED);
    assert.strictEqual(classifyStop(''), OUTCOMES.STOPPED);
    assert.strictEqual(classifyStop(null), OUTCOMES.STOPPED);
    assert.strictEqual(classifyStop(undefined), OUTCOMES.STOPPED);
});

test('goalStatusFrom: extracts the status, and only from a goal-status reason', () => {
    assert.strictEqual(goalStatusFrom('goal status=done'), 'done');
    assert.strictEqual(goalStatusFrom('goal status=missing'), 'missing');
    assert.strictEqual(goalStatusFrom('stalled'), null);
    assert.strictEqual(goalStatusFrom('max-steps-reached'), null);
});

// ── The two transcript cases ────────────────────────────────────────────────
test('the reported case: the message is no longer the token twice', () => {
    const r = stopReport({ stopReason: 'stalled', steps: 4, stallCount: 3 });
    assert.strictEqual(r.outcome, OUTCOMES.STALLED);
    // A sentence, not a token — and NOT the same string as the outcome.
    assert.notStrictEqual(r.reason, r.outcome);
    assert.match(r.reason, /without getting anywhere/);
    assert.match(r.reason, /for 3 steps in a row/);
});

test('stall: the tick count survives, from the reason or from the counter', () => {
    // The count is the useful half. `agent-loop.js` used to compute it for an
    // event and then return the bare word 'stalled'; both routes back in now work.
    assert.match(stopReport({ stopReason: 'stalled after 9 consecutive no-progress ticks' }).reason, /for 9 steps/);
    assert.match(stopReport({ stopReason: 'stalled', stallCount: 5 }).reason, /for 5 steps/);
    // Neither available: still a sentence, just without a number.
    const bare = stopReport({ stopReason: 'stalled' }).reason;
    assert.match(bare, /without getting anywhere/);
    assert.doesNotMatch(bare, /for \d+ steps/);
});

test('a goal that was already closed is reported as NOTHING ATTEMPTED', () => {
    // The whole point of the steps===0 distinction: the user must be able to tell
    // "my request never ran" apart from "it ran and then stopped".
    const r = stopReport({ stopReason: 'goal status=done', steps: 0 });
    assert.strictEqual(r.outcome, OUTCOMES.GOAL_ENDED);
    assert.match(r.reason, /nothing was attempted/);
    assert.match(r.reason, /already marked "done"/);
    // …and tells them what to do about it.
    assert.match(r.reason, /Reopen the goal/);
});

test('a goal closed MID-RUN says so instead', () => {
    const r = stopReport({ stopReason: 'goal status=done', steps: 7 });
    assert.strictEqual(r.outcome, OUTCOMES.GOAL_ENDED);
    assert.doesNotMatch(r.reason, /nothing was attempted/);
    assert.match(r.reason, /while the agent was working/);
    assert.match(r.reason, /7|done/);
});

test('a paused goal names the user as the cause', () => {
    const r = stopReport({ stopReason: 'goal status=paused', steps: 2 });
    assert.match(r.reason, /paused/);
    assert.doesNotMatch(r.reason, /nothing was attempted/);
});

test('a missing goal says so plainly', () => {
    const r = stopReport({ stopReason: 'goal status=missing', steps: 0 });
    assert.match(r.reason, /already marked "missing"/);
});

// ── The remaining outcomes say something specific ───────────────────────────
test('max-steps names the budget instead of a bare token', () => {
    const r = stopReport({ stopReason: 'max-steps-reached', steps: 60, maxSteps: 60 });
    assert.strictEqual(r.outcome, OUTCOMES.MAX_STEPS);
    assert.match(r.reason, /of 60 steps/);
    assert.match(r.reason, /without finishing/);
});

test('a timeout reads as a time limit, not a code', () => {
    const r = stopReport({ stopReason: 'run-timeout', steps: 12 });
    assert.strictEqual(r.outcome, OUTCOMES.TIMEOUT);
    assert.match(r.reason, /time limit/);
    // `run-timeout` is a token; it must not be what the user reads.
    assert.doesNotMatch(r.reason, /run-timeout/);
});

test('a finished run with no summary is described as exactly that', () => {
    const r = stopReport({ stopReason: 'goal-done-sentinel', hadAnswer: false });
    assert.strictEqual(r.outcome, OUTCOMES.DONE);
    assert.match(r.reason, /did not write a summary/);
});

test('a manual stop does not blame the agent', () => {
    assert.match(stopReport({ stopReason: 'manual' }).reason, /stopped before it finished/);
    assert.match(stopReport({ stopReason: 'user' }).reason, /stopped before it finished/);
});

test('an unknown reason is echoed rather than explained away', () => {
    const r = stopReport({ stopReason: 'something-new', steps: 1 });
    assert.strictEqual(r.outcome, OUTCOMES.STOPPED);
    assert.match(r.reason, /something-new/);
});

test('every outcome produces a sentence, never an empty reason', () => {
    // The client renders `reason` directly; an empty one would reproduce the
    // original bug in a quieter form.
    const reasons = [
        'goal-done-sentinel', 'goal status=done', 'goal status=paused', 'goal status=blocked',
        'goal status=failed', 'goal status=missing', 'stalled', 'stalled after 2 consecutive no-progress ticks',
        'max-steps-reached', 'run-timeout', 'manual', 'llm-error', 'something-new', '', null,
    ];
    for (const stopReason of reasons) {
        const r = stopReport({ stopReason, steps: 0 });
        assert.ok(typeof r.reason === 'string' && r.reason.trim().length > 10, `empty reason for ${stopReason}`);
        assert.ok(typeof r.outcome === 'string' && r.outcome.trim().length > 0, `empty outcome for ${stopReason}`);
        // The regression itself: the two must never be the same string.
        assert.notStrictEqual(r.reason, r.outcome, `reason === outcome for ${stopReason}`);
    }
});

console.log(`\nstop-reason.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
