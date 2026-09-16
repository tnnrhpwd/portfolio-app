/**
 * event-detail.js — what an automation EVENT is allowed to say out loud.
 *
 * The event bus (`events.js`) feeds the `/simple` live console, the tray UI, the
 * addon's own dashboard, and anything subscribed over SSE. Those are *reports*,
 * not the audit trail: the full record of a call already goes to the workspace
 * action log via `ctx.addAction` (see `tool-registry.js`), which is the store
 * that is supposed to hold the whole truth.
 *
 * So the rule for an event is the opposite of the rule for the log: say enough
 * that a person watching knows what happened, and nothing that was only ever
 * meant to pass through the machine.
 *
 * Two things get special handling:
 *
 *   • **PII tools** (`text_type`, `clipboard_write`, `audio_speak`) carry text
 *     the user typed, pasted, or had spoken to them. Their arguments and results
 *     are reported as ABSENT rather than redacted — a redaction still tells you
 *     how long the secret was, and a console has no use for it either way.
 *   • **Image-shaped values** (screen frames, camera snapshots, base64 payloads)
 *     are dropped by key name. They are the one kind of "result" that is both
 *     enormous and completely unreadable as text, and a 2 MB base64 blob in the
 *     event ring evicts everything a person was actually watching.
 *
 * The console's tooltip claims the addon strips these — this module is what makes
 * that claim true. `previewArgs` in `agentTerminalUtils.js` and `PII_TOOLS` in
 * `agent-loop.js` / `pattern-learner.js` are the counterparts it must stay in
 * step with.
 */

/** Tools whose arguments/results are human content. Reported as ABSENT. */
const PII_TOOL_NAMES = Object.freeze(['text_type', 'clipboard_write', 'audio_speak']);
/** The same list as a Set — callers test membership far more often than they iterate. */
const PII_TOOLS = new Set(PII_TOOL_NAMES);

/** Keys whose values are pictures, not text. Dropped wherever they appear.
 *  Deliberately narrow: `data`, `screen` and `bytes` are ordinary field names
 *  and dropping them would gut a useful preview — the size rule below is what
 *  catches a blob hiding under a name nobody predicted. */
const IMAGE_KEY_RE = /^(image|img|screenshot|snapshot|frame|jpeg|jpg|png|webp|base64|dataurl|data_?url|buffer|clip)$/i;

/** A string longer than this is a payload, not a detail. */
const BIG_STRING_MAX = 2048;

/** Longest a single string leaf may be in an event. */
const LEAF_MAX = 120;
/** Longest a whole arguments preview may be, once flattened. */
const ARGS_MAX = 400;
/** Longest a tool's result preview may be. */
const RESULT_MAX = 240;
/** How deep a value is walked before it is summarised as a type. */
const DEPTH_MAX = 3;

function isPiiTool(name) {
    return PII_TOOLS.has(String(name || ''));
}

/** One-line form of anything, for a terminal. Whitespace collapsed, then cut. */
function clip(text, max) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * A value reduced to what is safe AND readable in an event: strings cut, image
 * keys dropped, depth bounded, cycles and getters survived.
 *
 * @param {*} value
 * @param {number} [depth]
 */
function sanitizeValue(value, depth = 0) {
    if (value == null) return value;
    const t = typeof value;
    if (t === 'string') {
        if (value.length > BIG_STRING_MAX) return `[${value.length} char string]`;
        return value.length > LEAF_MAX ? `${value.slice(0, LEAF_MAX - 1)}…` : value;
    }
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'function' || t === 'symbol' || t === 'bigint') return `[${t}]`;
    if (depth >= DEPTH_MAX) {
        if (Array.isArray(value)) return `[${value.length} items]`;
        return '[object]';
    }
    if (Array.isArray(value)) {
        // Arrays are sampled: 40 screenshots and 40 window titles read the same
        // in a preview, and only one of them belongs in an event.
        const head = value.slice(0, 4).map((v) => sanitizeValue(v, depth + 1));
        return value.length > 4 ? [...head, `+${value.length - 4} more`] : head;
    }
    if (t === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (IMAGE_KEY_RE.test(k)) continue;
            out[k] = sanitizeValue(v, depth + 1);
        }
        return out;
    }
    return String(value);
}

/**
 * Arguments for a `tool.start` / `approval.pending` event.
 *
 * Returns a plain object (the console renders it as `key=value` pairs), and `{}`
 * for a PII tool — the caller should not need to know which tools those are.
 */
function eventArgs(tool, args) {
    if (isPiiTool(tool)) return {};
    if (!args || typeof args !== 'object') return {};
    const clean = sanitizeValue(args, 1);
    if (!clean || typeof clean !== 'object') return {};
    let text;
    try { text = JSON.stringify(clean); } catch { return {}; }
    return text.length > ARGS_MAX ? { truncated: clip(text, ARGS_MAX) } : clean;
}

/**
 * A one-line preview of a tool's RESULT, for a `tool.end` event.
 *
 * Empty string for a PII tool, for a missing result, and for a value with
 * nothing to say (an empty object). The caller appends it only when non-empty,
 * so "no preview" and "a preview that is empty" never look different.
 */
function previewResult(tool, result) {
    if (isPiiTool(tool) || result == null) return '';
    const clean = sanitizeValue(result, 1);
    let text;
    if (typeof clean === 'string') text = clean;
    else if (typeof clean === 'number' || typeof clean === 'boolean') text = String(clean);
    else {
        try { text = JSON.stringify(clean); } catch { return ''; }
    }
    if (!text || text === '{}' || text === '[]') return '';
    return clip(text, RESULT_MAX);
}

module.exports = {
    PII_TOOLS,
    PII_TOOL_NAMES,
    isPiiTool,
    eventArgs,
    previewResult,
    sanitizeValue,
    clip,
    // exported for tests
    LEAF_MAX,
    BIG_STRING_MAX,
    ARGS_MAX,
    RESULT_MAX,
    DEPTH_MAX,
};
