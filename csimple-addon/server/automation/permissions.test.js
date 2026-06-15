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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'csimple-perm-test-'));
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

// ── Summary + cleanup ───────────────────────────────────────────────────────
(async () => {
    for (const t of queue) await t();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    console.log(`\npermissions.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})();
