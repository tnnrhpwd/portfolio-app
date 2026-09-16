/**
 * Process-wide event bus for automation telemetry.
 *
 * Producers (tool registry, agent loop, recorder, approval flow) publish
 * structured events. Subscribers (the SSE route, the addon's tray UI, future
 * cloud-relay forwarders) receive them via the `subscribe()` API.
 *
 * Events are append-only and kept in a small ring buffer so a late subscriber
 * can replay the last N events on connect — useful when a web UI panel opens
 * mid-task and needs to catch up.
 *
 * Event shape (all events MUST have ts + type):
 *   { ts, type, ...data }
 *
 * ⚠️ What goes in `data` is governed by `event-detail.js`, not by convenience:
 * an event is a REPORT (the /simple console, the tray, the dashboard, anything
 * subscribed over SSE). The full-fidelity record belongs to the workspace action
 * log via `ctx.addAction`. Concretely: PII-tool arguments/results are omitted,
 * image-shaped and oversized values are dropped, and a tool result is carried as
 * a short `resultPreview` rather than the result itself.
 *
 * Known types:
 *   tool.start        { tool, args, goalSlug?, runId?, callId }
 *   tool.end          { tool, ok, error?, resultPreview?, durationMs, callId, mode, runId? }
 *   agent.goal        { goalSlug, goalName, horizon, status, priority, maxSteps }
 *   agent.observe     { goalSlug, step, contextBytes, skills[], hasPerception }
 *   agent.thought     { goalSlug, step, text, willCall[] }
 *   agent.step        { goalSlug, step, maxSteps, lastTickAt, modelId }
 *   agent.message     { goalSlug, role, content }      // assistant text
 *   agent.stopped     { goalSlug, reason }
 *   approval.pending  { id, toolName, args, createdAt }
 *   approval.resolved { id, approved, reason }
 *   recorder.started  { sessionId, name }
 *   recorder.stopped  { sessionId, eventCount, durationMs }
 *   permissions.changed { changedKeys: [...] }
 *   skill.run         { slug, stepsRun, failed }
 *
 * Subscribers receive every published event; filtering is the subscriber's
 * responsibility.
 */

const MAX_RING = 500;
const _ring = [];
const _subs = new Set();

function _nextSeq() {
    _nextSeq._n = (_nextSeq._n || 0) + 1;
    return _nextSeq._n;
}

/**
 * Publish an event. Returns the event with `seq` + `ts` filled in.
 */
function publish(type, data = {}) {
    const ev = {
        seq: _nextSeq(),
        ts: Date.now(),
        type: String(type),
        ...data,
    };
    _ring.push(ev);
    if (_ring.length > MAX_RING) _ring.splice(0, _ring.length - MAX_RING);
    for (const sub of _subs) {
        try { sub(ev); } catch { /* never let a subscriber kill the publisher */ }
    }
    return ev;
}

/**
 * Subscribe to events. Returns an unsubscribe function.
 *
 * @param {(ev: object) => void} fn
 */
function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('subscribe requires a function');
    _subs.add(fn);
    return () => _subs.delete(fn);
}

/**
 * Return the most recent N events from the ring. Used by new subscribers to
 * catch up on what they missed.
 */
function recent(n = 50, sinceSeq = 0) {
    const slice = _ring.slice(-Math.max(0, Math.min(MAX_RING, n)));
    if (sinceSeq > 0) return slice.filter(e => e.seq > sinceSeq);
    return slice;
}

function size() { return _ring.length; }

module.exports = { publish, subscribe, recent, size };
