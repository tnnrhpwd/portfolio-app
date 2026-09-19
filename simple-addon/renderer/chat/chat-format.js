/**
 * chat-format.js — what the addon's own chat says, in the words /net already uses.
 *
 * **Why this file exists.** The addon's chat window is a mirror of the /net page's
 * agent conversation: same bubbles, same live progress note while the agent works,
 * same "what it tried" report when a run ends without an answer. The website owns
 * that wording in two modules —
 *
 *   frontend/src/utils/simpleAddon/agentProgress.js    (the live note)
 *   frontend/src/utils/simpleAddon/agentStopMessage.js (the stop report)
 *
 * — and this is the addon's half of the same voice. It cannot import them: the
 * website's copies are ES modules, and the addon's windows are `file://` pages that
 * load CLASSIC scripts (Chromium refuses module scripts from `file://`, which is why
 * every addon renderer file is a classic script). So the wording is mirrored here
 * and `chat-format.test.js` asserts the two sides still agree — a wording change on
 * one surface and not the other fails the addon's test run instead of quietly
 * making the same event mean two different sentences.
 *
 * ⚠️ **Two DIFFERENT step shapes, and that is not an accident.** /net reads the
 * backend harness's step journal (`{id, tool, status, ms, outcome, reaskable}`),
 * where a step opens `running` and closes `ok`/`error`/`denied`. The addon's local
 * agent loop keeps a `stepLog` (`{tool, args, ok, result}`) that only records
 * FINISHED steps, and publishes `tool.start`/`tool.end` over SSE while it works.
 * So a live list is built from events (`applyStepEvent`) and the finished list is
 * built from the log (`stepsFromStepLog`) — both normalise to the SAME row shape,
 * so one renderer draws either.
 *
 * Pure and total: no DOM, no fetch, no clock of its own. An event in, a string or a
 * row out. That is what makes the wording testable without a browser.
 *
 * Exposed as `window.SimpleChatFormat` in a renderer and as `module.exports` under
 * Node (for the test).
 *
 * ⚠️ ONE GLOBAL SCOPE. These pages load CLASSIC scripts, so every top-level binding in
 * this file lands in the same lexical scope as `appearance/appearance.js` — and a
 * duplicate `const` is a SyntaxError that kills the whole file, not a quiet shadow.
 * (It did: `API` here and `API` there, and the chat window rendered its "failed to load"
 * fallback.) So the export object is named uniquely, and `chat-format.test.js` asserts
 * the three modules on this page declare no top-level name twice.
 */

'use strict';

/**
 * The event types worth showing live.
 *
 * ⚠️ The SSE URL's `types` filter and this list must agree: named SSE events never
 * reach `EventSource.onmessage`, so a type that is handled but not listed simply
 * never arrives. `chat-format.test.js` pins the URL filter to this array.
 */
const AGENT_PROGRESS_TYPES = ['tool.start', 'tool.end', 'agent.thought', 'agent.step'];

/**
 * The human-facing fragments this module shares with the website's copies.
 *
 * Not documentation — `chat-format.test.js` reads the two frontend modules and
 * asserts every one of these still appears in them. A fragment listed here that the
 * website no longer says is drift, and the test says which one.
 */
const WORDING_ANCHORS = [
  'Running ',
  ' — done in ',
  ' — done',
  ' — did not work',
  'Thinking…',
  'Next: ',
  'Step ',
  ' of ',
  '🤖 **Nothing was attempted**',
  '🤖 **The agent finished without a summary**',
  '🤖 **The agent stopped before finishing**',
  '**Why:** ',
  '**How far it got:** ',
  '**What it tried**',
  ' — worked',
];

/** A tool name in words: `screen_capture` → "screen capture". */
function toolLabel(tool) {
  const name = String(tool === undefined || tool === null ? '' : tool).trim();
  return name ? name.replace(/[_-]+/g, ' ') : 'a step';
}

/** Durations are for someone watching a spinner: 0.4s, never 0.4317s. */
function seconds(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1000 ? `${Math.round(n / 100) / 10}s` : `${Math.round(n / 1000)}s`;
}

