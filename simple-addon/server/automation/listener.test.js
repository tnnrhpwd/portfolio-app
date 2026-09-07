/**
 * listener.test.js — unit tests for the ContinuousListener (always-on loop).
 *
 * Asserts the listener's core policy decisions with injected fakes:
 *   - enable/disable persists and gates ticks
 *   - the kill switch blocks every tick
 *   - idle start fires once per goal (cooldown)
 *   - suggestions auto-start only when high-confidence AND non-destructive
 *   - destructive / low-confidence / already-acted suggestions are skipped
 *
 * Run: node server/automation/listener.test.js
 */

'use strict';

const assert = require('assert');
const { ContinuousListener } = require('./listener');

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

async function asyncTest(name, fn) {
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

function makeListener(overrides = {}) {
    const state = {
        killSwitch: false,
        continuousMode: false,
    };
    const fakes = {
        permissions: {
            load: () => ({ globalKillSwitch: state.killSwitch, continuousMode: state.continuousMode }),
            save: (patch) => { Object.assign(state, patch); return { ...state }; },
        },
        learner: { analyze: async () => [] },
        wsClient: {
            async getNextGoal() { return null; },
            async upsertGoal(slug, body) { return { slug, ...body }; },
        },
        registry: {
            list: () => [
                { name: 'fs_list', category: 'safe-read' },
                { name: 'fs_write', category: 'sandboxed-write' },
                { name: 'shell_run', category: 'shell' },
                { name: 'process_kill', category: 'destructive' },
            ],
        },
        events: { publish: () => {} },
        log: () => {},
        startLoop: () => {},
        getRunningCount: () => 0,
    };
    Object.assign(fakes, overrides);
    const listener = new ContinuousListener(fakes);
    return { listener, fakes, state };
}

(async () => {
    console.log('\nlistener.test: ContinuousListener policy');

    // ── enable/disable + persistence ─────────────────────────────────────
    test('setEnabled(true) persists continuousMode and reports enabled', () => {
        const { listener, state } = makeListener();
        const status = listener.setEnabled(true);
        assert.strictEqual(status.enabled, true);
        assert.strictEqual(state.continuousMode, true, 'persisted');
    });

    test('dispose() stops without persisting a disable', () => {
        const { listener, state } = makeListener();
        listener.setEnabled(true);
        listener.dispose();
        assert.strictEqual(listener.isEnabled(), false);
        assert.strictEqual(state.continuousMode, true, 'flag untouched by dispose');
    });

    // ── kill switch gate ─────────────────────────────────────────────────
    await asyncTest('kill switch blocks the tick entirely', async () => {
        const calls = [];
        const { listener, fakes, state } = makeListener({
            learner: { analyze: async () => [{ sequenceKey: 'k', tools: ['fs_list'], confidence: 0.9 }] },
            startLoop: () => calls.push('start'),
            wsClient: {
                async getNextGoal() { return { slug: 'g' }; },
                async upsertGoal() { calls.push('upsert'); return {}; },
            },
        });
        state.killSwitch = true;
        await listener._tick();
        assert.strictEqual(calls.length, 0, 'nothing ran under kill switch');
    });

    // ── idle start + cooldown ────────────────────────────────────────────
    await asyncTest('idle start fires once per goal within cooldown', async () => {
        const starts = [];
        const { listener } = makeListener({
            wsClient: { async getNextGoal() { return { slug: 'g' }; }, async upsertGoal() { return {}; } },
            startLoop: (slug) => starts.push(slug),
        });
        await listener._maybeStartIdleLoop();
        await listener._maybeStartIdleLoop();
        assert.strictEqual(starts.length, 1, 'only one start within cooldown');
        assert.deepStrictEqual(starts, [null], 'primary loop started (null slug)');
    });

    await asyncTest('idle start does nothing when a loop is already running', async () => {
        const starts = [];
        const { listener } = makeListener({
            wsClient: { async getNextGoal() { return { slug: 'g' }; }, async upsertGoal() { return {}; } },
            startLoop: (slug) => starts.push(slug),
            getRunningCount: () => 1,
        });
        await listener._maybeStartIdleLoop();
        assert.strictEqual(starts.length, 0);
    });

    // ── non-destructive filter ───────────────────────────────────────────
    test('_isNonDestructive accepts safe-read + sandboxed-write only', () => {
        const { listener } = makeListener();
        assert.strictEqual(listener._isNonDestructive(['fs_list']), true);
        assert.strictEqual(listener._isNonDestructive(['fs_list', 'fs_write']), true);
        assert.strictEqual(listener._isNonDestructive(['fs_list', 'shell_run']), false, 'shell is destructive');
        assert.strictEqual(listener._isNonDestructive(['process_kill']), false, 'destructive rejected');
        assert.strictEqual(listener._isNonDestructive(['unknown_tool']), false, 'unknown tool rejected');
        assert.strictEqual(listener._isNonDestructive([]), false, 'empty tool list rejected');
    });

    // ── suggestion auto-start policy ─────────────────────────────────────
    await asyncTest('high-confidence non-destructive suggestion auto-starts once', async () => {
        const starts = [];
        const upserts = [];
        const { listener } = makeListener({
            learner: { analyze: async () => [{ sequenceKey: 'k1', title: 'Tidy files', description: 'clean up', tools: ['fs_list'], confidence: 0.9 }] },
            wsClient: { async getNextGoal() { return null; }, async upsertGoal(slug, body) { upserts.push({ slug, body }); return {}; } },
            startLoop: (slug) => starts.push(slug),
        });
        await listener._maybeAutoStartSuggestions();
        await listener._maybeAutoStartSuggestions(); // same suggestions again
        assert.strictEqual(upserts.length, 1, 'one goal created');
        assert.strictEqual(starts.length, 1, 'one loop started');
        assert.ok(upserts[0].body.autoAbandon === true, 'auto-created goal may self-block');
        assert.ok(String(starts[0]).includes('tidy-files'), `slug derives from title: ${starts[0]}`);
    });

    await asyncTest('low-confidence suggestion is skipped', async () => {
        const starts = [];
        const { listener } = makeListener({
            learner: { analyze: async () => [{ sequenceKey: 'k2', title: 'Weak', tools: ['fs_list'], confidence: 0.3 }] },
            wsClient: { async getNextGoal() { return null; }, async upsertGoal() { return {}; } },
            startLoop: (slug) => starts.push(slug),
        });
        await listener._maybeAutoStartSuggestions();
        assert.strictEqual(starts.length, 0);
    });

    await asyncTest('destructive suggestion is skipped even at high confidence', async () => {
        const starts = [];
        const { listener } = makeListener({
            learner: { analyze: async () => [{ sequenceKey: 'k3', title: 'Risky', tools: ['fs_list', 'shell_run'], confidence: 0.95 }] },
            wsClient: { async getNextGoal() { return null; }, async upsertGoal() { return {}; } },
            startLoop: (slug) => starts.push(slug),
        });
        await listener._maybeAutoStartSuggestions();
        assert.strictEqual(starts.length, 0);
    });

    // ── Goal formation (self-formed goals + surfaced proposals) ─────────
    test('_parseProposals extracts a JSON array', () => {
        const { listener } = makeListener();
        const out = listener._parseProposals('here [{"title":"A","description":"B","tools":["fs_list"],"confidence":0.9}] done');
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].title, 'A');
    });

    await asyncTest('_maybeFormGoals no-ops without an LLM client', async () => {
        const starts = [];
        const { listener } = makeListener({ startLoop: (s) => starts.push(s) });
        await listener._maybeFormGoals();
        assert.strictEqual(starts.length, 0);
    });

    await asyncTest('formed non-destructive high-confidence goal is self-created + started', async () => {
        const starts = [];
        const upserts = [];
        const { listener } = makeListener({
            llmClient: { async chat() { return { text: '[{"title":"Organize Downloads","description":"Sort files into folders","tools":["fs_list","fs_write"],"confidence":0.9}]' }; } },
            wsClient: {
                async getNextGoal() { return null; },
                async listGoals() { return { entries: [] }; },
                async getRecentActions() { return []; },
                async upsertGoal(slug, body) { upserts.push({ slug, body }); return {}; },
            },
            startLoop: (s) => starts.push(s),
        });
        await listener._maybeFormGoals();
        assert.strictEqual(upserts.length, 1, 'one goal created');
        assert.strictEqual(starts.length, 1, 'one loop started');
        assert.strictEqual(upserts[0].body.createdBy, 'listener-formed');
        assert.strictEqual(listener.proposed().length, 1, 'proposal surfaced');
    });

    await asyncTest('formed destructive proposal is surfaced but not auto-created', async () => {
        const starts = [];
        const upserts = [];
        const { listener } = makeListener({
            llmClient: { async chat() { return { text: '[{"title":"Kill app","description":"kill process","tools":["shell_run"],"confidence":0.9}]' }; } },
            wsClient: {
                async getNextGoal() { return null; },
                async listGoals() { return { entries: [] }; },
                async getRecentActions() { return []; },
                async upsertGoal(slug, body) { upserts.push({ slug, body }); return {}; },
            },
            startLoop: (s) => starts.push(s),
        });
        await listener._maybeFormGoals();
        assert.strictEqual(upserts.length, 0, 'destructive not auto-created');
        assert.strictEqual(listener.proposed().length, 1, 'still surfaced for manual accept');
    });

    await asyncTest('formed proposals are deduped across ticks', async () => {
        const upserts = [];
        const { listener } = makeListener({
            llmClient: { async chat() { return { text: '[{"title":"Same task","description":"do it","tools":["fs_list"],"confidence":0.9}]' }; } },
            wsClient: {
                async getNextGoal() { return null; },
                async listGoals() { return { entries: [] }; },
                async getRecentActions() { return []; },
                async upsertGoal(slug, body) { upserts.push({ slug, body }); return {}; },
            },
        });
        await listener._maybeFormGoals();
        listener._lastFormed = 0; // reset cooldown to force a second formation
        await listener._maybeFormGoals();
        assert.strictEqual(upserts.length, 1, 'deduped to one goal');
        assert.strictEqual(listener.proposed().length, 1, 'one proposal');
    });

    await asyncTest('acceptProposal creates + starts a proposal goal (even destructive, user-approved)', async () => {
        const starts = [];
        const upserts = [];
        const { listener } = makeListener({
            llmClient: { async chat() { return { text: '[{"title":"Manual task","description":"do manually","tools":["shell_run"],"confidence":0.5}]' }; } },
            wsClient: {
                async getNextGoal() { return null; },
                async listGoals() { return { entries: [] }; },
                async getRecentActions() { return []; },
                async upsertGoal(slug, body) { upserts.push({ slug, body }); return {}; },
            },
            startLoop: (s) => starts.push(s),
        });
        await listener._maybeFormGoals();
        const id = listener.proposed()[0].id;
        const r = await listener.acceptProposal(id);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(upserts.length, 1, 'accepted proposal created a goal');
        assert.strictEqual(starts.length, 1, 'loop started');
        assert.strictEqual(upserts[0].body.createdBy, 'proposal-accepted');
    });

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
