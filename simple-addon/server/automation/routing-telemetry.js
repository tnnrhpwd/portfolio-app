'use strict';

/**
 * routing-telemetry.js — structured, low-cardinality telemetry for every
 * routing decision the addon makes.
 *
 * Every message that hits the agent loop produces exactly one routing event:
 * what the lexical heuristic thought, whether the LLM was consulted, the final
 * intent, and how confident we were. This is what turns "it went somewhere"
 * into "it went to the agent because the LLM said ACT at 0.62 confidence".
 *
 * Design notes:
 *   - Pure event *building* (`buildRoutingEvent`) is separated from emission so
 *     it can be unit-tested without the event bus.
 *   - We deliberately do NOT persist these to DynamoDB (see the repo audit note
 *     about unbounded per-request writes). They go to the in-process event bus
 *     (for the SSE/debug panel) plus a bounded ring + counters.
 */

const events = require('./events');

const MAX_EVENTS = 200;
const _ring = [];
const _counters = {
    total: 0,
    byIntent: Object.create(null),
    bySource: Object.create(null),
    disambiguations: 0,
    llmClassifications: 0,
    heuristicFastPath: 0,
    cacheHits: 0,
    misroutesReported: 0,
};

/** Build the normalized event object (pure). */
function buildRoutingEvent({
    text, intent, source, confidence, layer = 'addon', latencyMs = 0,
    modelCalls = 0, meta = null,
} = {}) {
    return {
        type: 'routing.decision',
        layer,
        intent: intent || 'unknown',
        source: source || 'unknown',
        confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(3)) : null,
        latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
        modelCalls: modelCalls || 0,
        chars: typeof text === 'string' ? text.length : 0,
        ...(meta ? { meta } : {}),
    };
}

/** Emit + record a routing event. Never throws. */
function emitRoutingEvent(evt = {}) {
    try {
        const full = { type: 'routing.decision', ...evt };
        _counters.total++;
        _counters.byIntent[full.intent] = (_counters.byIntent[full.intent] || 0) + 1;
        _counters.bySource[full.source] = (_counters.bySource[full.source] || 0) + 1;
        if (full.source === 'llm') _counters.llmClassifications++;
        if (full.source === 'heuristic' || full.source === 'heuristic-fallback') _counters.heuristicFastPath++;
        if (full.source === 'cache') _counters.cacheHits++;
        if (full.intent === 'disambiguate') _counters.disambiguations++;
        _ring.push(full);
        if (_ring.length > MAX_EVENTS) _ring.splice(0, _ring.length - MAX_EVENTS);
        events.publish(full.type, full);
    } catch { /* telemetry must never break routing */ }
}

/** Recent routing events (newest last). */
function recentRoutingEvents(n = 50) {
    return _ring.slice(-Math.max(0, Math.min(MAX_EVENTS, n)));
}

/** Snapshot of counters (for a debug/status endpoint or tests). */
function getRoutingStats() {
    return {
        ..._counters,
        byIntent: { ..._counters.byIntent },
        bySource: { ..._counters.bySource },
        recent: _ring.slice(-10),
    };
}

/** Test hook. */
function resetRoutingStats() {
    _ring.length = 0;
    _counters.total = 0;
    _counters.byIntent = Object.create(null);
    _counters.bySource = Object.create(null);
    _counters.disambiguations = 0;
    _counters.llmClassifications = 0;
    _counters.heuristicFastPath = 0;
    _counters.cacheHits = 0;
    _counters.misroutesReported = 0;
}

/** Record that a user told us a routing decision was wrong. */
function recordMisroute(note = null) {
    _counters.misroutesReported++;
    events.publish('routing.misroute', { ts: Date.now(), note });
}

module.exports = {
    buildRoutingEvent,
    emitRoutingEvent,
    recentRoutingEvents,
    getRoutingStats,
    resetRoutingStats,
    recordMisroute,
};
