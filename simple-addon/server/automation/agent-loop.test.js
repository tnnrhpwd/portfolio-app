/**
 * agent-loop.test.js — Phase 1 unit tests for the O-O-G-P-A stage functions
 * (docs/implementation/simple-agent-prompt.md §11).
 *
 * Asserts each named stage (`observe` / `orient` / `selectGoal` / `plan` /
 * `act` / `reflect`) returns the documented plain-object shape when driven
 * directly with injected fakes, and that the happy-path stage machine emits
 * the expected `agent.stage` transition order.
 *
 * Run: node server/automation/agent-loop.test.js
 */

'use strict';

const assert = require('assert');
const { AgentLoop } = require('./agent-loop');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 15, label = 'condition' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return;
        await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

const GOAL = { slug: 'g', name: 'Test goal', status: 'active', content: 'do a thing' };

function makeFakes(overrides = {}) {
    const fakes = {
        events: { _log: [], publish(type, data) { this._log.push({ type, data }); } },
        wsClient: {
            async getGoal(slug) { return { ...GOAL, slug: slug || GOAL.slug }; },
            async getNextGoal() { return { ...GOAL }; },
            async getContext() { return { workspaceContext: 'CTX' }; },
            async listSkills() { return { entries: [] }; },
            async upsertGoal() { return {}; },
            async getRecentActions() { return []; },
            async appendLog() { return {}; },
        },
        registry: {
            toolSchemasForLlm() { return [{ type: 'function', function: { name: 'toolA', description: '', parameters: {} } }]; },
            async executeTool(name, args, ctx) { return { ok: true, result: `ran ${name}`, mode: 'allow', durationMs: 1 }; },
        },
        contextFactory: (extra = {}) => ({ log: () => {}, ...extra }),
        log: () => {},
        llmClient: { async chat() { return { text: 'ok', toolCalls: [] }; } },
        perception: { getPerceptionBus: () => ({ getLatestFrame: () => null }), frameToContextString: () => '' },
        planner: { shouldPlan: () => false, planGoal: async () => ({ skipped: true }) },
        skillModule: { getAllCachedSkills: () => [] },
        memory: {
            async recallEpisodes() { return []; },
            async recallLessons() { return []; },
            async recallSuggestions() { return []; },
        },
    };
    Object.assign(fakes, overrides);
    return fakes;
}

function newLoop(overrides = {}) {
    const fakes = makeFakes(overrides);
    const loop = new AgentLoop(fakes);
    loop.state.currentGoal = { ...GOAL };
    return { loop, fakes };
}

