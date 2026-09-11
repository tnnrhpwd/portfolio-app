'use strict';

/**
 * routing-classifier.js — the addon's action-vs-chat decision, split into
 * pure, testable pieces.
 *
 * Flow (see `classifyActionable` in index.js):
 *   1. `analyzeLexicon(text)` — cheap, offline, no model. Confident answers
 *      (clearly action / clearly chat) short-circuit here — NO LLM call.
 *   2. Only the genuinely *ambiguous* middle asks the LLM, which must reply
 *      with a strict JSON verdict:
 *          { "actionable": true|false, "confidence": 0..1, "reply": "..." }
 *      (`reply` is the conversational answer for non-actionable messages, so
 *      the frontend never needs a second LLM call to answer the user.)
 *   3. `decideClassification()` folds the two signals into one result that
 *      also carries a confidence the frontend can use to disambiguate.
 *
 * This replaces the old, brittle "reply with exactly the single word ACT"
 * sentinel — which mis-routed anything starting with "Act…" and truncated
 * real chat replies at 300 chars.
 */

const { analyzeLexicon, normalizeMessage } = require('./routing-lexicon');

/** Below this confidence an *actionable* verdict is treated as a guess. */
const CONFIDENCE_FLOOR = 0.5;

/** How long a cached verdict stays valid. */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX = 200;

const CLASSIFIER_SYSTEM_PROMPT = [
    'You are the routing layer of a Windows automation assistant.',
    'Decide whether the user wants you to DO something on their computer',
    '(list/count/open/create/read/write files, run apps or commands, control windows,',
    'type, click, browse) — or whether they are just chatting / asking a question.',
    'Reply with ONLY a JSON object, no prose and no code fences:',
    '{"actionable": true|false, "confidence": 0.0-1.0, "reply": "<text>"}',
    'Set "actionable": true for computer actions. For anything else set it false and',
    'put a short, helpful conversational answer in "reply". Always include "reply".',
].join(' ');

const clampConfidence = (n, fallback = 0.5) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(1, Math.max(0, v));
};

/**
 * Pull the first balanced JSON object out of a raw model reply and coerce it
 * to the verdict shape. Tolerates code fences and surrounding prose.
 *
 * Also accepts the legacy single-word `ACT` sentinel so a stale client/agent
 * pairing keeps working.
 *
 * @param {string} raw
 * @param {{maxReply?: number}} [opts]
 * @returns {{valid: boolean, actionable: boolean|null, confidence: number, reply: string|null}}
 */
function parseClassifierVerdict(raw, opts = {}) {
    const maxReply = opts.maxReply || 2000;
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { valid: false, actionable: null, confidence: 0, reply: null };

    // Legacy sentinel support.
    if (/^ACT\b/i.test(text)) {
        return { valid: true, actionable: true, confidence: 0.6, reply: null };
    }

    // Strip ```json ... ``` fences.
    const unfenced = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();

    const json = extractFirstJsonObject(unfenced);
    if (!json) {
        // Not JSON — treat the whole thing as a conversational reply.
        return { valid: false, actionable: null, confidence: 0, reply: truncate(text, maxReply) };
    }

    if (typeof json.actionable !== 'boolean') {
        return { valid: false, actionable: null, confidence: 0, reply: truncate(json.reply, maxReply) };
    }

    return {
        valid: true,
        actionable: json.actionable,
        confidence: clampConfidence(json.confidence, json.actionable ? 0.7 : 0.75),
        reply: typeof json.reply === 'string' && json.reply.length
            ? truncate(json.reply, maxReply)
            : null,
    };
}

/** Find and parse the first balanced `{...}` block (string-aware). */
function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); }
                catch { return null; }
            }
        }
    }
    return null;
}

function truncate(s, max) {
    if (typeof s !== 'string') return null;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Fold the lexicon heuristic and the (optional) LLM verdict into the single
 * decision object returned to callers.
 *
 * @param {object} args
 * @param {ReturnType<typeof analyzeLexicon>} args.heuristic
 * @param {ReturnType<typeof parseClassifierVerdict>|null} [args.llmVerdict]
 * @returns {{actionable: boolean, confidence: number, source: string, chatReply: string|null}}
 */
function decideClassification({ heuristic, llmVerdict = null }) {
    if (llmVerdict && llmVerdict.valid) {
        return {
            actionable: llmVerdict.actionable === true,
            confidence: llmVerdict.confidence,
            source: 'llm',
            chatReply: llmVerdict.actionable === true ? null : (llmVerdict.reply || null),
        };
    }

    // LLM unavailable / unusable — fall back to the heuristic, but flag the
    // reduced confidence so the caller can decide whether to act or ask.
    const actionable = heuristic.verdict === 'action';
    return {
        actionable,
        confidence: Math.max(0.2, heuristic.confidence * 0.6),
        source: 'heuristic-fallback',
        chatReply: llmVerdict && llmVerdict.reply ? llmVerdict.reply : null,
    };
}

/**
 * Small TTL + size-bounded cache so a repeated message (common in chatty
 * back-and-forth) never re-runs the classifier.
 */
function createVerdictCache({ ttlMs = DEFAULT_CACHE_TTL_MS, max = DEFAULT_CACHE_MAX } = {}) {
    const store = new Map();
    return {
        get(text) {
            const key = normalizeMessage(text);
            const hit = store.get(key);
            if (!hit) return null;
            if (Date.now() - hit.at > ttlMs) { store.delete(key); return null; }
            // refresh recency
            store.delete(key);
            store.set(key, hit);
            return hit.value;
        },
        set(text, value) {
            const key = normalizeMessage(text);
            store.delete(key);
            store.set(key, { at: Date.now(), value });
            while (store.size > max) store.delete(store.keys().next().value);
            return value;
        },
        clear() { store.clear(); },
        get size() { return store.size; },
    };
}

module.exports = {
    CONFIDENCE_FLOOR,
    CLASSIFIER_SYSTEM_PROMPT,
    parseClassifierVerdict,
    decideClassification,
    createVerdictCache,
    extractFirstJsonObject,
};
