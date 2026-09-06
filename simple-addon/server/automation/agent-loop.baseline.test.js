/**
 * agent-loop.baseline.test.js — Phase 0 baseline freeze for the O-O-G-P-A
 * refactor (docs/implementation/OBSERVE-ORIENT-GOAL-PLAN-ACTION.md).
 *
 * Asserts the EXACT current ReAct-loop behavior of agent-loop.js so every
 * later refactor (named stages, Orient, Goal cadence, critic, idleness) can
 * be proven non-regressive: for a canned goal with a mocked LLM + registry,
 * the loop must call the LLM exactly the expected number of times and issue
 * the exact tool-call sequence — no more, no fewer.
 *
 * Run: node server/automation/agent-loop.baseline.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

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

// ── Seed lazy-required modules BEFORE requiring agent-loop.js ────────────────
// agent-loop.js only `require()`s these inside functions, but we want a fully
// offline, deterministic run: a fake event bus, a fake perception bus, a fake
// planner, and a fake skill module.
const eventsPath = require.resolve('./events');
require.cache[eventsPath] = {
    id: eventsPath, filename: eventsPath, loaded: true,
    exports: {
        _published: [],
        publish(type, data) { this._published.push({ type, data }); return { seq: this._published.length, ts: Date.now(), type, ...data }; },
    },
};

const perceptionPath = require.resolve('./perception-bus');
require.cache[perceptionPath] = {
    id: perceptionPath, filename: perceptionPath, loaded: true,
    exports: {
        getPerceptionBus: () => ({ getLatestFrame: () => null, getHistory: () => [] }),
        frameToContextString: () => '',
    },
};

const plannerPath = require.resolve('./planner');
require.cache[plannerPath] = {
    id: plannerPath, filename: plannerPath, loaded: true,
    exports: { shouldPlan: () => false, planGoal: async () => ({ skipped: true }) },
};

const skillPath = require.resolve('./tools/skill');
require.cache[skillPath] = {
    id: skillPath, filename: skillPath, loaded: true,
    exports: { getAllCachedSkills: () => [] },
};

const { createAgentLoop } = require('./agent-loop');

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20, label = 'condition' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

const CANNED_GOAL = {
    slug: 'canned-goal',
    name: 'Canned baseline goal',
    status: 'active',
    content: 'Do a deterministic thing.',
    successCriteria: '',
};

function makeFakes() {
    const llmCalls = [];
    const executed = [];

    const llmClient = {
        // Deterministic script: first turn returns two tool calls, second turn
        // returns the <<GOAL_DONE>> sentinel.
        async chat(req) {
            llmCalls.push(req);
            if (llmCalls.length === 1) {
                return {
                    text: 'I will run two tools.',
                    toolCalls: [
                        { id: 'call_1', function: { name: 'toolA', arguments: '{"x":1}' } },
                        { id: 'call_2', function: { name: 'toolB', arguments: '{"y":2}' } },
                    ],
                };
            }
            return { text: 'Finished. <<GOAL_DONE>>', toolCalls: [] };
        },
    };

    const registry = {
        schemaCalls: 0,
        toolSchemasForLlm() {
            this.schemaCalls++;
            return [
                { type: 'function', function: { name: 'toolA', description: 'A', parameters: {} } },
                { type: 'function', function: { name: 'toolB', description: 'B', parameters: {} } },
            ];
        },
        async executeTool(name, args, ctx) {
            executed.push({ name, args });
            return { ok: true, result: `ran ${name}`, mode: 'allow', durationMs: 1 };
        },
    };

    const wsClient = {
        async getGoal() { return { ...CANNED_GOAL }; },
        async getNextGoal() { return { ...CANNED_GOAL }; },
        async getContext() { return { workspaceContext: '' }; },
        async listSkills() { return { entries: [] }; },
        async upsertGoal() { return {}; },
    };

    return { llmCalls, executed, llmClient, registry, wsClient };
}

async function runBaseline() {
    const { llmCalls, executed, llmClient, registry, wsClient } = makeFakes();
    const loop = createAgentLoop({
        wsClient,
        registry,
        contextFactory: (extra = {}) => ({ log: () => {}, ...extra }),
        log: () => {},
        llmClient,
        memory: {
            async recallEpisodes() { return []; },
            async recallLessons() { return []; },
            async recallSuggestions() { return []; },
        },
    });

    const started = await loop.start({ goalSlug: CANNED_GOAL.slug, skipPlanner: true });
    assert.strictEqual(started.running, true, 'loop should report running after start');

    await waitFor(() => loop.status().running === false, { label: 'loop to finish' });

    return { llmCalls, executed, registry, loop };
}

// ── Tests ────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\nagent-loop.baseline.test: Phase 0 frozen behavior');

    const { llmCalls, executed, registry, loop } = await runBaseline();

    test('llm.chat is called exactly twice (tools, then sentinel)', () => {
        assert.strictEqual(llmCalls.length, 2, `expected 2 LLM calls, got ${llmCalls.length}`);
    });

    test('tool call sequence is exactly [toolA, toolB]', () => {
        assert.deepStrictEqual(executed.map(e => e.name), ['toolA', 'toolB']);
    });

    test('tool args are parsed from the LLM JSON', () => {
        assert.deepStrictEqual(executed[0].args, { x: 1 });
        assert.deepStrictEqual(executed[1].args, { y: 2 });
    });

    test('no extra tool calls beyond the two returned', () => {
        assert.strictEqual(executed.length, 2);
    });

    test('tool schemas were requested from the registry', () => {
        assert.ok(registry.schemaCalls >= 2, `toolSchemasForLlm should be called each step, got ${registry.schemaCalls}`);
    });

    test('loop exits with reason goal-done-sentinel', () => {
        assert.strictEqual(loop.status().stopReason, 'goal-done-sentinel');
    });

    test('loop ran 2 steps', () => {
        assert.strictEqual(loop.status().step, 2);
    });

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
