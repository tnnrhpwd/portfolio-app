/**
 * routing-telemetry.test.js — unit tests for routing observability.
 * Run: node server/automation/routing-telemetry.test.js
 */

'use strict';

const assert = require('assert');
const {
    buildRoutingEvent, emitRoutingEvent, getRoutingStats, resetRoutingStats, recentRoutingEvents, recordMisroute,
} = require('./routing-telemetry');

let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; }
}

console.log('\nrouting-telemetry.test: buildRoutingEvent');
test('produces a normalized event shape', () => {
    const evt = buildRoutingEvent({ text: 'open notepad', intent: 'action', source: 'heuristic', confidence: 0.81234, latencyMs: 12.6, modelCalls: 0 });
    assert.strictEqual(evt.type, 'routing.decision');
    assert.strictEqual(evt.intent, 'action');
    assert.strictEqual(evt.confidence, 0.812);
    assert.strictEqual(evt.latencyMs, 13);
    assert.strictEqual(evt.chars, 'open notepad'.length);
});

test('tolerates missing/garbage fields', () => {
    const evt = buildRoutingEvent({});
    assert.strictEqual(evt.intent, 'unknown');
    assert.strictEqual(evt.source, 'unknown');
    assert.strictEqual(evt.confidence, null);
});

console.log('\nrouting-telemetry.test: emit + counters');
test('records counters and exposes recent events', () => {
    resetRoutingStats();
    emitRoutingEvent(buildRoutingEvent({ intent: 'action', source: 'llm', confidence: 0.9 }));
    emitRoutingEvent(buildRoutingEvent({ intent: 'chat', source: 'cache', confidence: 0.8 }));
    emitRoutingEvent(buildRoutingEvent({ intent: 'disambiguate', source: 'llm', confidence: 0.3 }));
    const stats = getRoutingStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.byIntent.action, 1);
    assert.strictEqual(stats.bySource.cache, 1);
    assert.strictEqual(stats.disambiguations, 1);
    assert.strictEqual(stats.llmClassifications, 2);
    assert.strictEqual(recentRoutingEvents(10).length, 3);
});

test('recordMisroute increments the counter', () => {
    resetRoutingStats();
    recordMisroute('should have been chat');
    assert.strictEqual(getRoutingStats().misroutesReported, 1);
});

test('is bounded (no unbounded growth)', () => {
    resetRoutingStats();
    for (let i = 0; i < 500; i++) emitRoutingEvent(buildRoutingEvent({ intent: 'chat', source: 'heuristic' }));
    assert(recentRoutingEvents(1000).length <= 200);
});

console.log(`\nrouting-telemetry.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
