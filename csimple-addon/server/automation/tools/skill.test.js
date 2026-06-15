/**
 * Unit tests for skill_run, focused on the LLM repair fallback.
 * Runs fully offline. The tool-registry and workspace-client modules are
 * replaced with controllable fakes via require.cache BEFORE skill.js loads,
 * so no real tools, permissions, or network calls are exercised.
 */

const assert = require('assert');

// ── Inject fakes before requiring skill.js ──────────────────────────────────
const registryPath = require.resolve('../tool-registry');
const wsPath = require.resolve('../workspace-client');

const fakeRegistry = {
    _handler: null,
    async executeTool(name, args, ctx) {
        if (!fakeRegistry._handler) throw new Error('no handler set');
        return fakeRegistry._handler(name, args, ctx);
    },
};
require.cache[registryPath] = {
    id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry,
};
require.cache[wsPath] = {
    id: wsPath, filename: wsPath, loaded: true,
    exports: {
        async getSkill() { throw new Error('workspace disabled in test'); },
        async appendAction() { /* no-op */ },
    },
};

const skill = require('./skill');
const { skillRun, repairStep, _extractJsonObject } = skill;

let pass = 0, fail = 0;
// Queue of async test thunks. They MUST run sequentially because they share a
// single mutable fakeRegistry._handler — concurrent execution would race.
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

// Build a stub LLM whose chat() returns a fixed text reply.
function stubLlm(text) {
    return { calls: [], async chat(opts) { this.calls.push(opts); return { text }; } };
}

// Build an inline skill object usable via args.cache.
function makeSkill(slug, steps, name = slug) {
    return { slug, name, steps };
}

// ── _extractJsonObject ──────────────────────────────────────────────────────
test('_extractJsonObject: plain JSON', () => {
    assert.deepStrictEqual(_extractJsonObject('{"action":"abort","reason":"x"}'), { action: 'abort', reason: 'x' });
});
test('_extractJsonObject: fenced json block', () => {
    const r = _extractJsonObject('```json\n{"action":"retry","args":{"a":1}}\n```');
    assert.deepStrictEqual(r, { action: 'retry', args: { a: 1 } });
});
test('_extractJsonObject: json embedded in prose', () => {
    const r = _extractJsonObject('Sure, here you go: {"action":"retry","args":{"b":2}} hope that helps');
    assert.deepStrictEqual(r, { action: 'retry', args: { b: 2 } });
});
test('_extractJsonObject: nested braces balanced', () => {
    const r = _extractJsonObject('{"action":"retry","args":{"sel":{"name":"OK"}}}');
    assert.deepStrictEqual(r, { action: 'retry', args: { sel: { name: 'OK' } } });
});
test('_extractJsonObject: no json → null', () => {
    assert.strictEqual(_extractJsonObject('no json at all'), null);
});
test('_extractJsonObject: non-string → null', () => {
    assert.strictEqual(_extractJsonObject(null), null);
});

// ── repairStep ──────────────────────────────────────────────────────────────
asyncTest('repairStep: retry decision returns amended args', async () => {
    fakeRegistry._handler = (name) => name === 'uia_snapshot'
        ? { ok: true, result: { nodes: [] } }
        : { ok: false, error: 'x' };
    const ctx = { llm: stubLlm('{"action":"retry","args":{"fixed":true}}') };
    const d = await repairStep({ skill: makeSkill('s', []), step: { tool: 'click' }, resolvedArgs: {}, error: 'boom', ctx });
    assert.deepStrictEqual(d, { action: 'retry', args: { fixed: true } });
});

asyncTest('repairStep: abort decision', async () => {
    fakeRegistry._handler = () => ({ ok: true, result: {} });
    const ctx = { llm: stubLlm('{"action":"abort","reason":"cannot fix"}') };
    const d = await repairStep({ skill: makeSkill('s', []), step: { tool: 'click' }, resolvedArgs: {}, error: 'boom', ctx });
    assert.deepStrictEqual(d, { action: 'abort', reason: 'cannot fix' });
});

asyncTest('repairStep: unparseable reply → null', async () => {
    fakeRegistry._handler = () => ({ ok: true, result: {} });
    const ctx = { llm: stubLlm('I have no idea') };
    const d = await repairStep({ skill: makeSkill('s', []), step: { tool: 'click' }, resolvedArgs: {}, error: 'boom', ctx });
    assert.strictEqual(d, null);
});

asyncTest('repairStep: llm.chat throws → null (best-effort)', async () => {
    fakeRegistry._handler = () => ({ ok: true, result: {} });
    const ctx = { llm: { async chat() { throw new Error('network'); } } };
    const d = await repairStep({ skill: makeSkill('s', []), step: { tool: 'click' }, resolvedArgs: {}, error: 'boom', ctx });
    assert.strictEqual(d, null);
});

asyncTest('repairStep: snapshot failure does not throw', async () => {
    fakeRegistry._handler = (name) => name === 'uia_snapshot'
        ? { ok: false, error: 'no window' }
        : { ok: true, result: {} };
    const ctx = { llm: stubLlm('{"action":"retry","args":{"x":1}}') };
    const d = await repairStep({ skill: makeSkill('s', []), step: { tool: 'click' }, resolvedArgs: {}, error: 'boom', ctx });
    assert.deepStrictEqual(d, { action: 'retry', args: { x: 1 } });
});

