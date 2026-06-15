/**
 * Unit tests for the planner module.
 * Runs offline — no LLM is invoked. Stubs the wsClient + llm where needed.
 */

const assert = require('assert');
const { shouldPlan, _validatePlan, _slugify, _buildPlannerPrompt, planGoal } = require('./planner');

let pass = 0, fail = 0;
const pending = [];
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); pass++; }
    catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
function asyncTest(name, fn) {
    pending.push((async () => {
        try { await fn(); console.log(`  PASS  ${name}`); pass++; }
        catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); fail++; }
    })());
}

// ── shouldPlan ──────────────────────────────────────────────────────────────
test('shouldPlan: tiny goal → false', () => {
    assert.strictEqual(shouldPlan({ content: 'short' }), false);
});

test('shouldPlan: medium goal with no connectives → false', () => {
    assert.strictEqual(shouldPlan({ content: 'a fairly normal length goal but still small' }), false);
});

test('shouldPlan: contains "then" → true', () => {
    assert.strictEqual(shouldPlan({ content: 'open the file then save it as PDF' }), true);
});

test('shouldPlan: very long text → true', () => {
    const long = 'lorem ipsum '.repeat(30); // ~330 chars
    assert.strictEqual(shouldPlan({ content: long }), true);
});

test('shouldPlan: explicit skipPlanner=true → false', () => {
    assert.strictEqual(shouldPlan({ content: 'open then save', skipPlanner: true }), false);
});

test('shouldPlan: null goal → false', () => {
    assert.strictEqual(shouldPlan(null), false);
});

// ── _slugify ────────────────────────────────────────────────────────────────
test('slugify: lowercases + dashes', () => {
    assert.strictEqual(_slugify('Open The File'), 'open-the-file');
});

test('slugify: strips punctuation', () => {
    assert.strictEqual(_slugify('Save as: PDF!'), 'save-as-pdf');
});

test('slugify: empty → fallback', () => {
    assert.strictEqual(_slugify('', 'x'), 'x');
});

test('slugify: truncates to 60 chars', () => {
    const out = _slugify('a'.repeat(100));
    assert.ok(out.length <= 60);
});

// ── _validatePlan ───────────────────────────────────────────────────────────
test('validate: rejects non-object', () => {
    assert.throws(() => _validatePlan(null));
    assert.throws(() => _validatePlan('hi'));
});

test('validate: rejects 0 children', () => {
    assert.throws(() => _validatePlan({ children: [] }));
});

test('validate: rejects 1 child', () => {
    assert.throws(() => _validatePlan({ children: [{ name: 'a' }] }));
});

test('validate: rejects 6 children', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `c${i}` }));
    assert.throws(() => _validatePlan({ children: six }));
});

test('validate: accepts 2 children', () => {
    const out = _validatePlan({ children: [{ name: 'a', successCriteria: 's' }, { name: 'b' }] });
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].name, 'a');
    assert.strictEqual(out[0].successCriteria, 's');
});

test('validate: accepts 5 children', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `c${i}` }));
    assert.strictEqual(_validatePlan({ children: five }).length, 5);
});

test('validate: truncates oversized name', () => {
    const out = _validatePlan({ children: [{ name: 'a'.repeat(200) }, { name: 'b' }] });
    assert.ok(out[0].name.length <= 80);
});

test('validate: rejects missing name', () => {
    assert.throws(() => _validatePlan({ children: [{ name: 'a' }, {}] }));
});

// ── _buildPlannerPrompt ─────────────────────────────────────────────────────
test('prompt: includes goal name', () => {
    const p = _buildPlannerPrompt({ name: 'Special Goal Name', content: 'stuff' });
    assert.ok(p.includes('Special Goal Name'));
});

test('prompt: includes success criteria when present', () => {
    const p = _buildPlannerPrompt({ name: 'g', successCriteria: 'criteria xyz' });
    assert.ok(p.includes('criteria xyz'));
});

test('prompt: clamps content to 1500 chars', () => {
    const big = 'x'.repeat(5000);
    const p = _buildPlannerPrompt({ name: 'g', content: big });
    assert.ok(p.length < 3000, `prompt too large: ${p.length}`);
});