(async () => {
    console.log('\nagent-loop.test: O-O-G-P-A stage shapes');

    // ── observe() ────────────────────────────────────────────────────────
    await asyncTest('observe() returns the documented Frame shape', async () => {
        const { loop } = newLoop();
        const frame = await loop.observe();
        assert.ok(frame.ts, 'frame has ts');
        assert.deepStrictEqual(frame.toolNames, ['toolA']);
        assert.strictEqual(frame.toolSchemas.length, 1);
        assert.strictEqual(frame.wsContextString, 'CTX');
        assert.ok(Array.isArray(frame.skillHints));
        assert.strictEqual(frame.perceptionContext, null);
        assert.strictEqual(loop.state.step, 1, 'observe increments the step counter');
    });

    // ── orient() ─────────────────────────────────────────────────────────
    await asyncTest('orient() returns systemPrompt + userTick', async () => {
        const { loop } = newLoop();
        const frame = await loop.observe();
        const sit = await loop.orient(frame);
        assert.ok(sit.systemPrompt.includes('== GOAL =='), 'system prompt includes GOAL block');
        assert.ok(sit.systemPrompt.includes('toolA'), 'system prompt lists tools');
        assert.strictEqual(sit.userTick, 'Begin. What is your first action?');
    });

    await asyncTest('orient() uses the continue tick after step 1', async () => {
        const { loop } = newLoop();
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 3;
        const sit = await loop.orient({ toolNames: [], toolSchemas: [], wsContextString: '', skillHints: [], perceptionContext: null });
        assert.ok(sit.userTick.includes('Continue.'), `got: ${sit.userTick}`);
    });

    // ── Phase 2: orient bounded + ordered ────────────────────────────────
    const BIG_ORIENT = {
        perception: { getPerceptionBus: () => ({ getLatestFrame: () => ({}) }), frameToContextString: () => 'PERCEPTION ' + 'p'.repeat(200) },
        memory: {
            async recallEpisodes() { return Array.from({ length: 10 }, (_, i) => ({ tool: 'shell_run', summary: `EPISODE-${i}-` + 'e'.repeat(150) })); },
            async recallLessons() { return Array.from({ length: 2 }, (_, i) => ({ content: { pattern: `LESSON-${i}-` + 'l'.repeat(200) } })); },
            async recallSuggestions() { return Array.from({ length: 5 }, (_, i) => ({ title: `SUGGESTION-${i}-` + 's'.repeat(3000) })); },
        },
    };

    await asyncTest('orient() block is bounded to ORIENT_CAP_BYTES', async () => {
        const { loop, fakes } = newLoop(BIG_ORIENT);
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 1;
        fakes.wsClient.getContext = async () => ({ workspaceContext: 'GOALS-AND-CONTEXT ' + 'g'.repeat(10000) });
        const frame = await loop.observe();
        const sit = await loop.orient(frame);
        assert.ok(Buffer.byteLength(sit.block, 'utf8') <= loop.config.ORIENT_CAP_BYTES,
            `block too big: ${Buffer.byteLength(sit.block, 'utf8')} > ${loop.config.ORIENT_CAP_BYTES}`);
    });

    await asyncTest('orient() drops lowest-priority parts first when over cap', async () => {
        const { loop, fakes } = newLoop(BIG_ORIENT);
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 1;
        fakes.wsClient.getContext = async () => ({ workspaceContext: 'GOALS-AND-CONTEXT ' + 'g'.repeat(10000) });
        const frame = await loop.observe();
        const sit = await loop.orient(frame);
        assert.ok(sit.block.includes('CURRENT PERCEPTION'), 'priority-1 perception retained');
        assert.ok(sit.block.includes('RECENT ACTIONS'), 'priority-2 episodes retained');
        assert.ok(sit.block.includes('GOALS & CONTEXT'), 'priority-3 goals retained');
        assert.ok(sit.block.includes('LESSONS'), 'priority-4 lessons retained');
        assert.ok(!sit.block.includes('SUGGESTIONS'), 'priority-5 suggestions dropped');
    });

    // ── Phase 2: drift detection ────────────────────────────────────────
    await asyncTest('orient() drift: no baseline and identical content are not drifted', async () => {
        const { loop, fakes } = newLoop({
            perception: { getPerceptionBus: () => ({ getLatestFrame: () => ({}) }), frameToContextString: () => 'PERCEPTION' },
        });
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 1;
        fakes.wsClient.getContext = async () => ({ workspaceContext: 'SAME GOAL CONTEXT' });

        const sit1 = await loop.orient(await loop.observe());
        assert.strictEqual(sit1.drifted, false, 'first orient has no baseline → not drifted');
        const sit2 = await loop.orient(await loop.observe());
        assert.strictEqual(sit2.drifted, false, 'identical semantic content → not drifted');
    });

    await asyncTest('orient() drift: material semantic change sets drifted', async () => {
        const { loop, fakes } = newLoop({
            perception: { getPerceptionBus: () => ({ getLatestFrame: () => ({}) }), frameToContextString: () => 'PERCEPTION' },
        });
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 1;
        fakes.wsClient.getContext = async () => ({ workspaceContext: 'SAME GOAL CONTEXT' });
        await loop.orient(await loop.observe()); // establish baseline

        fakes.wsClient.getContext = async () => ({ workspaceContext: 'COMPLETELY DIFFERENT GOAL ABOUT SOMETHING ELSE ENTIRELY UNRELATED' });
        const sit = await loop.orient(await loop.observe());
        assert.strictEqual(sit.drifted, true, 'material semantic change → drifted');
    });

    // ── selectGoal() ─────────────────────────────────────────────────────
    await asyncTest('selectGoal() returns continue for an active goal', async () => {
        const { loop } = newLoop();
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'continue');
    });

    await asyncTest('selectGoal() returns terminal when the goal is done', async () => {
        const { loop, fakes } = newLoop();
        fakes.wsClient.getGoal = async () => ({ ...GOAL, status: 'done' });
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'terminal');
        assert.strictEqual(decision.reason, 'goal status=done');
    });

    // ── Phase 3/6: stall → self-block, gated by autoAbandon ─────────────
    await asyncTest('selectGoal() continues below the stall threshold', async () => {
        const { loop } = newLoop();
        loop.state.currentGoal = { ...GOAL };
        loop.state.stallCount = 2; // < STALL_THRESHOLD (3)
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'continue');
    });

    await asyncTest('selectGoal() stops (without blocking) on stall when autoAbandon is false', async () => {
        const { loop, fakes } = newLoop();
        loop.state.currentGoal = { ...GOAL }; // no autoAbandon field
        loop.state.stallCount = 3;
        const upserts = [];
        fakes.wsClient.upsertGoal = async (slug, patch) => { upserts.push({ slug, patch }); return {}; };
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'terminal');
        assert.strictEqual(decision.reason, 'stalled');
        assert.strictEqual(upserts.length, 0, 'no blocked write without autoAbandon');
    });

    await asyncTest('selectGoal() marks the goal blocked on stall when autoAbandon is true', async () => {
        const { loop, fakes } = newLoop();
        fakes.wsClient.getGoal = async (slug) => ({ ...GOAL, slug, autoAbandon: true });
        loop.state.currentGoal = { ...GOAL, autoAbandon: true };
        loop.state.stallCount = 3;
        let blocked = false;
        fakes.wsClient.upsertGoal = async (slug, patch) => { if (patch.status === 'blocked') blocked = true; return {}; };
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'terminal');
        assert.strictEqual(decision.reason, 'stalled');
        assert.strictEqual(blocked, true, 'goal marked blocked when autoAbandon');
    });

    // ── Phase 3: re-eval cadence ────────────────────────────────────────
    test('_shouldReevaluate() is true at/above REEVAL_STEPS', () => {
        const { loop } = newLoop({ config: { REEVAL_STEPS: 8 } });
        loop.state.stepsSinceReeval = 8;
        assert.strictEqual(loop._shouldReevaluate(), true);
    });

    test('_shouldReevaluate() is false below cadence with no drift/time', () => {
        const { loop } = newLoop({ config: { REEVAL_STEPS: 8 } });
        loop.state.stepsSinceReeval = 3;
        loop.state.nextReevaluateAt = Date.now() + 60000;
        loop._lastDrifted = false;
        assert.strictEqual(loop._shouldReevaluate(), false);
    });

    test('_shouldReevaluate() is true on drift', () => {
        const { loop } = newLoop({ config: { REEVAL_STEPS: 8 } });
        loop.state.stepsSinceReeval = 1;
        loop._lastDrifted = true;
        assert.strictEqual(loop._shouldReevaluate(), true);
    });

    test('_shouldReevaluate() is true when nextReevaluateAt has passed', () => {
        const { loop } = newLoop({ config: { REEVAL_STEPS: 8 } });
        loop.state.stepsSinceReeval = 1;
        loop.state.nextReevaluateAt = Date.now() - 1;
        loop._lastDrifted = false;
        assert.strictEqual(loop._shouldReevaluate(), true);
    });

    await asyncTest('selectGoal() resets the re-eval cadence', async () => {
        const { loop } = newLoop({ config: { REEVAL_STEPS: 8, REEVAL_MS: 60000 } });
        loop.state.currentGoal = { ...GOAL };
        loop.state.stepsSinceReeval = 8;
        const before = Date.now();
        const decision = await loop.selectGoal();
        assert.strictEqual(decision.status, 'continue');
        assert.strictEqual(loop.state.stepsSinceReeval, 0, 'cadence counter reset');
        assert.ok(loop.state.nextReevaluateAt >= before + 60000 - 5, 'nextReevaluateAt in the future');
    });

    // ── plan() ───────────────────────────────────────────────────────────
    await asyncTest('plan() returns a response action with text + toolCalls', async () => {
        const { loop } = newLoop({ llmClient: { async chat() { return { text: 'ok', toolCalls: [{ id: 'c', function: { name: 'toolA', arguments: '{}' } }] }; } } });
        loop.state.step = 1;
        const action = await loop.plan(
            { toolSchemas: [], toolNames: [], wsContextString: '', skillHints: [], perceptionContext: null },
            { systemPrompt: 'S', userTick: 'go' },
        );
        assert.strictEqual(action.type, 'response');
        assert.strictEqual(action.text, 'ok');
        assert.ok(Array.isArray(action.toolCalls));
        assert.strictEqual(action.expected, 'toolA');
    });

    await asyncTest('plan() returns idle when no tool and no sentinel', async () => {
        const { loop } = newLoop();
        loop.state.step = 1;
        const action = await loop.plan(
            { toolSchemas: [], toolNames: [], wsContextString: '', skillHints: [], perceptionContext: null },
            { systemPrompt: 'S', userTick: 'go' },
        );
        assert.strictEqual(action.type, 'idle');
        assert.strictEqual(action.expected, 'no-op');
        assert.ok(Array.isArray(action.toolCalls));
    });

    await asyncTest('plan() returns llm-error on a thrown chat', async () => {
        const { loop } = newLoop({ llmClient: { async chat() { throw new Error('boom'); } } });
        loop.state.step = 1;
        const action = await loop.plan(
            { toolSchemas: [], toolNames: [], wsContextString: '', skillHints: [], perceptionContext: null },
            { systemPrompt: 'S', userTick: 'go' },
        );
        assert.strictEqual(action.type, 'llm-error');
    });

    // ── act() ────────────────────────────────────────────────────────────
    await asyncTest('act() executes tool calls and returns outcomes', async () => {
        const { loop } = newLoop();
        loop.state.step = 1;
        const outcome = await loop.act({
            type: 'response', text: '',
            toolCalls: [{ id: 'c1', function: { name: 'toolA', arguments: '{"a":1}' } }],
        });
        assert.deepStrictEqual(outcome.outcomes.map((o) => o.name), ['toolA']);
        assert.deepStrictEqual(outcome.outcomes[0].args, { a: 1 });
    });

    // ── reflect() ────────────────────────────────────────────────────────
    await asyncTest('reflect() returns goal-done-sentinel on the sentinel', async () => {
        const { loop } = newLoop();
        const r = await loop.reflect({ text: 'done <<GOAL_DONE>>', toolCalls: [] }, { outcomes: [] });
        assert.deepStrictEqual(r, { stop: true, reason: 'goal-done-sentinel' });
    });

    await asyncTest('reflect() returns stop:false without the sentinel', async () => {
        const { loop } = newLoop();
        loop.state.step = 1; // 1 % 5 !== 0 → no reflection LLM call
        const r = await loop.reflect({ text: 'no sentinel', toolCalls: [] }, { outcomes: [] });
        assert.deepStrictEqual(r, { stop: false });
    });

    // ── Phase 4: critic writes a lesson on a failing tick ────────────────
    await asyncTest('reflect() writes a lesson and records lastOutcomeDelta on failure', async () => {
        const { loop, fakes } = newLoop();
        loop.state.currentGoal = { ...GOAL };
        loop.state.step = 1;
        const written = [];
        fakes.wsClient.upsertLesson = async (slug, body) => { written.push({ slug, body }); return {}; };
        const action = { type: 'response', text: 'try', toolCalls: [], expected: 'toolA' };
        const outcome = { outcomes: [{ name: 'toolA', args: {}, out: { ok: false, error: 'boom' } }] };
        const r = await loop.reflect(action, outcome);
        assert.deepStrictEqual(r, { stop: false });
        assert.strictEqual(loop.state.lastOutcomeDelta, -1, 'all tools failed → -1');
        assert.strictEqual(loop.state.stallCount, 1, 'failure increments stall');
        assert.ok(loop.state.lastLesson, 'lastLesson set');
        assert.strictEqual(written.length, 1, 'exactly one lesson written');
        assert.ok(written[0].slug.startsWith('lesson-'));
    });

    // ── stage transitions (happy path) ───────────────────────────────────
    await asyncTest('happy path emits the expected agent.stage order', async () => {
        const fakes = makeFakes({
            llmClient: {
                calls: 0,
                async chat() {
                    this.calls++;
                    if (this.calls === 1) return { text: '', toolCalls: [{ id: 'c', function: { name: 'toolA', arguments: '{}' } }] };
                    return { text: '<<GOAL_DONE>>', toolCalls: [] };
                },
            },
        });
        const loop = new AgentLoop(fakes);
        const started = await loop.start({ goalSlug: 'g', skipPlanner: true });
        assert.strictEqual(started.running, true);
        await waitFor(() => loop.status().running === false, { label: 'loop to finish' });

        const stages = fakes.events._log.filter((e) => e.type === 'agent.stage').map((e) => e.data.stage);
        assert.deepStrictEqual(
            stages.slice(0, 6),
            ['SELECTING_GOAL', 'OBSERVING', 'ORIENTING', 'PLANNING', 'ACTING', 'REFLECTING'],
            `first tick stages, got: ${JSON.stringify(stages)}`,
        );
        assert.strictEqual(stages[stages.length - 1], 'IDLE', `final stage should be IDLE, got: ${stages[stages.length - 1]}`);
        assert.strictEqual(loop.status().stage, 'IDLE');
        assert.strictEqual(loop.status().stopReason, 'goal-done-sentinel');
    });

    // ── Phase 6: a stalling loop stops instead of looping forever ───────
    await asyncTest('a stalling loop (autoAbandon) self-blocks and stops', async () => {
        const fakes = makeFakes({
            config: { IDLE_SLEEP_MS: 1, STALL_THRESHOLD: 3 },
            llmClient: { async chat() { return { text: 'nothing to do', toolCalls: [] }; } },
        });
        fakes.wsClient.getGoal = async (slug) => ({ ...GOAL, slug, autoAbandon: true });
        let blocked = false;
        fakes.wsClient.upsertGoal = async (slug, patch) => { if (patch.status === 'blocked') blocked = true; return {}; };
        const loop = new AgentLoop(fakes);

        const started = await loop.start({ goalSlug: 'g', skipPlanner: true });
        assert.strictEqual(started.running, true);
        await waitFor(() => loop.status().running === false, { label: 'stalling loop to stop' });

        assert.strictEqual(loop.status().stopReason, 'stalled');
        assert.strictEqual(blocked, true, 'goal marked blocked');
        assert.strictEqual(loop.status().stallCount, 3, 'stallCount reached threshold');
        assert.strictEqual(fakes.events._log.filter((e) => e.type === 'goal.blocked').length, 1, 'goal.blocked published once');
    });

    // ── Phase 3: per-goal maxSteps is enforced and marks the goal failed ─
    await asyncTest('a goal exceeding maxSteps is marked failed', async () => {
        const fakes = makeFakes({
            config: { IDLE_SLEEP_MS: 1, STALL_THRESHOLD: 3 },
            llmClient: { async chat() { return { text: '', toolCalls: [] }; } },
        });
        fakes.wsClient.getGoal = async (slug) => ({ ...GOAL, slug, maxSteps: 3 });
        let failed = false;
        fakes.wsClient.upsertGoal = async (slug, patch) => { if (patch.status === 'failed') failed = true; return {}; };
        const loop = new AgentLoop(fakes);

        const started = await loop.start({ goalSlug: 'g', skipPlanner: true });
        assert.strictEqual(started.running, true);
        assert.strictEqual(loop.status().maxSteps, 3, 'per-goal maxSteps honored');
        await waitFor(() => loop.status().running === false, { label: 'maxSteps loop to stop' });
        assert.strictEqual(loop.status().stopReason, 'max-steps-reached');
        assert.strictEqual(failed, true, 'goal marked failed on maxSteps');
    });

    // ── Chat-driven run: final answer capture + result surfacing ────────
    await asyncTest('reflect() captures finalAnswer on the sentinel', async () => {
        const { loop } = newLoop();
        const r = await loop.reflect({ text: 'The count is 28. <<GOAL_DONE>>', toolCalls: [], expected: 'finish' }, { outcomes: [] });
        assert.deepStrictEqual(r, { stop: true, reason: 'goal-done-sentinel' });
        assert.strictEqual(loop.state.finalAnswer, 'The count is 28.');
    });

    await asyncTest('a completed goal persists done + publishes agent.reply and goal.done', async () => {
        const fakes = makeFakes({
            llmClient: { async chat() { return { text: 'There are 28 files. <<GOAL_DONE>>', toolCalls: [] }; } },
        });
        const done = [];
        fakes.wsClient.upsertGoal = async (slug, patch) => { done.push({ slug, patch }); return {}; };
        const loop = new AgentLoop(fakes);

        const started = await loop.start({ goalSlug: 'g', skipPlanner: true });
        assert.strictEqual(started.running, true);
        await waitFor(() => loop.status().running === false, { label: 'loop to finish' });

        assert.strictEqual(loop.status().stopReason, 'goal-done-sentinel');
        assert.strictEqual(loop.status().finalAnswer, 'There are 28 files.');
        assert.ok(done.some((d) => d.slug === 'g' && d.patch.status === 'done'), 'goal persisted as done');
        assert.ok(fakes.events._log.some((e) => e.type === 'agent.reply' && e.data.text === 'There are 28 files.'), 'agent.reply published');
        assert.ok(fakes.events._log.some((e) => e.type === 'goal.done' && e.data.result === 'There are 28 files.'), 'goal.done published');
    });

    // ── Meta-loop self-reflection (OpenClaw-style, META_EVERY_ACTIONS) ──
    await asyncTest('_runMetaReflection writes a log note and publishes agent.meta', async () => {
        const fakes = makeFakes({ llmClient: { async chat() { return { text: 'Did X well; stop doing Y.' }; } } });
        const logs = [];
        fakes.wsClient.getRecentActions = async () => [{ tool: 'fs_list' }, { tool: 'fs_read' }];
        fakes.wsClient.appendLog = async (text) => { logs.push(text); return {}; };
        const loop = new AgentLoop(fakes);
        loop.state.currentGoal = { ...GOAL };
        await loop._runMetaReflection();
        assert.strictEqual(logs.length, 1, 'one log note appended');
        assert.ok(logs[0].includes('Did X well'), 'log note contains the summary');
        assert.ok(fakes.events._log.some((e) => e.type === 'agent.meta'), 'agent.meta published');
        assert.strictEqual(loop.state.lastMeta, 'Did X well; stop doing Y.');
    });

    await asyncTest('_runMetaReflection no-ops on an empty action log', async () => {
        const fakes = makeFakes();
        let llmCalled = false;
        fakes.llmClient = { async chat() { llmCalled = true; return { text: 'x' }; } };
        fakes.wsClient.getRecentActions = async () => [];
        let logged = 0;
        fakes.wsClient.appendLog = async () => { logged++; return {}; };
        const loop = new AgentLoop(fakes);
        await loop._runMetaReflection();
        assert.strictEqual(llmCalled, false, 'no LLM call without actions');
        assert.strictEqual(logged, 0, 'nothing appended');
    });

    await asyncTest('_runMetaReflection survives an LLM failure without writing', async () => {
        const fakes = makeFakes({ llmClient: { async chat() { throw new Error('boom'); } } });
        fakes.wsClient.getRecentActions = async () => [{ tool: 'fs_list' }];
        let logged = 0;
        fakes.wsClient.appendLog = async () => { logged++; return {}; };
        const loop = new AgentLoop(fakes);
        await loop._runMetaReflection();
        assert.strictEqual(logged, 0, 'no write on LLM failure');
    });

    await asyncTest('loop triggers meta reflection every META_EVERY_ACTIONS steps', async () => {
        const logs = [];
        const fakes = makeFakes({
            config: { IDLE_SLEEP_MS: 1, META_EVERY_ACTIONS: 2 },
            llmClient: {
                async chat(opts) {
                    if (opts?.systemPrompt?.includes('reviewing its own recent work')) return { text: 'meta summary', toolCalls: [] };
                    return { text: 'nothing to do', toolCalls: [] };
                },
            },
        });
        fakes.wsClient.getRecentActions = async () => [{ tool: 'fs_list' }, { tool: 'fs_read' }];
        fakes.wsClient.appendLog = async (text) => { logs.push(text); return {}; };
        const loop = new AgentLoop(fakes);
        const started = await loop.start({ goalSlug: 'g', skipPlanner: true, maxSteps: 3 });
        assert.strictEqual(started.running, true);
        await waitFor(() => loop.status().running === false, { label: 'loop to finish' });
        assert.ok(logs.some((t) => String(t).includes('meta summary')), 'meta reflection appended mid-run');
    });

    // ── Success-run skill draft (OpenClaw-style self-authored skills) ────
    await asyncTest('act() records successful steps with PII args stripped', async () => {
        const { loop } = newLoop();
        loop.state.step = 1;
        await loop.act({
            type: 'response', text: '',
            toolCalls: [
                { id: 'c1', function: { name: 'toolA', arguments: '{"a":1}' } },
                { id: 'c2', function: { name: 'text_type', arguments: '{"text":"secret"}' } },
            ],
        });
        assert.deepStrictEqual(loop.state.runSteps, [
            { tool: 'toolA', args: { a: 1 } },
            { tool: 'text_type', args: {} },
        ]);
        // stepLog mirrors the executed sequence for the /plans step feed.
        assert.strictEqual(loop.state.stepLog.length, 2, 'stepLog records each tool');
        assert.strictEqual(loop.state.stepLog[0].tool, 'toolA');
        assert.deepStrictEqual(loop.state.stepLog[1].args, {}, 'PII args stripped from stepLog');
        assert.ok(Array.isArray(loop.status().stepLog), 'status() exposes stepLog');
    });

    test('_buildSkillDraft returns null with fewer than 2 steps', () => {
        const { loop } = newLoop();
        loop.state.runSteps = [{ tool: 'toolA', args: {} }];
        assert.strictEqual(loop._buildSkillDraft(), null);
    });

    test('_buildSkillDraft builds a consent-gated draft from 2+ steps', () => {
        const { loop } = newLoop();
        loop.state.runSteps = [{ tool: 'toolA', args: { a: 1 } }, { tool: 'toolB', args: {} }];
        const draft = loop._buildSkillDraft();
        assert.ok(draft.slug.startsWith('skill-'), 'slug is a skill slug');
        assert.strictEqual(draft.steps.length, 2);
        assert.strictEqual(draft.metadata.source, 'success-run');
        assert.strictEqual(draft.metadata.draft, true);
    });

    await asyncTest('a successful run publishes agent.skill-draft and exposes lastSkillDraft', async () => {
        const fakes = makeFakes({
            llmClient: {
                calls: 0,
                async chat() {
                    this.calls++;
                    if (this.calls <= 2) return { text: '', toolCalls: [{ id: `c${this.calls}`, function: { name: 'toolA', arguments: '{}' } }] };
                    return { text: 'done <<GOAL_DONE>>', toolCalls: [] };
                },
            },
        });
        const loop = new AgentLoop(fakes);
        await loop.start({ goalSlug: 'g', skipPlanner: true });
        await waitFor(() => loop.status().running === false, { label: 'loop finish' });
        const s = loop.status();
        assert.ok(s.lastSkillDraft, 'lastSkillDraft set');
        assert.ok(s.lastSkillDraft.steps.length >= 2, 'draft has the run steps');
        assert.ok(fakes.events._log.some((e) => e.type === 'agent.skill-draft'), 'agent.skill-draft published');
    });

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
