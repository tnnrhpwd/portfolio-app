/**
 * system.test.js — the message a missed `window_focus` throws.
 *
 * Why this is worth a test. A real run asked for "google message my girlfriend that I
 * love her": the agent called `window_focus` three times, got `window not found` three
 * times, made no progress, and stalled. The tool was not broken — the failure carried
 * NOTHING the model could act on. It could not see which selector it had used, nor that
 * "Google Messages" was in fact open as a browser tab titled something else. So it
 * guessed again, identically.
 *
 * The prompt now tells the agent to read this message and pick a real window instead of
 * repeating the call. That only works if the message actually contains the selector and
 * the candidates, so the content is pinned here.
 *
 * The formatting function is pure; the PowerShell that lists the windows is not, and is
 * exercised only on a real machine.
 */

const assert = require('assert');
const { windowFocusMissMessage } = require('./system');

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

test('names the selector that was actually used', () => {
    // Without this the model cannot tell whether to change the title, the process,
    // or the pid — so it cannot change anything, so it repeats.
    const msg = windowFocusMissMessage('titleContains="Google Messages"', '"Inbox (3) - mail" (msedge)');
    assert.ok(msg.includes('titleContains="Google Messages"'), 'the searched selector must be quoted back');
});

test('names the windows that DO exist', () => {
    const msg = windowFocusMissMessage('processName="msedge"', '"Chats - Google Messages" (msedge)');
    assert.ok(msg.includes('"Chats - Google Messages" (msedge)'), 'the real candidates must be present');
});

test('says plainly not to repeat the identical call', () => {
    // Three identical attempts is the exact behaviour this message exists to end.
    const msg = windowFocusMissMessage('processName="msedge"', '"a" (msedge)');
    assert.ok(/do not repeat this exact call/i.test(msg), 'must forbid the repeat outright');
});

test('carries the Error: prefix every consumer keys on', () => {
    // Unprefixed prose is counted as SUCCESS by the callers that decide "did this
    // work?" — a failed focus reported as a success is worse than the miss itself.
    const msg = windowFocusMissMessage('processName="msedge"', '(none)');
    assert.ok(msg.startsWith('Error: '), 'must announce itself as a failure');
});

test('stays a single usable line when no windows were listed', () => {
    // The PowerShell error path flattens newlines, and a list that failed to build
    // must still leave a sentence the model can follow.
    const msg = windowFocusMissMessage('pid=4242', '(could not be listed — try window_list)');
    assert.ok(msg.includes('window_list'), 'must point at the recovery tool');
    assert.ok(!msg.includes('\n'), 'must not depend on multi-line formatting');
});

console.log(`\nsystem.test: ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
