/**
 * routing-classifier.test.js — unit tests for the addon's action-vs-chat
 * routing lexicon + classifier. No LLM calls are made.
 *
 * Run: node server/automation/routing-classifier.test.js
 */

'use strict';

const assert = require('assert');
const {
    analyzeLexicon, normalizeMessage, ACTION_HINT_RE, CHAT_HINT_RE,
} = require('./routing-lexicon');
const {
    parseClassifierVerdict, decideClassification, createVerdictCache, CONFIDENCE_FLOOR,
} = require('./routing-classifier');

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

// ── Lexicon ─────────────────────────────────────────────────────────────────

console.log('\nrouting-classifier.test: lexicon');
test('imperative action verb → verdict action', () => {
    const r = analyzeLexicon('open notepad');
    assert.strictEqual(r.verdict, 'action');
    assert(r.confidence >= 0.55);
    assert.strictEqual(r.imperativeStart, true);
});

test('polite preamble still counts as imperative', () => {
    const r = analyzeLexicon('can you please open notepad');
    assert.strictEqual(r.verdict, 'action');
    assert.strictEqual(r.imperativeStart, true);
});

test('pure question → verdict chat', () => {
    const r = analyzeLexicon('what is the capital of France?');
    assert.strictEqual(r.verdict, 'chat');
});

test('action + question marker → ambiguous', () => {
    const r = analyzeLexicon('can you open a file for me?');
    assert.strictEqual(r.verdict, 'ambiguous');
});

test('empty / whitespace → ambiguous with zero confidence', () => {
    assert.strictEqual(analyzeLexicon('').verdict, 'ambiguous');
    assert.strictEqual(analyzeLexicon('   ').confidence, 0);
});

test('regexes understand accented letters (no ASCII \\b gap)', () => {
    assert(ACTION_HINT_RE.test('ouvrir caf\u00e9 open'));
    assert(!CHAT_HINT_RE.test('café'));
});

test('normalizeMessage is case/space insensitive', () => {
    assert.strictEqual(normalizeMessage('  Open   Notepad '), 'open notepad');
});

// ── parseClassifierVerdict ──────────────────────────────────────────────────

console.log('\nrouting-classifier.test: verdict parsing');
test('parses a clean JSON verdict', () => {
    const v = parseClassifierVerdict('{"actionable": true, "confidence": 0.9, "reply": "hi"}');
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.actionable, true);
    assert.strictEqual(v.confidence, 0.9);
});

test('parses JSON inside code fences and prose', () => {
    const v = parseClassifierVerdict('Sure!\n```json\n{"actionable": false, "confidence": 0.8, "reply": "42"}\n```');
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.actionable, false);
    assert.strictEqual(v.reply, '42');
});

test('legacy ACT sentinel still works', () => {
    const v = parseClassifierVerdict('ACT');
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.actionable, true);
});

test('non-JSON reply is treated as a conversational answer', () => {
    const v = parseClassifierVerdict('The capital of France is Paris.');
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reply, 'The capital of France is Paris.');
});

test('missing actionable field → invalid', () => {
    const v = parseClassifierVerdict('{"confidence": 0.5, "reply": "x"}');
    assert.strictEqual(v.valid, false);
});

test('long replies are truncated (no 300-char cliff)', () => {
    const long = 'x'.repeat(5000);
    const v = parseClassifierVerdict(JSON.stringify({ actionable: false, reply: long }), { maxReply: 100 });
    assert(v.reply.length <= 100);
});

test('malformed JSON returns invalid with best-effort reply', () => {
    const v = parseClassifierVerdict('{"actionable": tru');
    assert.strictEqual(v.valid, false);
});

// ── decideClassification ────────────────────────────────────────────────────

console.log('\nrouting-classifier.test: decision folding');
test('valid LLM verdict wins over heuristic', () => {
    const heuristic = analyzeLexicon('open notepad');
    const llmVerdict = parseClassifierVerdict('{"actionable": false, "confidence": 0.9, "reply": "no"}');
    const d = decideClassification({ heuristic, llmVerdict });
    assert.strictEqual(d.actionable, false);
    assert.strictEqual(d.source, 'llm');
    assert.strictEqual(d.chatReply, 'no');
});

test('actionable LLM verdict clears chatReply', () => {
    const heuristic = analyzeLexicon('what is this?');
    const llmVerdict = parseClassifierVerdict('{"actionable": true, "confidence": 0.8, "reply": "ignored"}');
    const d = decideClassification({ heuristic, llmVerdict });
    assert.strictEqual(d.actionable, true);
    assert.strictEqual(d.chatReply, null);
});

test('no LLM verdict falls back to heuristic with reduced confidence', () => {
    const heuristic = analyzeLexicon('open notepad');
    const d = decideClassification({ heuristic, llmVerdict: null });
    assert.strictEqual(d.actionable, true);
    assert.strictEqual(d.source, 'heuristic-fallback');
    assert(d.confidence <= heuristic.confidence);
});

test('CONFIDENCE_FLOOR is a sane threshold', () => {
    assert(CONFIDENCE_FLOOR > 0 && CONFIDENCE_FLOOR < 1);
});

// ── Cache ───────────────────────────────────────────────────────────────────

console.log('\nrouting-classifier.test: verdict cache');
test('caches and returns the same decision', () => {
    const cache = createVerdictCache();
    const value = { actionable: true, confidence: 0.9, source: 'llm', chatReply: null };
    cache.set('Open Notepad', value);
    assert.deepStrictEqual(cache.get('  open   notepad '), value);
    assert.strictEqual(cache.size, 1);
});

test('respects the max size (evicts oldest)', () => {
    const cache = createVerdictCache({ max: 2 });
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.get('a'), null);
    assert.strictEqual(cache.get('c'), 3);
});

test('expired entries are dropped', () => {
    const cache = createVerdictCache({ ttlMs: -1 });
    cache.set('a', 1);
    assert.strictEqual(cache.get('a'), null);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nrouting-classifier.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
