/**
 * critic.test.js — unit tests for the PDCA "Check" stage (Phase 4 of the
 * O-O-G-P-A plan). Fully offline; pure functions + an injected fake
 * workspace-client for `writeLesson`.
 *
 * Run: node server/automation/critic.test.js
 */

'use strict';

const assert = require('assert');
const { score, hashPattern, buildLesson, writeLesson, recall } = require('./critic');

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

(async () => {
    console.log('\ncritic.test: score / lesson / recall');

    // ── score ──────────────────────────────────────────────────────────────
    test('score: all-ok maps to +0.5 (≥0)', () => {
        assert.strictEqual(score({ predicted: 'toolA', actual: [{ ok: true }, { ok: true }] }), 0.5);
    });
    test('score: single error maps to -1 (<0)', () => {
        assert.strictEqual(score({ predicted: 'toolA', actual: { ok: false, error: 'boom' } }), -1);
    });
    test('score: all-error maps to -1', () => {
        assert.strictEqual(score({ predicted: 'a,b', actual: [{ ok: false, error: 'x' }, { ok: false, error: 'y' }] }), -1);
    });
    test('score: partial failure maps to -0.5', () => {
        assert.strictEqual(score({ predicted: 'a,b', actual: [{ ok: true }, { ok: false, error: 'x' }] }), -0.5);
    });
    test('score: empty (idle) maps to 0', () => {
        assert.strictEqual(score({ predicted: 'no-op', actual: [] }), 0);
    });

    // ── hashPattern ───────────────────────────────────────────────────────
    test('hashPattern: deterministic', () => {
        assert.strictEqual(hashPattern('abc'), hashPattern('abc'));
    });
    test('hashPattern: differs for different patterns', () => {
        assert.notStrictEqual(hashPattern('abc'), hashPattern('def'));
    });

    // ── buildLesson ───────────────────────────────────────────────────────
    test('buildLesson: documented shape', () => {
        const lesson = buildLesson(
            { expected: 'toolA' },
            { outcomes: [{ name: 'toolA', out: { ok: false, error: 'boom' } }] },
            { goalSlug: 'g' },
        );
        assert.strictEqual(typeof lesson.pattern, 'string');
        assert.ok(lesson.pattern.includes('toolA'));
        assert.strictEqual(typeof lesson.context, 'string');
        assert.strictEqual(typeof lesson.do, 'string');
        assert.strictEqual(typeof lesson.avoid, 'string');
        assert.strictEqual(typeof lesson.confidence, 'number');
        assert.strictEqual(lesson.sourceGoal, 'g');
    });

    // ── writeLesson ───────────────────────────────────────────────────────
    await asyncTest('writeLesson: writes one hashed-slug lesson on failure', async () => {
        const written = [];
        const wsClient = { upsertLesson: async (slug, body) => { written.push({ slug, body }); return {}; } };
        const action = { expected: 'toolA' };
        const outcome = { outcomes: [{ name: 'toolA', out: { ok: false, error: 'boom' } }] };
        const slug = await writeLesson(action, outcome, { wsClient, goalSlug: 'g' });
        assert.strictEqual(written.length, 1);
        assert.ok(slug.startsWith('lesson-'), `slug should start with lesson-, got ${slug}`);
        assert.strictEqual(written[0].slug, slug);
        const parsed = JSON.parse(written[0].body.content);
        assert.strictEqual(parsed.sourceGoal, 'g');
        assert.ok(parsed.pattern.includes('toolA'));
        assert.ok(written[0].body.name.length <= 80);
    });

    await asyncTest('writeLesson: idempotent slug for the same failure pattern', async () => {
        const written = [];
        const wsClient = { upsertLesson: async (slug, body) => { written.push(slug); return {}; } };
        const action = { expected: 'toolA' };
        const outcome = { outcomes: [{ name: 'toolA', out: { ok: false, error: 'boom' } }] };
        const a = await writeLesson(action, outcome, { wsClient, goalSlug: 'g' });
        const b = await writeLesson(action, outcome, { wsClient, goalSlug: 'g' });
        assert.strictEqual(a, b, 'same pattern → same slug (PUT overwrites)');
    });

    await asyncTest('writeLesson: returns null when nothing failed', async () => {
        const written = [];
        const wsClient = { upsertLesson: async (slug) => { written.push(slug); return {}; } };
        const slug = await writeLesson(
            { expected: 'toolA' },
            { outcomes: [{ name: 'toolA', out: { ok: true } }] },
            { wsClient, goalSlug: 'g' },
        );
        assert.strictEqual(slug, null);
        assert.strictEqual(written.length, 0);
    });

    await asyncTest('writeLesson: returns null when upsertLesson is unavailable', async () => {
        const slug = await writeLesson(
            { expected: 'toolA' },
            { outcomes: [{ name: 'toolA', out: { ok: false, error: 'boom' } }] },
            { wsClient: {}, goalSlug: 'g' },
        );
        assert.strictEqual(slug, null);
    });

    // ── recall ────────────────────────────────────────────────────────────
    test('recall: ranks lessons by token overlap and drops zero-score', () => {
        const lessons = [
            { content: { pattern: 'save dialog needs wait', do: 'insert wait_for', avoid: 'fixed waits' } },
            { content: { pattern: 'unrelated keyboard macro' } },
        ];
        const out = recall('save dialog requires wait_for before typing', lessons, 2);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0], lessons[0]);
    });

    test('recall: caps at topK', () => {
        const lessons = [
            { content: { pattern: 'save dialog wait' } },
            { content: { pattern: 'save dialog typing' } },
            { content: { pattern: 'save dialog click' } },
        ];
        const out = recall('save dialog', lessons, 2);
        assert.strictEqual(out.length, 2);
    });

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
