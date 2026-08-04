/**
 * predictor.test.js — Unit tests for the behavioral n-gram predictor.
 *
 * Tests recording, prediction math, and prefetch cache behavior without
 * any network calls. Run: node server/automation/predictor.test.js
 */

'use strict';

const assert = require('assert');

// Each test gets a fresh instance — don't use the singleton.
const { Predictor } = require('./predictor');

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

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${e.message}`);
        failed++;
    }
}

// ── Basic record + predict ─────────────────────────────────────────────────────

console.log('\npredictor.test: record + predict');

test('new predictor has empty history', () => {
    const p = new Predictor();
    const stats = p.getStats();
    assert.strictEqual(stats.historyLength, 0);
    assert.strictEqual(stats.bigramKeys, 0);
});

test('predict returns empty array with < 2 history entries', () => {
    const p = new Predictor();
    p.record('screen_capture', {});
    assert.deepStrictEqual(p.predict(), []);
});

test('bigram prediction: A→B repeated builds high probability', () => {
    const p = new Predictor();
    // Record 10x: screen_capture → uia_snapshot
    // End on screen_capture so predict() forecasts what follows it.
    for (let i = 0; i < 10; i++) {
        p.record('screen_capture', {});
        p.record('uia_snapshot', {});
    }
    p.record('screen_capture', {}); // final seed: predict after screen_capture
    const preds = p.predict();
    assert(preds.length > 0, 'should have predictions');
    assert.strictEqual(preds[0].tool, 'uia_snapshot', `top prediction should be uia_snapshot, got ${preds[0].tool}`);
    assert(preds[0].probability > 0.5, `probability should be > 0.5, got ${preds[0].probability}`);
});

test('trigram prediction: A→B→C repeated is preferred over A→B→D', () => {
    const p = new Predictor();
    // Establish A→B→C (8 times)
    for (let i = 0; i < 8; i++) {
        p.record('screen_capture', {});
        p.record('uia_snapshot', {});
        p.record('shell_run', {});
    }
    // Add A→B→D (3 times)
    for (let i = 0; i < 3; i++) {
        p.record('screen_capture', {});
        p.record('uia_snapshot', {});
        p.record('fs_read', {});
    }
    // Seed so we are in the A→B state (predict what follows uia_snapshot after screen_capture)
    p.record('screen_capture', {});
    p.record('uia_snapshot', {});
    const preds = p.predict();
    assert(preds.length > 0, 'should have predictions');
    assert.strictEqual(preds[0].tool, 'shell_run', `expected shell_run, got ${preds[0].tool}`);
});

test('predictions are sorted by probability descending', () => {
    const p = new Predictor();
    for (let i = 0; i < 5; i++) {
        p.record('screen_capture', {});
        p.record('uia_snapshot', {});
    }
    for (let i = 0; i < 2; i++) {
        p.record('screen_capture', {});
        p.record('shell_run', {});
    }
    const preds = p.predict();
    for (let i = 1; i < preds.length; i++) {
        assert(preds[i - 1].probability >= preds[i].probability, 'predictions not sorted');
    }
});

test('predictions capped at 5', () => {
    const p = new Predictor();
    const tools = ['screen_capture', 'uia_snapshot', 'shell_run', 'fs_read', 'clipboard_read', 'window_list', 'process_list'];
    for (let i = 0; i < 4; i++) {
        p.record('screen_capture', {});
        for (const t of tools.slice(1)) {
            p.record('screen_capture', {});
            p.record(t, {});
        }
    }
    const preds = p.predict();
    assert(preds.length <= 5, `should have ≤5 predictions, got ${preds.length}`);
});

// ── ingestActionLog ────────────────────────────────────────────────────────────

console.log('\npredictor.test: ingestActionLog');

test('ingestActionLog builds history from entries', () => {
    const p = new Predictor();
    const entries = [
        { tool: 'screen_capture', args: {} },
        { tool: 'uia_snapshot', args: {} },
        { tool: 'screen_capture', args: {} },
        { tool: 'uia_snapshot', args: {} },
    ];
    p.ingestActionLog(entries);
    assert.strictEqual(p.getStats().historyLength, 4);
    assert(p.getStats().bigramKeys > 0);
});

test('ingestActionLog handles entries with `name` instead of `tool`', () => {
    const p = new Predictor();
    p.ingestActionLog([
        { name: 'screen_capture', args: {} },
        { name: 'uia_snapshot', args: {} },
    ]);
    assert.strictEqual(p.getStats().historyLength, 2);
});

test('ingestActionLog skips entries without tool/name', () => {
    const p = new Predictor();
    p.ingestActionLog([{ result: 'ok' }, { tool: 'screen_capture', args: {} }]);
    assert.strictEqual(p.getStats().historyLength, 1);
});

// ── setEnabled / disabled state ────────────────────────────────────────────────

console.log('\npredictor.test: setEnabled');

test('disabled predictor ignores record calls', () => {
    const p = new Predictor();
    p.setEnabled(false);
    p.record('screen_capture', {});
    p.record('uia_snapshot', {});
    assert.strictEqual(p.getStats().historyLength, 0);
});

test('disabled predictor returns empty predictions', () => {
    const p = new Predictor();
    p.setEnabled(false);
    assert.deepStrictEqual(p.predict(), []);
});

// ── getStats ───────────────────────────────────────────────────────────────────

console.log('\npredictor.test: getStats');

test('getStats returns expected fields', () => {
    const p = new Predictor();
    const s = p.getStats();
    assert('enabled' in s);
    assert('prefetchEnabled' in s);
    assert('historyLength' in s);
    assert('bigramKeys' in s);
    assert('trigramKeys' in s);
    assert('prefetchCached' in s);
    assert('lastTools' in s);
    assert(Array.isArray(s.lastTools));
});

test('lastTools reflects most recent 5 records', () => {
    const p = new Predictor();
    const tools = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    tools.forEach(t => p.record(t, {}));
    const last = p.getStats().lastTools;
    assert.deepStrictEqual(last, tools.slice(-5));
});

// ── Prefetch (no-op without configured fns) ────────────────────────────────────

console.log('\npredictor.test: prefetch');

test('getPrefetched returns null when nothing cached', () => {
    const p = new Predictor();
    assert.strictEqual(p.getPrefetched('screen_capture', {}), null);
});

testAsync('prefetch executes configured fn when probability threshold met', async () => {
    const p = new Predictor();
    let prefetchCalled = false;
    p.configure({
        prefetchEnabled: true,
        prefetchFns: {
            screen_capture: async () => { prefetchCalled = true; return { base64: 'test' }; },
        },
    });
    // Build very strong bigram signal
    for (let i = 0; i < 20; i++) {
        p.record('uia_snapshot', {});
        p.record('screen_capture', {});
    }
    // Trigger prefetch (happens inside record via _maybePrefetch)
    // Give async ops a tick to complete
    await new Promise(r => setTimeout(r, 50));
    assert(prefetchCalled, 'prefetch fn should have been called');
});

// ── Results ────────────────────────────────────────────────────────────────────

// Wait for async tests
setTimeout(() => {
    console.log(`\npredictor.test: ${passed + failed}/${passed + failed} complete`);
    if (failed > 0) {
        console.error(`\n${failed} test(s) failed`);
        process.exit(1);
    }
    console.log(`Results: ${passed} passed, ${failed} failed`);
}, 200);
