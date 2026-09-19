/**
 * Unit tests for the permission gate, focused on the autoApproveAll flag and
 * the hard-stop guarantees around it (deny / kill switch always win).
 *
 * Runs fully offline. The config path is redirected to an OS temp dir via
 * APPDATA BEFORE permissions.js is required, so the real user config is never
 * touched.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Redirect config storage to a throwaway temp dir.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-perm-test-'));
process.env.APPDATA = tmpRoot;

const permissions = require('./permissions');

let pass = 0, fail = 0;
const queue = [];
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
function asyncTest(name, fn) {
    queue.push(async () => {
        try { await fn(); console.log(`  PASS  ${name}`); pass++; }
        catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
    });
}

// Reset config to defaults before each behavioral test.
function reset(partial = {}) {
    permissions.save({ ...permissions.DEFAULTS, ...partial });
    permissions._reset();
}

const askTool = { name: 'shell_run', category: 'shell' };          // category default 'ask'
const safeTool = { name: 'fs_read', category: 'safe-read' };       // category default 'allow'
const denyTool = { name: 'evil', category: 'shell' };              // we'll per-tool deny it

// ── autoApproveAll: false (default) → 'ask' still needs a requester ──────────
asyncTest('autoApproveAll off: ask tool with no requester → blocked', async () => {
    reset({ autoApproveAll: false });
    permissions.setApprovalRequester(null);
    const r = await permissions.requestApproval(askTool, { command: 'Write-Host hi' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.mode, 'ask');
});

// ── autoApproveAll: true → 'ask' is auto-allowed without a requester ─────────
asyncTest('autoApproveAll on: ask tool auto-approved', async () => {
    reset({ autoApproveAll: true });
    let requesterCalled = false;
    permissions.setApprovalRequester(async () => { requesterCalled = true; return { approved: false }; });
    const r = await permissions.requestApproval(askTool, { command: 'Write-Host hi' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mode, 'allow');
    assert.strictEqual(r.approvedBy, 'auto-approve-all');
    assert.strictEqual(requesterCalled, false, 'requester must NOT be consulted when auto-approving');
});

// ── Hard stop: kill switch still blocks even with autoApproveAll ─────────────
asyncTest('autoApproveAll on + kill switch → denied', async () => {
    reset({ autoApproveAll: true, globalKillSwitch: true });
    const r = await permissions.requestApproval(askTool, { command: 'Write-Host hi' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.mode, 'deny');
});

// ── Hard stop: explicit per-tool deny still blocks ──────────────────────────
asyncTest('autoApproveAll on + per-tool deny → denied', async () => {
    reset({ autoApproveAll: true, tools: { evil: 'deny' } });
    const r = await permissions.requestApproval(denyTool, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.mode, 'deny');
});

// ── `AUTOMATION_SECURITY.md`: every deny path surfaces a user-visible, specific reason ────────
asyncTest('kill-switch deny reason names the kill switch', async () => {
    reset({ globalKillSwitch: true });
    const r = await permissions.requestApproval(askTool, { command: 'Write-Host hi' });
    assert.strictEqual(r.mode, 'deny');
    assert.ok(String(r.reason).toLowerCase().includes('kill switch'), `expected kill-switch reason, got: ${r.reason}`);
});

asyncTest('per-tool deny reason names the tool', async () => {
    reset({ tools: { evil: 'deny' } });
    const r = await permissions.requestApproval(denyTool, {});
    assert.strictEqual(r.mode, 'deny');
    assert.ok(String(r.reason).toLowerCase().includes('evil'), `expected tool name in reason, got: ${r.reason}`);
});

asyncTest('category deny reason names the category', async () => {
    reset({ categories: { shell: 'deny' } });
    const r = await permissions.requestApproval(askTool, { command: 'Write-Host hi' });
    assert.strictEqual(r.mode, 'deny');
    assert.ok(String(r.reason).toLowerCase().includes('shell'), `expected category in reason, got: ${r.reason}`);
});

// ── dryRunMode wins over autoApproveAll (returns dry-run, still ok) ──────────
asyncTest('autoApproveAll on + dryRunMode → dry-run', async () => {
    reset({ autoApproveAll: true, dryRunMode: true });
    const r = await permissions.requestApproval(askTool, { command: 'Get-Process' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mode, 'dry-run');
});

// ── safe-read 'allow' tools unaffected by the flag ──────────────────────────
asyncTest('safe-read tool always allowed regardless of flag', async () => {
    reset({ autoApproveAll: false });
    const r = await permissions.requestApproval(safeTool, {});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mode, 'allow');
});

// ── userInitiated still short-circuits before auto-approve branch ───────────
asyncTest('userInitiated ask → allowed as user-chat-request', async () => {
    reset({ autoApproveAll: false });
    const r = await permissions.requestApproval(askTool, { command: 'whatever' }, { userInitiated: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.approvedBy, 'user-chat-request');
});

// ── Flag persists through save/load round-trip ──────────────────────────────
test('autoApproveAll persists via save + reload', () => {
    permissions.save({ autoApproveAll: true });
    permissions._reset();
    assert.strictEqual(permissions.load().autoApproveAll, true);
});

test('keyboard capture consent defaults to false', () => {
    reset();
    assert.strictEqual(permissions.hasKeyboardCaptureConsent(), false);
});

test('grant/revoke keyboard capture consent updates state', () => {
    reset();
    permissions.grantKeyboardCaptureConsent();
    assert.strictEqual(permissions.hasKeyboardCaptureConsent(), true);
    permissions.revokeKeyboardCaptureConsent();
    assert.strictEqual(permissions.hasKeyboardCaptureConsent(), false);
});

test('cloud vision consent defaults to false', () => {
    reset();
    assert.strictEqual(permissions.hasCloudVisionConsent(), false);
});

test('grant/revoke cloud vision consent updates state', () => {
    reset();
    permissions.grantCloudVisionConsent('test-policy');
    assert.strictEqual(permissions.hasCloudVisionConsent(), true);
    const afterGrant = permissions.load();
    assert.strictEqual(afterGrant.cloudVision.policyVersion, 'test-policy');
    permissions.revokeCloudVisionConsent();
    assert.strictEqual(permissions.hasCloudVisionConsent(), false);
    const afterRevoke = permissions.load();
    assert.strictEqual(afterRevoke.cloudVision.policyVersion, 'test-policy');
});

test('updateConsents returns detailed grant/revoke change metadata', () => {
    reset();
    const granted = permissions.updateConsents({
        keyboardCapture: true,
        cloudVision: true,
        cloudVisionPolicyVersion: 'policy-v2',
    });
    assert.strictEqual(granted.changes.length, 2);
    assert.strictEqual(granted.changes[0].action, 'granted');
    assert.strictEqual(granted.changes[1].action, 'granted');
    assert.strictEqual(granted.changes[1].policyVersion, 'policy-v2');
    assert.strictEqual(granted.config.dataCapture.keyboard, true);
    assert.strictEqual(granted.config.cloudVision.granted, true);

    const revoked = permissions.updateConsents({ keyboardCapture: false, cloudVision: false });
    assert.strictEqual(revoked.changes.length, 2);
    assert.strictEqual(revoked.changes[0].action, 'revoked');
    assert.strictEqual(revoked.changes[1].action, 'revoked');
    assert.strictEqual(revoked.config.dataCapture.keyboard, false);
    assert.strictEqual(revoked.config.cloudVision.granted, false);
    assert.strictEqual(revoked.config.cloudVision.policyVersion, 'policy-v2');
});

test('updateConsents returns no changes when requested values already match', () => {
    reset();
    const out = permissions.updateConsents({});
    assert.strictEqual(out.changes.length, 0);
});

// ── A cloud-dispatched prompt must EXPIRE (AUTOMATION_SECURITY.md §7.1.2) ────
//
// The gap this closes: the cloud waits ~120s for a relay-dispatched tool, but the
// prompt on the PC had no deadline of its own, so an unanswered 'ask' could be
// approved MINUTES later and run an action from a turn that no longer existed.

asyncTest('a relay-dispatched ask that is never answered is REFUSED, not left pending', async () => {
    reset({ autoApproveAll: false });
    permissions.setApprovalRequester(() => new Promise(() => {})); // never answers
    const startedAt = Date.now();
    const r = await permissions.requestApproval(askTool, { command: 'x' }, { approvalTimeoutMs: 40 });
    assert.strictEqual(r.ok, false, 'an expired prompt must not allow the tool');
    assert.strictEqual(r.mode, 'ask');
    assert.match(r.reason, /expired and nothing was run/);
    // It returned because of the deadline, not because the requester resolved.
    assert.ok(Date.now() - startedAt >= 30, 'should have waited out the deadline');
});

asyncTest('a late approval changes nothing — the call has already returned', async () => {
    reset({ autoApproveAll: false });
    let lateAnswer;
    permissions.setApprovalRequester(() => new Promise((resolve) => { lateAnswer = resolve; }));
    const first = await permissions.requestApproval(askTool, { command: 'x' }, { approvalTimeoutMs: 30 });
    assert.strictEqual(first.ok, false);

    // The user clicks Approve after the cloud gave up. That answer belongs to a
    // tool call that already returned, so it must not reach anything.
    lateAnswer({ approved: true });
    await new Promise((r2) => setTimeout(r2, 10));
    assert.strictEqual(first.ok, false, 'the refusal already returned must stand');
});

asyncTest('an answered prompt within the deadline still works normally', async () => {
    reset({ autoApproveAll: false });
    permissions.setApprovalRequester(async () => ({ approved: true, approvedBy: 'user' }));
    const r = await permissions.requestApproval(askTool, { command: 'x' }, { approvalTimeoutMs: 500 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.approvedBy, 'user');
});

asyncTest('a LOCAL step keeps the old behaviour: no deadline means wait for the human', async () => {
    // A prompt in front of the user is answered on the user's schedule; expiring
    // it under them would be a regression, which is why the deadline is opt-in.
    reset({ autoApproveAll: false });
    let resolveIt;
    permissions.setApprovalRequester(() => new Promise((resolve) => { resolveIt = resolve; }));
    const pending = permissions.requestApproval(askTool, { command: 'x' });
    setTimeout(() => resolveIt({ approved: true }), 30);
    const r = await pending;
    assert.strictEqual(r.ok, true, 'a slow local answer must still be honoured');
});

test('the relay deadline is UNDER the cloud dispatch window', () => {
    // Otherwise the addon would always answer after the cloud had already given
    // up, which is the state that produced the "it may still be running" report.
    const ms = permissions.relayApprovalTimeoutMs();
    assert.ok(ms > 0 && ms < 120000, `expected a deadline under the cloud's 120s, got ${ms}`);
});

test('the relay deadline is tunable, and a nonsense value falls back', () => {
    const original = process.env.ADDON_APPROVAL_TIMEOUT_MS;
    process.env.ADDON_APPROVAL_TIMEOUT_MS = '5000';
    assert.strictEqual(permissions.relayApprovalTimeoutMs(), 5000);
    process.env.ADDON_APPROVAL_TIMEOUT_MS = 'not-a-number';
    assert.strictEqual(permissions.relayApprovalTimeoutMs(), 110000);
    process.env.ADDON_APPROVAL_TIMEOUT_MS = '-1';
    assert.strictEqual(permissions.relayApprovalTimeoutMs(), 110000);
    if (original === undefined) delete process.env.ADDON_APPROVAL_TIMEOUT_MS;
    else process.env.ADDON_APPROVAL_TIMEOUT_MS = original;
});

// ── Refusal CAUSES ──────────────────────────────────────────────────────────
// The gate already returned a human-readable `reason`; what it did not return was
// any machine-readable account of WHY. The cloud inferred it from the wording with
// a regex, and got two of these six branches wrong — the kill switch and an
// expired prompt both reached the model as faults, the expired one labelled
// "not retryable". So each branch is pinned to its cause here.

asyncTest('denial: the kill switch is its own cause', async () => {
    reset({ globalKillSwitch: true, categories: { 'shell': 'deny' } });
    permissions.setApprovalRequester(null);
    const r = await permissions.requestApproval(askTool, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.cause, permissions.CAUSES.KILL_SWITCH);
    // Still the specific, actionable reason it always was.
    assert.match(r.reason, /kill switch/i);
});

asyncTest('denial: a per-tool deny and a category deny share the policy cause', async () => {
    reset({ tools: { evil: 'deny' }, categories: { 'shell': 'deny' } });
    permissions.setApprovalRequester(null);
    const perTool = await permissions.requestApproval({ name: 'evil', category: 'shell' }, {});
    // ...and the reason still says WHICH rule, which is why they are distinguishable
    // to a human even though the cause matches.
    assert.match(perTool.reason, /is set to deny/i);

    reset({ categories: { 'shell': 'deny' } });
    const perCategory = await permissions.requestApproval(askTool, {});
    assert.strictEqual(perCategory.cause, permissions.CAUSES.POLICY_DENY);
    assert.match(perCategory.reason, /category "shell"/);
});

asyncTest('denial: a human saying no is not the same cause as a policy saying no', async () => {
    reset({ categories: { 'shell': 'ask' } });
    permissions.setApprovalRequester(async () => ({ approved: false, reason: 'not now' }));
    const r = await permissions.requestApproval(askTool, {});
    assert.strictEqual(r.cause, permissions.CAUSES.USER_DECLINED);
    assert.match(r.reason, /not now/);
});

asyncTest('denial: an expired prompt is expired, not declined', async () => {
    // The distinction the deadline used to lose: "approved: false" covered both,
    // so nobody-answered was reported to the user as a decision they made.
    reset({ categories: { 'shell': 'ask' } });
    permissions.setApprovalRequester(async () => new Promise(() => {})); // never answers
    const r = await permissions.requestApproval(askTool, {}, { approvalTimeoutMs: 30 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.cause, permissions.CAUSES.EXPIRED);
    assert.match(r.reason, /no answer within/i);
});

asyncTest('denial: a prompt that THROWS is a fault, never blamed on the user', async () => {
    reset({ categories: { 'shell': 'ask' } });
    permissions.setApprovalRequester(async () => { throw new Error('IPC closed'); });
    const r = await permissions.requestApproval(askTool, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.cause, permissions.CAUSES.PROMPT_FAILED);
});

asyncTest('denial: no requester wired up is a fault, not a refusal by anyone', async () => {
    reset({ categories: { 'shell': 'ask' } });
    permissions.setApprovalRequester(null);
    const r = await permissions.requestApproval(askTool, {});
    assert.strictEqual(r.cause, permissions.CAUSES.NO_REQUESTER);
});

test('denial: only a person\'s answer (or absence) is re-askable', () => {
    // `deny` is documented as a hard stop, so offering a retry for one would be a
    // lie: the same stored rule refuses again. This is asserted as policy, not as
    // an implementation detail.
    assert.strictEqual(permissions.isRetryableCause(permissions.CAUSES.USER_DECLINED), true);
    assert.strictEqual(permissions.isRetryableCause(permissions.CAUSES.EXPIRED), true);
    assert.strictEqual(permissions.isRetryableCause(permissions.CAUSES.POLICY_DENY), false);
    assert.strictEqual(permissions.isRetryableCause(permissions.CAUSES.KILL_SWITCH), false);
    // Unknown causes are never re-askable — the same rule the cloud applies.
    assert.strictEqual(permissions.isRetryableCause(undefined), false);
    assert.strictEqual(permissions.isRetryableCause('something-new'), false);
});

test('denial: every cause is a plain lowercase token', () => {
    for (const cause of Object.values(permissions.CAUSES)) {
        assert.match(cause, /^[a-z][a-z0-9-]*$/, `cause "${cause}" must survive the wire regex`);
    }
});

// ── The wire form ───────────────────────────────────────────────────────────
// The cause has to ride inside the error STRING: the relay throws, posts
// `{ error: err.message }`, and the backend stores and returns strings. Every hop
// is String, so a field would be dropped.

test('wire: a refusal carries its cause in an anchored, parseable token', () => {
    const { encodeRefusal } = require('./refusal-wire');
    const text = encodeRefusal('expired', 'no answer within 110s — nothing was run.');
    assert.strictEqual(text, 'DENIED[expired]: no answer within 110s — nothing was run.');
    // What backend/services/pcTools.js matches. Anchored: a token in the middle of
    // a sentence must not count.
    assert.deepStrictEqual(/^DENIED\[([a-z][a-z0-9-]*)\]:\s*([\s\S]*)$/.exec(text).slice(1),
        ['expired', 'no answer within 110s — nothing was run.']);
});

test('wire: no cause means no token, rather than an invented one', () => {
    const { encodeRefusal } = require('./refusal-wire');
    // A fabricated cause would be acted on as a fact, which is worse than the
    // cloud falling back to its legacy guess.
    assert.strictEqual(encodeRefusal(null, 'Unknown tool: nope'), 'Unknown tool: nope');
    assert.strictEqual(encodeRefusal(undefined, 'some failure'), 'some failure');
    assert.strictEqual(encodeRefusal('', 'some failure'), 'some failure');
});

test('wire: an empty reason still produces a parseable message', () => {
    const { encodeRefusal } = require('./refusal-wire');
    assert.strictEqual(encodeRefusal('policy-deny', ''), 'DENIED[policy-deny]: refused');
    assert.deepStrictEqual(/^DENIED\[([a-z][a-z0-9-]*)\]:\s*(.+)$/.exec(
        encodeRefusal('policy-deny', null)).slice(1), ['policy-deny', 'refused']);
});

// ── The registry hop ────────────────────────────────────────────────────────
// The cause is only useful if it survives `executeTool`, which is the boundary the
// cloud actually talks to. If this link were dropped the cloud would silently fall
// back to its legacy regex guess — no error, no log, just the old wrong answer for
// the kill switch and the expired prompt. That is the kind of failure that is
// invisible for months, so it gets a test.

asyncTest('registry: a refusal returns its cause alongside the reason', async () => {
    const registry = require('./tool-registry');
    reset({ categories: { shell: 'ask' } });
    permissions.setApprovalRequester(async () => ({ approved: false, reason: 'User denied' }));
    registry.register({ name: 'test_refusable', category: 'shell', run: async () => 'ran' });

    const outcome = await registry.executeTool('test_refusable', {}, {});
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.cause, permissions.CAUSES.USER_DECLINED);
    // The human-facing half is untouched by any of this.
    assert.strictEqual(outcome.error, 'User denied');
});

asyncTest('registry: a permitted tool carries no cause', async () => {
    const registry = require('./tool-registry');
    reset({ categories: { 'safe-read': 'allow' } });
    registry.register({ name: 'test_allowed', category: 'safe-read', run: async () => 'ran' });

    const outcome = await registry.executeTool('test_allowed', {}, {});
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.cause, undefined);
});

asyncTest('registry: the audit record keeps the cause next to the prose', async () => {
    // "Why was this refused?" is asked months later, by a human reading the log.
    const registry = require('./tool-registry');
    reset({ globalKillSwitch: true, categories: { shell: 'deny' } });
    registry.register({ name: 'test_audited', category: 'shell', run: async () => 'ran' });
    const written = [];
    await registry.executeTool('test_audited', {}, { addAction: async (r) => written.push(r) });

    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0].denyCause, permissions.CAUSES.KILL_SWITCH);
    assert.match(written[0].result, /kill switch/i);
});

// ── Summary + cleanup ───────────────────────────────────────────────────────
(async () => {
    for (const t of queue) await t();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    console.log(`\npermissions.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})();
