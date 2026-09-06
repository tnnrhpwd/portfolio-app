/**
 * critic.js — the PDCA "Check" stage of the Observe → Orient → Goal → Plan →
 * Action loop (docs/implementation/OBSERVE-ORIENT-GOAL-PLAN-ACTION.md §9.1).
 *
 * - `score({ predicted, actual })` maps an outcome to a delta in [-1, 1]:
 *   all-ok → +0.5, partial failure → -0.5, total failure → -1, no-op → 0.
 * - `writeLesson(action, outcome, deps)` writes one idempotent `lesson`
 *   workspace item on failure (slug is hashed from the lesson pattern, so
 *   repeated failures overwrite rather than proliferate).
 * - `recall(situationText, lessons, topK)` ranks candidate lessons by token
 *   overlap with the situation block for the Orient stage.
 *
 * All functions are pure over injected deps — fully offline-testable.
 */

const crypto = require('crypto');

/**
 * Score an action's predicted-vs-actual outcome.
 * @param {object} opts - { predicted: string, actual: {ok,error}|Array<{ok,error}> }
 * @returns {number} -1..1
 */
function score({ predicted, actual }) {
    const items = Array.isArray(actual) ? actual : [actual];
    if (!items.length) return 0;                 // idle / no tool calls
    const errors = items.filter((o) => o?.error || o?.ok === false).length;
    if (errors === items.length) return -1;      // every tool failed
    if (errors > 0) return -0.5;                 // partial failure
    return 0.5;                                  // all tools ok → progress
}

/** Stable short hash of a lesson pattern (slug idempotency). */
function hashPattern(pattern) {
    return crypto.createHash('sha1').update(String(pattern || '')).digest('hex').slice(0, 10);
}

/**
 * Build the lesson object from a failing tick.
 * @param {object} action - the plan() action ({ expected, ... })
 * @param {object} outcome - the act() outcome ({ outcomes: [{name,args,out}] })
 * @param {object} opts - { goalSlug }
 */
function buildLesson(action, outcome, { goalSlug } = {}) {
    const outcomes = outcome?.outcomes || [];
    const failures = outcomes.filter((o) => o?.out?.error || o?.out?.ok === false);
    const toolNames = [...new Set(failures.map((o) => o.name).filter(Boolean))];
    const errors = [...new Set(failures.map((o) => o.out?.error).filter(Boolean))];
    const predicted = action?.expected || toolNames.join(', ') || 'no prediction';
    const pattern = `tool=${toolNames.join('+') || 'unknown'} failed: ${errors.join('; ') || 'unknown error'}`.slice(0, 160);
    return {
        pattern,
        context: `while pursuing goal "${goalSlug || 'unknown'}"`,
        do: 'retry with adjusted args, or ask the user via goal_ask_user',
        avoid: `repeating the exact same call: ${predicted}`,
        confidence: 0.8,
        sourceGoal: goalSlug || null,
    };
}

/**
 * Persist a lesson on a failing tick. Idempotent: the slug is a hash of the
 * pattern, so the same failure always overwrites the same lesson item.
 * @returns {Promise<string|null>} the lesson slug, or null when nothing written.
 */
async function writeLesson(action, outcome, { wsClient, goalSlug, log } = {}) {
    if (!wsClient || typeof wsClient.upsertLesson !== 'function') return null;
    const hasFailure = (outcome?.outcomes || []).some((o) => o?.out?.error || o?.out?.ok === false);
    if (!hasFailure) return null;
    const lesson = buildLesson(action, outcome, { goalSlug });
    const slug = `lesson-${hashPattern(lesson.pattern)}`;
    try {
        await wsClient.upsertLesson(slug, {
            name: lesson.pattern.slice(0, 80),
            content: JSON.stringify(lesson),
            tags: ['critic', `sourceGoal:${goalSlug || 'none'}`],
        });
        return slug;
    } catch (e) {
        log && log('[critic] lesson write failed:', e.message);
        return null;
    }
}

function _tokens(s) {
    return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
}

/**
 * Rank candidate lessons by token overlap with the situation text.
 * @returns {Array} up to `topK` lessons with score > 0, best first.
 */
function recall(situationText, lessons, topK = 3) {
    const sit = _tokens(situationText);
    const scored = (Array.isArray(lessons) ? lessons : []).map((l) => {
        const c = l?.content || l;
        const text = typeof c === 'string' ? c : [c?.pattern, c?.context, c?.do, c?.avoid].filter(Boolean).join(' ');
        const lt = _tokens(text);
        if (lt.size === 0) return { lesson: l, score: 0 };
        let hits = 0;
        for (const t of lt) if (sit.has(t)) hits++;
        return { lesson: l, score: hits / lt.size };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.lesson);
}

module.exports = { score, hashPattern, buildLesson, writeLesson, recall };
