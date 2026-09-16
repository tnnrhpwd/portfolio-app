/**
 * agentTerminalUtils.js — pure helpers for the /simple live terminal.
 *
 * Two very different sources feed one console:
 *
 *   • the desktop addon, over SSE (`tool.start`, `agent.stage`, `agent.message`, …)
 *     — instant, and only available while the addon is connected;
 *   • a cloud run, whose steps (`thought`/`tool`/`tool-result`/`plan`/`result`/`error`)
 *     are polled out of the goal item — always available, but only refreshed once
 *     per LLM round server-side.
 *
 * The view must not care which one it is looking at, so both are mapped HERE into
 * the same line shape and merged the same way. Keeping the mapping out of the
 * component is what makes it testable without a browser or an addon.
 *
 * A line:
 *   { key, ts, source: 'local'|'cloud', glyph, kind, text, detail, status }
 * where `status` drives the colour: running | ok | error | note | plain.
 */

/** Lines kept. A long run is thousands of events; nobody scrolls past a few hundred
 *  and every one of them re-renders. */
export const TERMINAL_MAX_LINES = 400;

/** Chars of a tool's arguments shown inline before it is cut. */
const ARGS_MAX = 120;
/** Chars of any other single-line text (a message, a result) before it is cut. */
const TEXT_MAX = 400;

/** O-O-G-P-A stages, as the console reads them. */
const STAGE_LABELS = {
  OBSERVING: 'observing',
  ORIENTING: 'orienting',
  SELECTING_GOAL: 'picking a goal',
  PLANNING: 'planning',
  ACTING: 'acting',
  REFLECTING: 'reflecting',
  IDLE: 'idle',
};

/** Glyphs per cloud step kind (mirrors GoalDetail's STEP_META vocabulary). */
const STEP_GLYPHS = {
  plan: '≡',
  thought: '·',
  tool: '▶',
  'tool-result': '✓',
  result: '◼',
  error: '✗',
};

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** `HH:MM:SS` for a timestamp, or the clock time for anything else. */
export function formatClock(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toTimeString().slice(0, 8);
}

/** Durations as a terminal reads them: ms under a second, s under a minute. */
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

/** A tool's arguments as one short parenthetical. Empty for no arguments, and
 *  for the PII tools the addon deliberately strips (`text_type`, `clipboard_write`,
 *  `audio_speak`) — the absence is the feature, so nothing is invented here. */
export function previewArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args);
  if (!entries.length) return '';
  const body = entries
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return clip(body, ARGS_MAX);
}

/**
 * One SSE event → one console line, or null for events the console ignores.
 *
 * @param {object} ev - A decoded `/api/agent/events` payload (`{seq, ts, type, …}`)
 */
