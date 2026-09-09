/**
 * Unit tests for marketplace-gate.js — per-skill (slug@version) persisted
 * state backing the marketplace capability-confirmation + low-trust
 * dry-run-first enforcement (§4.3 / §10.3).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the on-disk gate file from real user data.
process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-gate-test-'));

const gate = require('./marketplace-gate');

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

test('fresh state: nothing confirmed, no dry-run completed', () => {
    assert.strictEqual(gate.capabilitiesConfirmed('slug', '1.0.0'), false);
    assert.strictEqual(gate.dryRunCompleted('slug', '1.0.0'), false);
});

test('confirmCapabilities persists and is version-scoped', () => {
    gate.confirmCapabilities('slug', '1.0.0');
    assert.strictEqual(gate.capabilitiesConfirmed('slug', '1.0.0'), true);
    assert.strictEqual(gate.capabilitiesConfirmed('slug', '2.0.0'), false);
    assert.strictEqual(gate.capabilitiesConfirmed('other', '1.0.0'), false);
});

test('markDryRunCompleted persists and is version-scoped', () => {
    gate.markDryRunCompleted('slug', '1.0.0');
    assert.strictEqual(gate.dryRunCompleted('slug', '1.0.0'), true);
    assert.strictEqual(gate.dryRunCompleted('slug', '2.0.0'), false);
});

test('state survives a cache reset (re-reads from disk)', () => {
    gate._resetForTest();
    assert.strictEqual(gate.capabilitiesConfirmed('slug', '1.0.0'), true);
    assert.strictEqual(gate.dryRunCompleted('slug', '1.0.0'), true);
});

test('missing version coerces to the unknown key without throwing', () => {
    gate.confirmCapabilities('noversion');
    assert.strictEqual(gate.capabilitiesConfirmed('noversion', undefined), true);
});

test('confirmation is sticky across repeated calls', () => {
    gate.confirmCapabilities('stable', '1.0.0');
    gate.confirmCapabilities('stable', '1.0.0');
    assert.strictEqual(gate.capabilitiesConfirmed('stable', '1.0.0'), true);
});

console.log(`\nmarketplace-gate.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
