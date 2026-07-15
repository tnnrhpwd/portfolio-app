/**
 * generalize.js — LLM re-derivation of a compiled (literal) skill into a more
 * robust, abstracted step sequence.
 *
 * Implements docs/new/csimple-agent-prompt.md §5.1 "LLM re-derivation": the
 * priority-one fix for the compiler's biggest known weakness (literal event
 * coalescing only — see recorder/compiler.js header comment).
 *
 * Input: a skill object as produced by `compileRecording()` — literal
 * `{ tool, args }` steps (raw click_at coordinates, window_focus, input_tap
 * key-by-key, mouse_path, ...).
 *
 * Output: a NEW skill object whose `steps` use the SAME abstracted step
 * schema as nl-compiler.js (`{ type, ... }` — click_visual, uia_invoke,
 * type_text, etc.), reusing nl-compiler's `validateSteps()` so the result is
 * accepted by the executor exactly like an NL-compiled skill
 * (`tools/skill.js` `_normaliseStep` already maps NL-compiler `type` fields
 * to tool registry calls).
 *
 * Generalization is a best-effort refinement, never a hard requirement:
 * if no LLM is available or the LLM output fails validation, the original
 * literal-step skill is returned unchanged with `metadata.generalizeError`
 * set — a user can always save/run the raw recording.
 *
 * Parameter inference (§5.2) and vision-based re-targeting at replay time
 * (§5.3) are separate, later steps in the roadmap and are NOT implemented
 * here.
 */

const crypto = require('crypto');
const { validateSteps, STEP_SCHEMA_DOCS, _callLlm } = require('../nl-compiler');

const MAX_CACHE = 100;
const CACHE_TTL_MS = 3_600_000; // 1 hour, matches nl-compiler's cache lifetime

const _cache = new Map(); // hash → { steps, cachedAt }

function _hashSkill(skill, goalDescription) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(skill.steps || []) + '|' + (goalDescription || ''))
        .digest('hex')
        .slice(0, 16);
}

function _cacheGet(hash) {
    const entry = _cache.get(hash);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) { _cache.delete(hash); return null; }
    return entry;
}

function _cacheSet(hash, steps) {
    if (_cache.size >= MAX_CACHE) {
        const oldest = _cache.keys().next().value;
        _cache.delete(oldest);
    }
    _cache.set(hash, { steps, cachedAt: Date.now() });
}

function clearCache() { _cache.clear(); }

/**
 * Strip internal `_trace` bookkeeping and shrink oversized arg values so the
 * literal trace fed to the LLM stays small and doesn't leak more than it
 * needs to (mouse paths collapse to a point count; long strings are capped).
 */
function _redactArgs(args) {
    if (!args || typeof args !== 'object') return args;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        if (k === 'path' && Array.isArray(v)) { out[k] = `[${v.length} point path]`; continue; }
        if (typeof v === 'string' && v.length > 200) { out[k] = v.slice(0, 200) + '\u2026'; continue; }
        out[k] = v;
    }
    return out;
}

function _summarizeLiteralSteps(steps) {
    return (steps || [])
        .filter(s => s && s.tool !== '_marker')
        .map(s => ({ tool: s.tool, args: _redactArgs(s.args) }));
}

const GENERALIZE_SYSTEM_PROMPT = 'You are rewriting a raw recorded Windows PC automation trace into a ' +
    'robust, reusable macro. Output only valid JSON.';

function _buildPrompt(literalSteps, goalDescription) {
    return [
        'The JSON array below is a LITERAL recording of one demonstration: raw',
        'screen coordinates, window titles, and individual keypresses captured',
        'while a user performed a task once.',
        '',
        'Rewrite it as a JSON object with one key "steps" using the step schema',
        'below. Prefer stable, UI-level steps (uia_invoke, click_visual) over raw',
        'click_at coordinates whenever the recorded window/element context makes',
        'the target identifiable. Consolidate runs of individual key taps into a',
        'single type_text step when the evident intent was typing text. Do not',
        'invent steps that are not implied by the trace, and preserve the',
        'original order and overall intent — this is a re-derivation, not a new',
        'macro.',
        '',
        STEP_SCHEMA_DOCS,
        '',
        goalDescription ? `User-stated goal for this recording: ${goalDescription}` : '',
        '',
        'Literal recorded trace (tool/args pairs, in order):',
        JSON.stringify(literalSteps, null, 2),
        '',
        'Reply with ONLY valid JSON. No prose. No markdown.',
    ].filter(Boolean).join('\n');
}

function _extractJson(text) {
    const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
    if (!match) throw new Error('No JSON object found in LLM response');
    return JSON.parse(match[0]);
}

function _withMetadata(skill, patch) {
    return { ...skill, metadata: { ...skill.metadata, ...patch } };
}

/**
 * Re-derive a compiled (literal) skill into a more robust abstracted form.
 *
 * @param {object} skill - output of compileRecording()
 * @param {object} opts
 *   @param {string}  [opts.goalDescription] - short user-provided goal text
 *   @param {object}  [opts.llmClient]       - injectable LLM client (tests)
 *   @param {string}  [opts.inlineToken]     - GitHub Models token override
 *   @param {boolean} [opts.noCache]         - skip cache lookup
 * @returns {Promise<object>} a new skill object (never mutates the input)
 */
async function generalizeSkill(skill, { goalDescription, llmClient, inlineToken, noCache } = {}) {
    if (!skill || !Array.isArray(skill.steps)) {
        throw new Error('generalizeSkill: invalid skill (expected .steps array)');
    }

    const literalSteps = _summarizeLiteralSteps(skill.steps);
    if (literalSteps.length === 0) {
        return _withMetadata(skill, { generalized: false, generalizeError: 'no steps to generalize' });
    }

    const hash = _hashSkill(skill, goalDescription);
    if (!noCache) {
        const cached = _cacheGet(hash);
        if (cached) {
            return {
                ...skill,
                steps: cached.steps,
                metadata: {
                    ...skill.metadata,
                    generalized: true,
                    generalizerVersion: 1,
                    goalDescription: goalDescription || null,
                    literalStepCount: skill.steps.length,
                    fromCache: true,
                },
            };
        }
    }

    let steps;
    try {
        const prompt = _buildPrompt(literalSteps, goalDescription);
        const raw = await _callLlm(prompt, llmClient, inlineToken, GENERALIZE_SYSTEM_PROMPT);
        const parsed = _extractJson(raw);
        steps = parsed.steps || parsed;
        if (!Array.isArray(steps)) throw new Error('LLM did not return a steps array');
        validateSteps(steps);
    } catch (e) {
        // Best-effort: a failed re-derivation must never block saving/running
        // the original literal recording.
        return _withMetadata(skill, { generalized: false, generalizeError: e.message });
    }

    _cacheSet(hash, steps);

    return {
        ...skill,
        steps,
        metadata: {
            ...skill.metadata,
            generalized: true,
            generalizerVersion: 1,
            goalDescription: goalDescription || null,
            literalStepCount: skill.steps.length,
            fromCache: false,
        },
    };
}

module.exports = { generalizeSkill, clearCache, _summarizeLiteralSteps, _redactArgs };