export function eventToLine(ev) {
  if (!ev || typeof ev !== 'object' || !ev.type) return null;
  const base = {
    key: `${ev.seq ?? 'x'}-${ev.type}-${ev.ts ?? ''}`,
    ts: ev.ts || new Date().toISOString(),
    source: 'local',
    kind: ev.type,
    text: '',
    detail: '',
    status: 'plain',
  };

  switch (ev.type) {
    case 'tool.start':
      return { ...base, glyph: '▶', text: ev.tool || 'tool', detail: previewArgs(ev.args), status: 'running' };
    case 'tool.end':
      return {
        ...base,
        key: `${base.key}-${ev.callId || ''}`,
        glyph: ev.ok ? '✓' : '✗',
        text: `${ev.tool || 'tool'}${ev.ok ? '' : ' failed'}`,
        detail: [clip(ev.error, 160), formatDuration(ev.durationMs)].filter(Boolean).join(' · '),
        status: ev.ok ? 'ok' : 'error',
      };
    case 'agent.stage':
      return { ...base, glyph: '◆', text: `stage → ${STAGE_LABELS[ev.stage] || ev.stage || 'unknown'}`, detail: ev.loop ? `${ev.loop} loop` : '', status: 'note' };
    case 'agent.step':
      return { ...base, glyph: '·', text: `step ${ev.step ?? '?'}`, detail: ev.modelId || '', status: 'plain' };
    case 'agent.message':
      return { ...base, glyph: '»', text: `${ev.role || 'assistant'}: ${clip(ev.content, TEXT_MAX)}`, status: 'plain' };
    case 'agent.reply':
      return { ...base, glyph: '»', text: clip(ev.text, TEXT_MAX), detail: ev.steps != null ? `${ev.steps} steps` : '', status: 'ok' };
    case 'agent.meta':
      return { ...base, glyph: '◇', text: clip(ev.summary, TEXT_MAX), detail: 'self-review', status: 'note' };
    case 'agent.skill-draft':
      return { ...base, glyph: '✦', text: `drafted a skill: ${ev.title || ev.slug || ''}`, detail: 'needs consent', status: 'note' };
    case 'agent.stopped':
      return { ...base, glyph: '■', text: 'stopped', detail: clip(ev.reason, 160), status: 'error' };
    case 'goal.done':
      return { ...base, glyph: '◼', text: 'goal done', detail: clip(ev.result, 160), status: 'ok' };
    case 'goal.failed':
      return { ...base, glyph: '✗', text: 'goal failed', detail: clip(ev.reason, 160), status: 'error' };
    case 'goal.blocked':
      return { ...base, glyph: '⏸', text: 'goal blocked', detail: clip(ev.reason, 160), status: 'error' };
    case 'goal.stalled':
      return { ...base, glyph: '△', text: 'goal stalled', detail: clip(ev.reason, 160), status: 'error' };
    case 'approval.pending':
      return { ...base, glyph: '⏳', text: `needs approval: ${ev.toolName || ev.tool || 'unknown'}`, detail: previewArgs(ev.args), status: 'note' };
    case 'approval.resolved':
      return { ...base, glyph: '⏳', text: `${ev.approved ? 'approved' : 'denied'}: ${ev.toolName || ev.tool || 'unknown'}`, status: ev.approved ? 'ok' : 'error' };
    case 'permissions.changed':
      return { ...base, glyph: '⚿', text: 'permissions changed', detail: Array.isArray(ev.changedKeys) ? ev.changedKeys.join(', ') : '', status: 'note' };
    case 'skill.run':
      return { ...base, glyph: '✦', text: `skill ${ev.slug || ''}`, detail: ev.failed ? 'failed' : 'ok', status: ev.failed ? 'error' : 'ok' };
    default:
      // An event type this console doesn't know is still something that happened;
      // showing the bare type beats a silent gap in the log.
      return { ...base, glyph: '·', text: ev.type, status: 'plain' };
  }
}

/**
 * One cloud run step → one console line.
 *
 * @param {object} step - An entry of the goal's `agent.steps`
 * @param {string} [goalSlug] - Shown when the step is about a specific goal
 */
export function cloudStepToLine(step, goalSlug = '') {
  if (!step || typeof step !== 'object') return null;
  const kind = step.kind || 'tool';
  const tool = step.meta?.tool;
  const args = previewArgs(step.meta?.args);
  // Cloud `tool` steps say "Calling <tool>" in their text; the tool name and the
  // arguments are the useful part, so they lead instead of the sentence.
  const text = kind === 'tool' && tool
    ? `calling ${tool}`
    : clip(step.text, TEXT_MAX) || kind;
  return {
    key: `cloud-${step.ts || ''}-${kind}-${tool || ''}-${clip(step.text, 40)}`,
    ts: step.ts || new Date().toISOString(),
    source: 'cloud',
    glyph: STEP_GLYPHS[kind] || '·',
    kind: `cloud.${kind}`,
    text,
    detail: [args, goalSlug && kind === 'plan' ? goalSlug : ''].filter(Boolean).join(' · '),
    status: kind === 'error' ? 'error' : kind === 'result' || kind === 'tool-result' ? 'ok' : kind === 'tool' ? 'running' : 'plain',
  };
}

/**
 * Merge new lines into the console, newest last (a terminal reads downwards).
 * Duplicates are dropped by `key`, which matters for the cloud source: it is
 * polled, so every poll re-sends the whole step array.
 */
export function mergeLines(existing, incoming, max = TERMINAL_MAX_LINES) {
  const lines = Array.isArray(existing) ? existing : [];
  const additions = (Array.isArray(incoming) ? incoming : []).filter(Boolean);
  if (!additions.length) return lines;
  const seen = new Set(lines.map((l) => l.key));
  const fresh = additions.filter((l) => !seen.has(l.key));
  if (!fresh.length) return lines;
  return [...lines, ...fresh].slice(-max);
}