// ── skillRun.run: happy path ────────────────────────────────────────────────
asyncTest('run: all steps succeed → failed false, no repairs', async () => {
    fakeRegistry._handler = () => ({ ok: true, result: 'done' });
    const s = makeSkill('happy', [{ tool: 'a', args: {} }, { tool: 'b', args: {} }]);
    const out = await skillRun.run({ slug: 'happy', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, false);
    assert.strictEqual(out.repairsTotal, 0);
    assert.strictEqual(out.stepsRun, 2);
    assert.ok(out.steps.every(st => st.ok));
});

// ── skillRun.run: repair succeeds ───────────────────────────────────────────
asyncTest('run: failing step repaired and retried → success', async () => {
    // `click` fails unless args.fixed is true. Repair LLM supplies fixed:true.
    fakeRegistry._handler = (name, args) => {
        if (name === 'uia_snapshot') return { ok: true, result: { nodes: [] } };
        if (name === 'click') return args && args.fixed ? { ok: true, result: 'clicked' } : { ok: false, error: 'not found' };
        return { ok: true, result: 'ok' };
    };
    const ctx = { llm: stubLlm('{"action":"retry","args":{"fixed":true}}') };
    const s = makeSkill('repairme', [{ tool: 'click', args: { fixed: false } }]);
    const out = await skillRun.run({ slug: 'repairme', cache: s, stepDelayMs: 0 }, ctx);
    assert.strictEqual(out.failed, false, 'step should succeed after repair');
    assert.strictEqual(out.repairsTotal, 1);
    assert.strictEqual(out.steps[0].ok, true);
    assert.ok(Array.isArray(out.steps[0].repairs) && out.steps[0].repairs.length === 1);
    assert.deepStrictEqual(out.steps[0].args, { fixed: true }, 'final args should be the repaired args');
});

// ── skillRun.run: repair aborts ─────────────────────────────────────────────
asyncTest('run: repair aborts → step stays failed and loop stops', async () => {
    fakeRegistry._handler = (name) => {
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: false, error: 'broken' };
    };
    const ctx = { llm: stubLlm('{"action":"abort","reason":"hopeless"}') };
    const s = makeSkill('aborty', [{ tool: 'click', args: {} }, { tool: 'next', args: {} }]);
    const out = await skillRun.run({ slug: 'aborty', cache: s, stepDelayMs: 0 }, ctx);
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.stepsRun, 1, 'should stop after first failed step');
    assert.strictEqual(out.repairsTotal, 0, 'abort does not count as a repair retry');
    assert.strictEqual(out.steps[0].repairs[0].action, 'abort');
});

// ── skillRun.run: repair disabled ───────────────────────────────────────────
asyncTest('run: repair=false skips LLM entirely', async () => {
    const llm = stubLlm('{"action":"retry","args":{"fixed":true}}');
    fakeRegistry._handler = (name) => {
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: false, error: 'nope' };
    };
    const s = makeSkill('norepair', [{ tool: 'click', args: {} }]);
    const out = await skillRun.run({ slug: 'norepair', cache: s, repair: false, stepDelayMs: 0 }, { llm });
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.repairsTotal, 0);
    assert.strictEqual(llm.calls.length, 0, 'LLM must not be consulted when repair disabled');
    assert.ok(!out.steps[0].repairs, 'no repairs array when repair disabled');
});

// ── skillRun.run: maxRepairs respected ──────────────────────────────────────
asyncTest('run: maxRepairs=2 retries up to twice then fails', async () => {
    // Tool never succeeds; LLM always says retry. Expect exactly 2 retries.
    const llm = stubLlm('{"action":"retry","args":{"k":1}}');
    fakeRegistry._handler = (name) => {
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: false, error: 'permafail' };
    };
    const s = makeSkill('multi', [{ tool: 'click', args: {} }]);
    const out = await skillRun.run({ slug: 'multi', cache: s, maxRepairs: 2, stepDelayMs: 0 }, { llm });
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.repairsTotal, 2);
    assert.strictEqual(out.steps[0].repairs.length, 2);
    assert.strictEqual(llm.calls.length, 2);
});

// ── skillRun.run: param substitution + repair coexist ───────────────────────
asyncTest('run: param substitution applies before execution', async () => {
    const seen = [];
    fakeRegistry._handler = (name, args) => { seen.push({ name, args }); return { ok: true, result: 'ok' }; };
    const s = makeSkill('parm', [{ tool: 'type', args: { text: 'hello ${param.who}' } }]);
    const out = await skillRun.run({ slug: 'parm', cache: s, params: { who: 'world' }, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, false);
    assert.strictEqual(seen[0].args.text, 'hello world');
});

// ── skillRun.run: marker steps are inert ────────────────────────────────────
asyncTest('run: _marker steps are surfaced but not executed', async () => {
    let executed = 0;
    fakeRegistry._handler = () => { executed++; return { ok: true, result: 'ok' }; };
    const s = makeSkill('marked', [{ tool: '_marker', args: { note: 'start' } }, { tool: 'a', args: {} }]);
    const out = await skillRun.run({ slug: 'marked', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(executed, 1, 'only the real tool runs');
    assert.strictEqual(out.steps[0].marker, true);
});

// ── skillRun.run: continueOnError keeps going after unrepaired failure ───────
asyncTest('run: continueOnError runs all steps despite failure', async () => {
    fakeRegistry._handler = (name, args) => {
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return args && args.bad ? { ok: false, error: 'bad' } : { ok: true, result: 'ok' };
    };
    const s = makeSkill('cont', [
        { tool: 'a', args: { bad: true } },
        { tool: 'b', args: {} },
    ]);
    const out = await skillRun.run({ slug: 'cont', cache: s, repair: false, continueOnError: true, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.stepsRun, 2, 'both steps run with continueOnError');
    assert.strictEqual(out.steps[0].ok, false);
    assert.strictEqual(out.steps[1].ok, true);
});

// ── Summary ─────────────────────────────────────────────────────────────────
(async () => {
    for (const t of queue) await t();
    console.log(`\nskill.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})();
