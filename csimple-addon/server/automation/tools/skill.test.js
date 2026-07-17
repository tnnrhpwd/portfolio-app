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
const permissionsPath = require.resolve('../permissions');

const fakeRegistry = {
    _handler: null,
    _registered: new Set(),
    get(name) {
        if (this._registered.size === 0 || this._registered.has(name)) {
            return { name, category: 'system' };
        }
        return undefined;
    },
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
const fakePermissions = {
    _cloudVisionConsent: true,
    hasCloudVisionConsent() { return this._cloudVisionConsent; },
    _setCloudVisionConsent(next) { this._cloudVisionConsent = !!next; },
};
require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true, exports: fakePermissions,
};

const skill = require('./skill');
const { skillRun, repairStep, _extractJsonObject, analyzeSkillCompatibility } = skill;

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

// ── compatibility analysis + downgrade behavior ──────────────────────────────
test('analyzeSkillCompatibility: reports degraded + unsupported findings', () => {
    fakeRegistry._registered = new Set(['find_and_click_visual']);
    const report = analyzeSkillCompatibility(makeSkill('compat', [
        { tool: 'click_visual', args: { target: 'OK' } },
        { tool: 'missing_tool', args: {} },
    ]));
    assert.strictEqual(report.degradedCount, 1);
    assert.strictEqual(report.unsupportedCount, 1);
    assert.ok(report.findings.some(f => f.originalTool === 'click_visual' && f.resolvedTool === 'find_and_click_visual'));
    assert.ok(report.findings.some(f => f.originalTool === 'missing_tool' && f.status === 'unsupported'));
    fakeRegistry._registered = new Set();
});

asyncTest('run: alias tool degrades deterministically and executes mapped tool', async () => {
    fakeRegistry._registered = new Set(['find_and_click_visual']);
    let called = null;
    fakeRegistry._handler = (name) => { called = name; return { ok: true, result: 'clicked' }; };
    const s = makeSkill('degrade', [{ tool: 'click_visual', args: { target: 'Submit' } }]);
    const out = await skillRun.run({ slug: 'degrade', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, false);
    assert.strictEqual(called, 'find_and_click_visual');
    assert.strictEqual(out.steps[0].compatibility.status, 'degraded');
    fakeRegistry._registered = new Set();
});

asyncTest('run: unsupported steps are blocked by default and allowed with allowUnsupported', async () => {
    fakeRegistry._registered = new Set(['a']);
    fakeRegistry._handler = () => ({ ok: true, result: 'ok' });
    const s = makeSkill('unsupported', [{ tool: 'missing_tool', args: {} }]);
    await assert.rejects(
        () => skillRun.run({ slug: 'unsupported', cache: s, stepDelayMs: 0 }, {}),
        /unsupported step\(s\)/i,
    );
    const out = await skillRun.run(
        { slug: 'unsupported', cache: s, stepDelayMs: 0, allowUnsupported: true, continueOnError: true },
        {},
    );
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.steps[0].ok, false);
    assert.match(out.steps[0].error, /not available/i);
    fakeRegistry._registered = new Set();
});

asyncTest('run: uia_invoke failure recovers via visual retarget before LLM amend', async () => {
    const llm = stubLlm('{"action":"abort","reason":"should not be needed"}');
    let visualCalls = 0;
    fakeRegistry._registered = new Set(['uia_invoke', 'find_and_click_visual']);
    fakeRegistry._handler = (name) => {
        if (name === 'uia_invoke') return { ok: false, error: 'element moved' };
        if (name === 'find_and_click_visual') { visualCalls++; return { ok: true, result: { clickedAt: [10, 10] } }; }
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: true, result: {} };
    };
    const s = makeSkill('retarget', [{ tool: 'uia_invoke', args: { name: 'Submit' } }]);
    const out = await skillRun.run({ slug: 'retarget', cache: s, stepDelayMs: 0 }, { llm });
    assert.strictEqual(out.failed, false);
    assert.strictEqual(visualCalls, 1);
    assert.strictEqual(llm.calls.length, 0, 'visual retarget should avoid LLM amend when it works');
    assert.strictEqual(out.steps[0].tool, 'find_and_click_visual');
    assert.strictEqual(out.steps[0].repairs[0].strategy, 'visual-retarget');
    fakeRegistry._registered = new Set();
});