// ── planGoal — integration with stub LLM + wsClient ─────────────────────────
function makeStubLlm(reply) {
    return { chat: async () => ({ text: reply }) };
}

function makeStubWs(existing = new Set()) {
    const calls = { upsert: [], get: [] };
    return {
        calls,
        getGoal: async (slug) => {
            calls.get.push(slug);
            if (!existing.has(slug)) {
                const err = new Error('not found'); err.status = 404; throw err;
            }
            return { slug };
        },
        upsertGoal: async (slug, body) => {
            calls.upsert.push({ slug, body });
            existing.add(slug);
            return { slug };
        },
    };
}

asyncTest('planGoal: skipped if goal too small', async () => {
    const r = await planGoal({ content: 'short', slug: 'parent' }, {
        wsClient: makeStubWs(),
        llm: makeStubLlm('{}'),
        log: () => {},
    });
    assert.strictEqual(r.skipped, true);
});

asyncTest('planGoal: creates children for big goal', async () => {
    const ws = makeStubWs();
    const r = await planGoal({ name: 'P', content: 'open file then save then close', slug: 'parent' }, {
        wsClient: ws,
        llm: makeStubLlm(JSON.stringify({
            children: [
                { name: 'Open', successCriteria: 'file opened' },
                { name: 'Save', successCriteria: 'saved' },
                { name: 'Close', successCriteria: 'closed' },
            ],
        })),
        log: () => {},
    });
    assert.strictEqual(r.skipped, false);
    assert.strictEqual(r.created, 3);
    assert.strictEqual(ws.calls.upsert.length, 3);
    assert.ok(ws.calls.upsert[0].slug.startsWith('parent--1-open'));
    assert.strictEqual(ws.calls.upsert[0].body.parentGoalId, 'parent');
});

asyncTest('planGoal: priority decreases with order', async () => {
    const ws = makeStubWs();
    await planGoal({ name: 'P', content: 'open the document file then save as PDF then close the editor', slug: 'p' }, {
        wsClient: ws,
        llm: makeStubLlm(JSON.stringify({
            children: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
        })),
        log: () => {},
    });
    assert.ok(ws.calls.upsert[0].body.priority > ws.calls.upsert[1].body.priority);
    assert.ok(ws.calls.upsert[1].body.priority > ws.calls.upsert[2].body.priority);
});

asyncTest('planGoal: idempotent — skips existing slugs', async () => {
    const existing = new Set(['p--1-open']);
    const ws = makeStubWs(existing);
    const r = await planGoal({ name: 'P', content: 'open the document then save as PDF then close the editor', slug: 'p' }, {
        wsClient: ws,
        llm: makeStubLlm(JSON.stringify({
            children: [{ name: 'open' }, { name: 'save' }, { name: 'close' }],
        })),
        log: () => {},
    });
    assert.strictEqual(r.created, 2);
    assert.strictEqual(r.total, 3);
    // 1st was pre-existing → no upsert; 2 new → 2 upserts
    assert.strictEqual(ws.calls.upsert.length, 2);
});

asyncTest('planGoal: malformed LLM JSON → error captured', async () => {
    const r = await planGoal({ name: 'P', content: 'open the document then save the file as a PDF copy', slug: 'p' }, {
        wsClient: makeStubWs(),
        llm: makeStubLlm('not json at all'),
        log: () => {},
    });
    assert.strictEqual(r.skipped, false);
    assert.ok(r.error && r.error.includes('parse failed'));
});

asyncTest('planGoal: handles markdown-fenced JSON', async () => {
    const ws = makeStubWs();
    const fenced = '```json\n{"children":[{"name":"a"},{"name":"b"}]}\n```';
    const r = await planGoal({ name: 'P', content: 'open the document then save the file as a PDF copy', slug: 'p' }, {
        wsClient: ws, llm: makeStubLlm(fenced), log: () => {},
    });
    assert.strictEqual(r.created, 2);
});

// ── Summary ─────────────────────────────────────────────────────────────────
Promise.all(pending).then(() => {
    console.log(`\nplanner.test: ${pass}/${pass + fail} PASS`);
    process.exit(fail > 0 ? 1 : 0);
});
