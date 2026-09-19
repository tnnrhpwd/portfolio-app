/**
 * agentProgress.js — what the /net chat says while the DESKTOP agent works.
 *
 * The addon's local agent gives no token stream, so the chat's only sign of life
 * used to be a 2 s `getAgentStatus()` poll. That poll reads the LOOP's own
 * status, and while it reported nothing the note sat on "Working on it…" until
 * the turn ended — so the one moment the progress line moved was the moment it
 * stopped being needed.
 *
 * The addon already broadcasts better material: `tool-registry.js` publishes
 * `tool.start`/`tool.end` for EVERY tool call, tagged with the run id, and
 * `/api/agent/events` streams them — the route's own comment says it exists so a
 * UI can "reconstruct a live, step-by-step view of one specific run even while
 * other runs/agent activity are happening concurrently". So the chat subscribes,
 * and this module owns the wording.
 *
 * Pure and total: an event in, a string (or null) out. No DOM, no clock, no
 * fetch — which is also what makes the wording testable.
 */

/**
 * The event types the chat subscribes to.
 *
 * The SSE URL's `types` filter and the listener list in `SimpleChat` BOTH come
 * from here on purpose: named SSE events never reach `onmessage`, so a type that
 * is handled but not listed simply never arrives, and one that is listed but not
 * handled makes the chat listen for something it cannot say. A test pins the two
 * together.
 */
export const AGENT_PROGRESS_TYPES = ['tool.start', 'tool.end', 'agent.thought', 'agent.step'];

/** A tool name in words: `screen_capture` → "screen capture". */
export function toolLabel(tool) {
  const name = String(tool ?? '').trim();
  return name ? name.replace(/[_-]+/g, ' ') : 'a step';
}

/** Durations are for someone watching a spinner: 0.4s, never 0.4317s. */
function seconds(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1000 ? `${Math.round(n / 100) / 10}s` : `${Math.round(n / 1000)}s`;
}

/** An error can be a paragraph; the note is one line. */
function clip(text, max = 80) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The note for one live addon event, or `null` when the event says nothing the
 * user needs (an unhandled type, a malformed payload, or replayed history).
 *
 * @param {object} event  a decoded SSE payload: `{ ts, type, ...data }`
 * @param {object} [opts]
 * @param {number} [opts.since]  epoch ms the turn started. The stream REPLAYS its
 *   ring on subscribe, so without this a previous run's last tool flashes up as
 *   if it were happening now. An event with no timestamp cannot be judged and is
 *   shown rather than dropped — silence is the failure being fixed.
 * @returns {string|null}
 */
export function progressFromEvent(event, { since = 0 } = {}) {
  if (!event || typeof event !== 'object') return null;
  const ts = Number(event.ts);
  if (since && Number.isFinite(ts) && ts < since) return null;

  switch (event.type) {
    case 'tool.start':
      return `Running ${toolLabel(event.tool)}…`;
    case 'tool.end': {
      const name = toolLabel(event.tool);
      if (event.ok === false) {
        const why = clip(event.error);
        return why ? `${name} — ${why}` : `${name} — did not work`;
      }
      const took = seconds(event.durationMs);
      return took ? `${name} — done in ${took}` : `${name} — done`;
    }
    case 'agent.thought': {
      const next = Array.isArray(event.willCall) ? event.willCall.filter(Boolean) : [];
      return next.length ? `Next: ${next.map(toolLabel).join(', ')}` : 'Thinking…';
    }
    case 'agent.step': {
      const step = Number(event.step);
      if (!Number.isFinite(step)) return null;
      const max = Number(event.maxSteps);
      return Number.isFinite(max) && max > 0 ? `Step ${step} of ${max}…` : `Step ${step}…`;
    }
    default:
      return null;
  }
}

/**
 * The note for the status POLL — the fallback, used only while no live event has
 * arrived (a coarser "Step N" would be a downgrade once the stream is working).
 *
 * @param {object|null} status  the addon's `/api/agent/status` payload
 * @returns {string|null}
 */
export function progressFromStatus(status) {
  if (!status || !status.running) return null;
  const log = Array.isArray(status.stepLog) ? status.stepLog : [];
  const last = log[log.length - 1];
  const step = Number(status.step);
  const tool = last?.tool ? ` — ${toolLabel(last.tool)}` : '';
  return `Step ${Number.isFinite(step) ? step : 0}${tool}…`;
}