asyncTest('run: successCriteria tool_succeeded marks failed when criterion is unmet', async () => {
    fakeRegistry._handler = () => ({ ok: true, result: 'ok' });
    const s = makeSkill('criteria-fail', [{ tool: 'a', args: {} }]);
    s.successCriteria = { type: 'tool_succeeded', tool: 'b' };
    const out = await skillRun.run({ slug: 'criteria-fail', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.outcome.status, 'failed');
    assert.strictEqual(out.outcome.reasonCode, 'TOOL_NOT_SEEN_OK');
});

asyncTest('run: successCriteria clipboard_contains passes when clipboard has expected text', async () => {
    fakeRegistry._handler = (name) => {
        if (name === 'clipboard_read') return { ok: true, result: { text: 'done: order #42' } };
        return { ok: true, result: 'ok' };
    };
    const s = makeSkill('criteria-pass', [{ tool: 'a', args: {} }]);
    s.successCriteria = { type: 'clipboard_contains', text: 'order #42' };
    const out = await skillRun.run({ slug: 'criteria-pass', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, false);
    assert.strictEqual(out.outcome.status, 'passed');
    assert.strictEqual(out.outcome.reasonCode, 'CLIPBOARD_MATCH');
});

asyncTest('run: screenshot_check fails fast when cloud vision consent is absent', async () => {
    fakePermissions._setCloudVisionConsent(false);
    fakeRegistry._handler = () => ({ ok: true, result: {} });
    const s = makeSkill('no-consent', [{ type: 'screenshot_check', condition: 'Is app open?' }]);
    const out = await skillRun.run({ slug: 'no-consent', cache: s, stepDelayMs: 0 }, {});
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.steps[0].tool, 'screenshot_check');
    assert.strictEqual(out.steps[0].ok, false);
    assert.match(out.steps[0].error, /Cloud vision consent required/i);
    fakePermissions._setCloudVisionConsent(true);
});

asyncTest('run: screenshot_check proceeds when cloud vision consent exists', async () => {
    fakePermissions._setCloudVisionConsent(true);
    fakeRegistry._handler = (name) => {
        if (name === 'screen_capture') return { ok: true, result: { base64: 'AAAA' } };
        return { ok: true, result: {} };
    };
    const llm = {
        async chat() {
            return { choices: [{ message: { content: 'YES' } }] };
        },
    };
    const s = makeSkill('with-consent', [{ type: 'screenshot_check', condition: 'Is app open?' }]);
    const out = await skillRun.run({ slug: 'with-consent', cache: s, stepDelayMs: 0 }, { llm });
    assert.strictEqual(out.failed, false);
    assert.strictEqual(out.steps[0].tool, 'screenshot_check');
    assert.strictEqual(out.steps[0].ok, true);
    assert.strictEqual(out.steps[0].passed, true);
});

// ── successCriteria-triggered repair (§5.6) ─────────────────────────────────
// All steps report ok, but the end-state check still fails — distinct from
// the per-step repair loop above (which only fires on a tool-execution
// error). skill_run should retry the LAST step via the same repair
// fallback, telling it *why* (the failed criteria), then re-check.
asyncTest('run: successCriteria failure with all steps ok triggers a criteria-retry repair that then passes', async () => {
    let clipboardText = 'wrong';
    fakeRegistry._handler = (name, args) => {
        if (name === 'a') { clipboardText = args.text; return { ok: true, result: 'ok' }; }
        if (name === 'clipboard_read') return { ok: true, result: { text: clipboardText } };
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: true, result: 'ok' };
    };
    const ctx = { llm: stubLlm('{"action":"retry","args":{"text":"order #42"}}') };
    const s = makeSkill('criteria-repair-pass', [{ tool: 'a', args: { text: 'wrong' } }]);
    s.successCriteria = { type: 'clipboard_contains', text: 'order #42' };
    const out = await skillRun.run({ slug: 'criteria-repair-pass', cache: s, stepDelayMs: 0 }, ctx);
    assert.strictEqual(out.failed, false, 'criteria repair should flip the run back to success');
    assert.strictEqual(out.outcome.status, 'passed');
    assert.strictEqual(out.criteriaRepairsAttempted, 1);
    assert.strictEqual(out.repairsTotal, 1);
    assert.deepStrictEqual(out.steps[0].args, { text: 'order #42' });
    assert.strictEqual(out.steps[0].repairs[0].strategy, 'criteria-retry');
    assert.strictEqual(out.steps[0].repairs[0].ok, true);
});

asyncTest('run: successCriteria failure repair declines → run stays failed', async () => {
    fakeRegistry._handler = (name) => {
        if (name === 'clipboard_read') return { ok: true, result: { text: 'nope' } };
        if (name === 'uia_snapshot') return { ok: true, result: {} };
        return { ok: true, result: 'ok' };
    };
    const ctx = { llm: stubLlm('{"action":"abort","reason":"cannot fix"}') };
    const s = makeSkill('criteria-repair-abort', [{ tool: 'a', args: {} }]);
    s.successCriteria = { type: 'clipboard_contains', text: 'order #42' };
    const out = await skillRun.run({ slug: 'criteria-repair-abort', cache: s, stepDelayMs: 0 }, ctx);
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.outcome.status, 'failed');
    assert.strictEqual(out.criteriaRepairsAttempted, 1);
    assert.strictEqual(out.repairsTotal, 0, 'a declined repair does not count as a retry');
    assert.strictEqual(out.steps[0].repairs[0].action, 'abort');
    assert.strictEqual(out.steps[0].repairs[0].strategy, 'criteria-retry');
});

asyncTest('run: maxCriteriaRepairs=0 disables criteria-triggered repair entirely', async () => {
    const llm = stubLlm('{"action":"retry","args":{"text":"order #42"}}');
    fakeRegistry._handler = (name) => {
        if (name === 'clipboard_read') return { ok: true, result: { text: 'nope' } };
        return { ok: true, result: 'ok' };
    };
    const s = makeSkill('criteria-repair-disabled', [{ tool: 'a', args: {} }]);
    s.successCriteria = { type: 'clipboard_contains', text: 'order #42' };
    const out = await skillRun.run({ slug: 'criteria-repair-disabled', cache: s, maxCriteriaRepairs: 0, stepDelayMs: 0 }, { llm });
    assert.strictEqual(out.failed, true);
    assert.strictEqual(out.criteriaRepairsAttempted, undefined);
    assert.strictEqual(llm.calls.length, 0, 'LLM must not be consulted when maxCriteriaRepairs=0');
});

// ── Summary ─────────────────────────────────────────────────────────────────
(async () => {
    for (const t of queue) await t();
    console.log(`\nskill.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
})();
