/**
 * routingTelemetry.js — structured observability for backend /net routing.
 *
 * Complements the addon's `routing-telemetry.js`. Records, per chat turn:
 * which layer decided, what tool set was offered, which tools the model
 * actually called, and the admin/capability posture — so a misroute ("why did
 * it try to edit the repo?" / "why did this user get repo tools?") is
 * answerable from logs alone.
 *
 * Deliberately log + in-memory only. We do NOT write one DynamoDB record per
 * chat turn (see the repo audit finding about unbounded per-request writes).
 */

const { logger } = require('../utils/logger');

const MAX_EVENTS = 200;
const _ring = [];
const _counters = {
  total: 0,
  byIntent: Object.create(null),
  toolCalls: 0,
  deniedToolCalls: 0,
  adminTurns: 0,
};

/** Build a normalized, low-cardinality routing event (pure). */
function buildRoutingEvent({
  layer = 'backend', intent = 'chat', source = 'llm', confidence = null,
  isAdmin = false, toolsOffered = 0, toolsUsed = 0, modelCalls = 1, latencyMs = null,
  meta = null,
} = {}) {
  return {
    event: 'routing.decision',
    layer,
    intent,
    source,
    confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(3)) : null,
    isAdmin: !!isAdmin,
    toolsOffered: toolsOffered || 0,
    toolsUsed: toolsUsed || 0,
    modelCalls: modelCalls || 0,
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    ...(meta ? { meta } : {}),
  };
}

/** Record a routing event (logger + bounded ring). Never throws. */
function recordRoutingEvent(evt = {}) {
  try {
    const full = { event: 'routing.decision', ...evt };
    _counters.total++;
    _counters.byIntent[full.intent] = (_counters.byIntent[full.intent] || 0) + 1;
    _counters.toolCalls += full.toolsUsed || 0;
    if (full.isAdmin) _counters.adminTurns++;
    _ring.push(full);
    if (_ring.length > MAX_EVENTS) _ring.splice(0, _ring.length - MAX_EVENTS);
    logger.info(`🧭 routing: ${JSON.stringify(full)}`);
  } catch { /* telemetry must never break a chat turn */ }
}

/** Record a tool call that was refused by the capability gate. */
function recordDeniedToolCall(toolName, toolContext, reason) {
  try {
    _counters.deniedToolCalls++;
    logger.warn(`⛔ routing: tool "${toolName}" denied (${reason}) for user ${toolContext?.userId || '?'}`);
  } catch { /* ignore */ }
}

function recentRoutingEvents(n = 50) {
  return _ring.slice(-Math.max(0, Math.min(MAX_EVENTS, n)));
}

function getRoutingStats() {
  return {
    ..._counters,
    byIntent: { ..._counters.byIntent },
    recent: _ring.slice(-10),
  };
}

function resetRoutingStats() {
  _ring.length = 0;
  _counters.total = 0;
  _counters.byIntent = Object.create(null);
  _counters.toolCalls = 0;
  _counters.deniedToolCalls = 0;
  _counters.adminTurns = 0;
}

module.exports = {
  buildRoutingEvent,
  recordRoutingEvent,
  recordDeniedToolCall,
  recentRoutingEvents,
  getRoutingStats,
  resetRoutingStats,
};