/** An error can be a paragraph; a note is one line. */
function clip(text, max) {
  const limit = Number.isFinite(max) ? max : 80;
  const flat = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * The note for one live addon event, or null when the event says nothing the user
 * needs (an unhandled type, a malformed payload, or replayed history).
 *
 * @param {object} event  a decoded SSE payload: `{seq, ts, type, ...data}`
 * @param {object} [opts]
 * @param {number} [opts.since]  epoch ms the turn started. The stream REPLAYS its
 *   ring on subscribe (`events.recent(20)`), so without this a previous run's last
 *   tool flashes up as if it were happening now. An event with no timestamp cannot
 *   be judged and is shown rather than dropped — silence is the failure being fixed.
 * @returns {string|null}
 */
function progressFromEvent(event, opts) {
  if (!event || typeof event !== 'object') return null;
  const since = Number((opts && opts.since) || 0);
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
 * arrived. /net keeps the same fallback for the same reason: the poll reports the
 * LOOP INSTANCE's own state, and a chat run lives on a pooled loop
 * (`_getOrCreateLoop`), so it can be describing a different run entirely.
 */
function progressFromStatus(status) {
  if (!status || !status.running) return null;
  const log = Array.isArray(status.stepLog) ? status.stepLog : [];
  const last = log[log.length - 1];
  const step = Number(status.step);
  const tool = last && last.tool ? ` — ${toolLabel(last.tool)}` : '';
  return `Step ${Number.isFinite(step) ? step : 0}${tool}…`;
}

/** Longest tool result kept on a row. The full record belongs to the action log. */
const RESULT_PREVIEW_CHARS = 300;

/**
 * A step's identity, for matching a `tool.end` to the `tool.start` that opened it.
 *
 * `callId` is the loop's own id for the call and is what actually correlates the two
 * events. It is not always present (older builds, and any event published outside a
 * tool call), so the tool NAME is the fallback — and a tool that starts twice without
 * a call id closes the OLDEST still-open row of that name, which is the best
 * available guess and is why the fallback is second.
 */
function stepKeyFor(event, fallbackSeq) {
  const callId = event && event.callId;
  if (callId !== undefined && callId !== null && String(callId) !== '') return `call:${callId}`;
  const seq = event && Number(event.seq);
  if (Number.isFinite(seq) && seq > 0) return `seq:${seq}`;
  return `seq:${Number.isFinite(fallbackSeq) ? fallbackSeq : 0}`;
}

/** One finished row, normalised from the loop's `stepLog` entry. */
function normaliseLogStep(entry, index) {
  const ok = !!(entry && entry.ok);
  const detail = entry && entry.result !== undefined && entry.result !== null ? entry.result : '';
  const text = typeof detail === 'string' ? detail : safeJson(detail);
  return {
    id: `log-${index}`,
    tool: (entry && entry.tool) || 'a step',
    label: toolLabel(entry && entry.tool),
    status: ok ? 'ok' : 'error',
    ms: null,
    detail: clip(text, RESULT_PREVIEW_CHARS),
    ok,
  };
}

/** JSON that never throws and never says "[object Object]". */
function safeJson(value) {
  try {
    const out = JSON.stringify(value);
    return out === undefined ? String(value) : out;
  } catch {
    return String(value);
  }
}

/**
 * The finished rows for a run, from the addon's own `stepLog`.
 *
 * A row per tool call, in the order they ran — the same list /net shows, so "what
 * did it try?" is answered on both surfaces rather than only on the website.
 */
function stepsFromStepLog(stepLog) {
  if (!Array.isArray(stepLog)) return [];
  return stepLog.map(normaliseLogStep);
}

/**
 * Fold one live event into a step list. Returns a NEW array (or the same one when
 * the event is irrelevant), so the caller can re-render without guessing.
 *
 * `tool.start` opens a row in the `running` state and `tool.end` CLOSES it — that
 * pairing is why this upserts instead of appending: /net's journal does the same so
 * a row is updated, not drawn twice.
 */
function applyStepEvent(steps, event) {
  const list = Array.isArray(steps) ? steps.slice() : [];
  if (!event || typeof event !== 'object') return list;

  if (event.type === 'tool.start') {
    list.push({
      id: stepKeyFor(event, list.length + 1),
      tool: event.tool || 'a step',
      label: toolLabel(event.tool),
      status: 'running',
      ms: null,
      detail: '',
      ok: false,
    });
    return list;
  }

  if (event.type !== 'tool.end') return list;

  const key = stepKeyFor(event, list.length);
  const byCall = list.findIndex((s) => s.id === key);
  const byName = list.findIndex((s) => s.status === 'running' && s.tool === event.tool);
  // Oldest open row of that name, not the newest: tools run in order, so the one
  // that has not closed yet and started earliest is the one this result belongs to.
  const index = byCall !== -1 ? byCall : byName;

  const ms = Number(event.durationMs);
  const closed = {
    id: index !== -1 ? list[index].id : `end-${list.length + 1}`,
    tool: event.tool || (index !== -1 ? list[index].tool : 'a step'),
    label: toolLabel(event.tool),
    status: event.ok === false ? 'error' : 'ok',
    ms: Number.isFinite(ms) && ms >= 0 ? ms : null,
    detail: event.ok === false ? clip(event.error, RESULT_PREVIEW_CHARS) : clip(event.resultPreview, RESULT_PREVIEW_CHARS),
    ok: event.ok !== false,
  };

  if (index === -1) list.push(closed);
  else list[index] = closed;
  return list;
}

/** Human summary of a list: "6 steps · 1 failed · 2.4s" — the StepList headline. */
function summariseSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const failed = list.filter((s) => s.status === 'error');
  const totalMs = list.reduce((sum, s) => sum + (Number(s.ms) || 0), 0);
  const parts = [`${list.length} step${list.length === 1 ? '' : 's'}`];
  if (failed.length) parts.push(`${failed.length} failed`);
  if (totalMs) parts.push(totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`);
  return parts.join(' · ');
}

/**
 * The report for a run that ended WITHOUT an answer.
 *
 * Mirrors `agentStopMessage.js` on the website, deliberately including the
 * `steps === 0` distinction: a run that attempted nothing is a different problem
 * from a run that tried and gave up, and the two used to read identically.
 *
 * @param {object} result  the addon's `POST /api/agent/run` response
 * @returns {string}
 */
function agentStopMessage(result) {
  const res = result || {};
  const outcome = res.status || 'stopped';
  const reason = String(res.reason || '').trim();
  const steps = typeof res.steps === 'number' ? res.steps : null;
  const log = Array.isArray(res.stepLog) ? res.stepLog : [];
  const maxShown = 6;

  const heading = steps === 0
    ? '🤖 **Nothing was attempted**'
    : outcome === 'done'
      ? '🤖 **The agent finished without a summary**'
      : '🤖 **The agent stopped before finishing**';

  const lines = [heading, ''];
  lines.push(`**Why:** ${reason || `it stopped (${outcome}).`}`);

  if (steps !== null) {
    lines.push('');
    lines.push(`**How far it got:** ${steps} step${steps === 1 ? '' : 's'}.`);
  }

  if (log.length) {
    const shown = log.slice(-maxShown);
    const earlier = log.length - shown.length;
    lines.push('');
    lines.push(earlier > 0 ? `**What it tried** (last ${shown.length} of ${log.length}):` : '**What it tried:**');
    for (const step of shown) lines.push(`- ${describeLogStep(step)}`);
    if (earlier > 0) lines.push(`- …and ${earlier} earlier step${earlier === 1 ? '' : 's'}.`);
  }

  return lines.join('\n');
}

/** One bullet: what it tried, and whether it worked. */
function describeLogStep(step) {
  const tool = `\`${toolLabel(step && step.tool)}\``;
  if (step && step.ok) return `${tool} — worked`;
  const why = clip(step && step.result, 140);
  if (!why) return `${tool} — failed`;
  return `${tool} — ${why}`;
}

/**
 * What the assistant bubble should say for a finished turn, and what to draw with it.
 *
 * The order of these arms IS the product decision, and it is the same one /net makes:
 *
 *   1. a transport/agent error            → say so, as an error
 *   2. a low-confidence action that needs  → ask, do not guess
 *      confirming
 *   3. the message was not actionable      → the conversational reply (if any)
 *   4. there is a final answer             → that answer
 *   5. otherwise                           → explain the stop, with the step log
 *
 * Arm 5 is the one that used to be a bare token. Arm 1 carries an `Error: ` prefix
 * so the bubble styles it as a failure — the repo's convention is that a failure
 * ANNOUNCES itself, and an unprefixed string is counted as a success.
 *
 * @returns {{kind: 'answer'|'question'|'stopped'|'error', text: string, goalSlug?: string}}
 */
function runOutcome(result) {
  const res = result || {};

  if (res.error) {
    return { kind: 'error', text: `Error: ${clip(res.error, 400) || 'the run failed.'}`, goalSlug: res.goalSlug || null };
  }

  if (res.needsDisambiguation) {
    return {
      kind: 'question',
      text: String(res.question || 'Do you want me to actually do this on your PC, or were you asking a question?'),
      goalSlug: res.goalSlug || null,
    };
  }

  if (res.actionable === false) {
    return {
      kind: 'answer',
      // A non-actionable message that the classifier could not answer either. Saying
      // nothing at all would look like a hang, so name what happened.
      text: String(res.chatReply || "That did not look like something to do on your PC, and I have no answer to give for it. Try rephrasing it as a task."),
      goalSlug: res.goalSlug || null,
    };
  }

  const answer = typeof res.result === 'string' ? res.result.trim() : '';
  if (answer) return { kind: 'answer', text: answer, goalSlug: res.goalSlug || null };

  return { kind: 'stopped', text: agentStopMessage(res), goalSlug: res.goalSlug || null };
}

const CHAT_FORMAT_API = {
  AGENT_PROGRESS_TYPES,
  WORDING_ANCHORS,
  RESULT_PREVIEW_CHARS,
  toolLabel,
  seconds,
  clip,
  progressFromEvent,
  progressFromStatus,
  stepsFromStepLog,
  applyStepEvent,
  summariseSteps,
  agentStopMessage,
  runOutcome,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHAT_FORMAT_API;
} else if (typeof window !== 'undefined') {
  window.SimpleChatFormat = CHAT_FORMAT_API;
}
