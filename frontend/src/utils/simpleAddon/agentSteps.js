/**
 * agentSteps.js — the desktop agent's step list, built from its event stream.
 *
 * The cloud path gets its rows from the backend journal
 * (`backend/services/harness/stepJournal.js`), which is why `StepList` renders
 * them. The desktop path has no journal — but `tool-registry.js` publishes
 * `tool.start` / `tool.end` for every call, with the same lifecycle, and those
 * events are all a row needs. This module turns them into rows shaped for
 * `StepList`, so both paths render ONE component.
 *
 * Two rules it inherits rather than invents:
 *
 *   1. **A step opens once and closes once.** The stream sends `tool.start` then
 *      `tool.end`, so a row is UPDATED by `callId` — never appended twice. That
 *      is also why a duplicated start is dropped.
 *   2. **A refusal is not an error.** `Denied: …` / `Cancelled: …` are decisions,
 *      and the backend's journal already sorts them into their own status; a ✕
 *      beside a step nobody ran would report a decision as a fault. Same rule,
 *      applied to the same prefixes.
 *
 * What a row may SHOW is decided by the addon, not here: `event-detail.js`
 * already omits a private tool's arguments entirely, so there is no redaction to
 * redo — and no `argsRedacted` flag, because absent arguments are not the same
 * claim as withheld ones.
 */

import { toolLabel } from './agentProgress.js';

/** The events a row is built from — a subset of AGENT_PROGRESS_TYPES. */
export const ADDON_STEP_TYPES = ['tool.start', 'tool.end'];

/** Bound, matching the journal's own: a run's list is a summary, not a log. */
export const MAX_ADDON_STEPS = 40;

const MAX_PREVIEW_CHARS = 120;

/** One line, clipped — the same shape the journal stores a result preview in. */
function preview(text) {
  const s = String(text ?? '');
  if (!s) return null;
  const flat = s.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_PREVIEW_CHARS ? `${flat.slice(0, MAX_PREVIEW_CHARS)}…[${s.length} chars]` : flat;
}

/**
 * A refusal is its own status. `tool.end` carries `ok: false` for it just like a
 * genuine failure, so the PREFIX is the only thing that tells them apart —
 * exactly as it is server-side.
 */
function statusFor(event) {
  if (event.ok !== false) return 'ok';
  return /^(?:Denied|Cancelled)(?::|\s)/.test(String(event.error ?? '').trim()) ? 'denied' : 'error';
}

/**
 * Fold one addon event into a step list, returning a NEW array.
 *
 * Returns the SAME array when the event changes nothing (a stale replay, a type
 * this list is not built from, a duplicate start, an end for a step we never
 * saw) so a React state setter skips the render.
 *
 * @param {object[]} steps
 * @param {object} event   a decoded SSE payload: `{ ts, type, ...data }`
 * @param {object} [opts]
 * @param {number} [opts.since]  epoch ms the run started; the stream REPLAYS its
 *   ring on subscribe, so anything older belongs to a previous run.
 * @returns {object[]}
 */
export function upsertStep(steps, event, { since = 0 } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  if (!event || typeof event !== 'object') return list;
  if (!ADDON_STEP_TYPES.includes(event.type)) return list;

  const ts = Number(event.ts);
  if (since && Number.isFinite(ts) && ts < since) return list;

  // `callId` is the join between the two events; the fallback only matters for
  // an addon old enough not to send one, where a start can still be its own row.
  const id = String(event.callId ?? `${event.tool ?? 'step'}-${Number.isFinite(ts) ? ts : list.length}`);
  const at = list.findIndex((s) => s.id === id);

  if (event.type === 'tool.start') {
    if (at !== -1) return list;                          // already open
    if (list.length >= MAX_ADDON_STEPS) return list;     // bounded
    return [...list, {
      id,
      index: list.length + 1,
      tool: String(event.tool || 'unknown'),
      plane: 'addon',
      // The row reads as words, the detail shows the tool's real name — the same
      // split the cloud path's labels make.
      label: toolLabel(event.tool),
      status: 'running',
      argsPreview: event.args && typeof event.args === 'object' ? event.args : null,
      argsRedacted: false,
      resultPreview: null,
      error: null,
      ms: null,
    }];
  }

  // tool.end for something this list never saw: a subscription that began
  // mid-run. There is no row to close, and inventing one would show a step with
  // no start time or arguments.
  if (at === -1) return list;

  const ms = Number(event.durationMs);
  const closed = {
    ...list[at],
    status: statusFor(event),
    resultPreview: preview(event.resultPreview),
    error: event.error ? String(event.error) : null,
    ms: Number.isFinite(ms) ? Math.max(0, ms) : null,
  };
  return [...list.slice(0, at), closed, ...list.slice(at + 1)];
}

/** Fold a whole batch of events — for a caller that has them in hand. */
export function stepsFromEvents(events, opts = {}) {
  return (Array.isArray(events) ? events : []).reduce((acc, ev) => upsertStep(acc, ev, opts), []);
}
