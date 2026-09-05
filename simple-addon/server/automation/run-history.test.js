/**
 * Standalone unit tests for run-history.js.
 * Run: `node simple-addon/server/automation/run-history.test.js`
 *
 * Redirects APPDATA to a temp dir BEFORE requiring the module so the real
 * user history is never touched (matches permissions.test.js), and uses
 * runHistory._reset() to bust the in-memory cache between cases.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-test-'));
process.env.APPDATA = tmpRoot;

const runHistory = require('./run-history');

let failed = 0, total = 0;
function assert(name, cond, detail) {
    total++;
    if (cond) console.log(`  PASS  ${name}`);
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ─── append + list basics ──────────────────────────────────────────────────
runHistory._reset();
runHistory.clear();

const r1 = runHistory.append({ slug: 'invoice-macro', startedAt: 1000, finishedAt: 1500, stepsRun: 3, stepsTotal: 3, failed: false, outcome: 'done' });
assert('append: stores slug', r1.slug === 'invoice-macro');
assert('append: durationMs computed from start/finish', r1.durationMs === 500);
assert('append: failed defaults to false', r1.failed === false);

runHistory.append({ slug: 'broken', failed: true, error: 'boom', triggerId: 'trg_1', source: 'trigger' });
const list = runHistory.list({ limit: 10 });
assert('list: newest first', list[0].slug === 'broken');
assert('list: trigger metadata preserved', list[0].triggerId === 'trg_1' && list[0].source === 'trigger');
assert('list: both entries present', list.length === 2);

// ─── persistence across reset (simulates restart) ─────────────────────────
runHistory._reset();
const list2 = runHistory.list({ limit: 10 });
assert('persist: reloads from disk after reset', list2.length === 2 && list2[0].slug === 'broken');

// ─── limit + null-safety ──────────────────────────────────────────────────
assert('limit: caps returned count', runHistory.list({ limit: 1 }).length === 1);
const r3 = runHistory.append({ slug: 'x', failed: true, error: 'step 2 failed' });
assert('append: error field stored', r3.error === 'step 2 failed');
assert('append: defaults missing start to Date.now', Number.isFinite(runHistory.append({ slug: 'y' }).startedAt));

// ─── clear ────────────────────────────────────────────────────────────────
const cleared = runHistory.clear();
assert('clear: returns ok', cleared.ok === true);
runHistory._reset();
assert('clear: empties the store', runHistory.list({ limit: 50 }).length === 0);

// ─── cap at RUN_HISTORY_MAX ───────────────────────────────────────────────
runHistory._reset();
for (let i = 0; i < runHistory.RUN_HISTORY_MAX + 10; i++) {
    runHistory.append({ slug: `macro-${i}` });
}
assert('cap: in-memory list bounded at RUN_HISTORY_MAX', runHistory.list({ limit: 1000 }).length === runHistory.RUN_HISTORY_MAX);
runHistory._reset();
assert('cap: disk reload also bounded at RUN_HISTORY_MAX', runHistory.list({ limit: 1000 }).length === runHistory.RUN_HISTORY_MAX);

console.log('');
if (failed === 0) {
    console.log(`run-history.test: ${total}/${total} PASS`);
    process.exit(0);
} else {
    console.log(`run-history.test: ${failed}/${total} FAILED`);
    process.exit(1);
}
