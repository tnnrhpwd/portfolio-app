'use strict';

/**
 * routing-lexicon.js — the single source of truth for the addon's
 * "is this an action for the agent, or just chat?" heuristic.
 *
 * Why this module exists
 * ----------------------
 * The action/chat decision used to live as two inline regexes inside
 * `automation/index.js` (`ACTION_HINT_RE` / `CHAT_HINT_RE`) with a flat
 * `.test()` and no notion of how strong the signal was. That made the
 * classifier:
 *   - untestable in isolation (only reachable through the whole endpoint),
 *   - impossible to weight (a stray "check" counted the same as "open"),
 *   - and English-ASCII only (`\b` doesn't understand accented letters).
 *
 * This module keeps the decision *pure and data-driven* so it can be unit
 * tested, tuned, and — critically — reused by the LLM fallback (which only
 * needs to run for the genuinely ambiguous middle, see routing-classifier.js).
 *
 * NOTE: this is the authoritative lexicon for the addon. The frontend router
 * (`frontend/src/utils/simpleAddon/messageRouter.js`) deliberately does NOT
 * duplicate these word lists — it only decides *which layer* to send a message
 * to, then the addon classifies it. That keeps one source of truth.
 */

/** Verbs that usually mean "do something on this machine". */
const ACTION_VERBS = [
    'open', 'close', 'click', 'double-click', 'right-click', 'press', 'type', 'enter',
    'hold', 'release', 'run', 'launch', 'start', 'stop', 'minimize', 'maximize',
    'focus', 'switch', 'kill', 'shutdown', 'restart', 'reboot', 'move', 'resize',
    'copy', 'paste', 'cut', 'scroll', 'drag', 'drop',
    'screenshot', 'screengrab', 'list', 'count', 'show', 'check', 'create', 'delete',
    'remove', 'rename', 'organize', 'organise', 'sort', 'download', 'upload', 'convert',
    'save', 'find', 'search', 'watch', 'record', 'navigate', 'browse', 'set', 'change',
    'enable', 'disable', 'install', 'uninstall', 'update', 'upgrade', 'build', 'compile',
    'execute', 'toggle', 'refresh', 'reload', 'fill', 'submit', 'log', 'log in', 'sign in',
];

/** Markers that usually mean "answer a question / have a conversation". */
const CHAT_MARKERS = [
    'what', 'who', 'where', 'when', 'why', 'how', 'explain', 'tell me', 'define',
    'summarize', 'summarise', 'describe', 'compare', 'meaning', 'recommend', 'suggest',
    'advice', 'opinion', 'story', 'joke', 'poem', 'translate', 'help me understand',
    'what do you think', 'in your opinion', 'eli5',
];

/**
 * Polite/auxiliary preambles we strip before checking whether the *first real
 * word* is an imperative verb ("can you open notepad" → imperative "open").
 * These must NOT by themselves push a message toward "chat" — "can you explain"
 * is chat because "explain" is a chat marker, not because of "can you".
 */
const PREAMBLE_RE = /^(?:please\s+|could you\s+|can you\s+|would you\s+|will you\s+|i(?:'d| would) like you to\s+|i want you to\s+|go ahead and\s+|just\s+)+/i;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a whole-word regex that understands Unicode letters (so `\b`'s
 * ASCII-only limits don't cause "café" style mismatches). Lookarounds are
 * used instead of `\b`.
 */
function buildWordRegex(words) {
    const alt = words
        .slice()
        .sort((a, b) => b.length - a.length) // prefer longer phrases ("log in" before "log")
        .map(escapeRegExp)
        .join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alt})(?![\\p{L}\\p{N}_])`, 'iu');
}

const ACTION_HINT_RE = buildWordRegex(ACTION_VERBS);
const CHAT_HINT_RE = buildWordRegex(CHAT_MARKERS);

// Per-word regexes compiled once at load — avoids rebuilding ~70 regexes on
// every classify call.
const ACTION_WORD_RES = ACTION_VERBS.map((w) => buildWordRegex([w]));
const CHAT_WORD_RES = CHAT_MARKERS.map((w) => buildWordRegex([w]));

/** Count how many *distinct* lexicon entries appear in the text. */
function countDistinct(text, wordRes) {
    let n = 0;
    for (const re of wordRes) {
        if (re.test(text)) n++;
    }
    return n;
}

/** True when the message opens with an imperative action verb. */
function startsWithActionVerb(text) {
    const stripped = String(text || '').replace(PREAMBLE_RE, '');
    return ACTION_HINT_RE.test(stripped.split(/\s+/)[0] || '');
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Pure heuristic analysis. Never calls a model.
 *
 * @param {string} text
 * @returns {{
 *   actionHits: number, chatHits: number, isQuestion: boolean,
 *   imperativeStart: boolean, actionScore: number, chatScore: number,
 *   verdict: 'action'|'chat'|'ambiguous', confidence: number
 * }}
 */
function analyzeLexicon(text) {
    const trimmed = String(text == null ? '' : text).trim();
    if (!trimmed) {
        return {
            actionHits: 0, chatHits: 0, isQuestion: false, imperativeStart: false,
            actionScore: 0, chatScore: 0, verdict: 'ambiguous', confidence: 0,
        };
    }

    const actionHits = countDistinct(trimmed, ACTION_WORD_RES);
    const chatHits = countDistinct(trimmed, CHAT_WORD_RES);
    const isQuestion = /\?\s*$/.test(trimmed);
    const imperativeStart = startsWithActionVerb(trimmed);

    const actionScore = actionHits + (imperativeStart ? 2 : 0);
    const chatScore = chatHits + (isQuestion ? 1 : 0);

    let verdict = 'ambiguous';
    if (actionScore > 0 && chatScore === 0) verdict = 'action';
    else if (chatScore > 0 && actionScore === 0) verdict = 'chat';

    let confidence;
    if (verdict === 'action') {
        confidence = clamp(0.55 + 0.12 * (actionScore - 1) + (imperativeStart ? 0.15 : 0), 0.55, 0.97);
    } else if (verdict === 'chat') {
        confidence = clamp(0.55 + 0.12 * (chatScore - 1), 0.55, 0.97);
    } else {
        // Ambiguous: the closer the two scores, the less we know.
        confidence = clamp(0.5 - 0.1 * Math.abs(actionScore - chatScore), 0.1, 0.5);
    }

    return { actionHits, chatHits, isQuestion, imperativeStart, actionScore, chatScore, verdict, confidence };
}

/**
 * Normalize a message into a stable cache key (case/whitespace-insensitive).
 */
function normalizeMessage(text) {
    return String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = {
    ACTION_VERBS,
    CHAT_MARKERS,
    ACTION_HINT_RE,
    CHAT_HINT_RE,
    PREAMBLE_RE,
    buildWordRegex,
    analyzeLexicon,
    normalizeMessage,
};
