/**
 * bedrockPromptCache.js — put a `cachePoint` on the part of the request that
 * never changes, so it stops being re-billed on every round.
 *
 * G7 of NET_HARNESS_PLAN.md measured the problem: a /net tool turn sends the same
 * system prompt, the same user context and the same ~4,250 tokens of tool schemas
 * on EVERY round — up to 18 of them in a long repo turn. None of it is cached
 * because nothing ever told Bedrock where the stable prefix ends, so full input
 * price is paid 18 times for bytes that did not change once.
 *
 * Bedrock Converse supports this with `cachePoint` blocks:
 *
 *   system:     [{ text }, { cachePoint: { type: 'default' } }]
 *   toolConfig: { tools: [ …specs, { cachePoint: { type: 'default' } } ] }
 *
 * A cache READ costs 10% of input; a cache WRITE costs 125%. So a cache point on
 * a prefix that is used once is a small loss, and on one used 18 times it is
 * roughly an 8× cut in the dominant cost of the turn.
 *
 * Three guards, because a wrong cache point is a hard `ValidationException` on
 * the user's turn — not a degradation:
 *
 *   1. **A model allowlist.** Not every Bedrock model accepts a cache point.
 *   2. **A minimum size.** Below the model's minimum cacheable prefix (~2K
 *      tokens for the Claude models we use) a cache point creates nothing, so it
 *      is not worth sending at all.
 *   3. **A latch.** If a request is ever REJECTED because of a cache point, this
 *      module switches caching off for the rest of the process and says so in the
 *      log — and the caller retries the same request without it. One turn pays a
 *      doubled round trip; no turn fails, and no later turn repeats the mistake.
 *
 * `BEDROCK_PROMPT_CACHE=0` turns it off; `=1` forces it on regardless of the
 * allowlist (for trying a newly-enabled model without a deploy). Unset means
 * "on, for allowlisted models" — the guards above are what make that safe.
 */

const { estimateTokens } = require('./harness/contextBudget.js');
const { logger } = require('../utils/logger');

/**
 * Models known to accept a Converse `cachePoint`. Matched as a substring of the
 * Bedrock model id, which carries the family and version — e.g.
 * `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
 */
const CACHEABLE_MODEL_PATTERNS = [
    /claude-haiku-4/i,
    /claude-sonnet-4/i,
    /claude-opus-4/i,
    /claude-3-7-sonnet/i,
    /claude-3-5-(haiku|sonnet)/i,
];

/**
 * Smallest prefix worth a cache point, in estimated tokens. Claude's minimum
 * cacheable prefix is 2048 tokens for Haiku and 1024 for the larger models; 2048
 * satisfies both. Below it the point is silently ignored — harmless, but it also
 * means paying to send a block that does nothing.
 */
const MIN_CACHEABLE_TOKENS = 2048;

/**
 * Latched when Bedrock rejects a cache point. Cleared only by a restart: if the
 * model or region does not support caching today, it will not start mid-process,
 * and re-discovering that on every turn would double the latency of each one.
 */
let latchedOff = null; // null = never seen a rejection; otherwise the reason

/** Is prompt caching switched on at all? */
function promptCacheEnabled() {
    const raw = String(process.env.BEDROCK_PROMPT_CACHE ?? '').trim();
    if (raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off') return false;
    return true; // unset, '1', or anything else — the allowlist is the real guard
}

/** Does this model id accept a cache point? `=1` in the env overrides the list. */
function modelSupportsPromptCache(modelId) {
    const raw = String(process.env.BEDROCK_PROMPT_CACHE ?? '').trim();
    if (raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on') return true;
    return CACHEABLE_MODEL_PATTERNS.some((re) => re.test(modelId || ''));
}

/** True when a rejection was caused by the cache point rather than anything else. */
function isCacheRejection(error) {
    const text = `${error?.name || ''} ${error?.message || ''}`;
    return /cachepoint|cache point/i.test(text);
}

/**
 * Decide whether to add cache points to this request, and expose both the cached
 * and the plain form of the same request so the caller can retry the plain one.
 *
 * @param {object} args
 * @param {string} args.modelId
 * @param {string} [args.systemText]
 * @param {object} [args.toolConfig]  Bedrock toolConfig (`{ tools: [...] }`)
 * @returns {{applied: boolean, reason: string, system: Array|undefined,
 *            toolConfig: object|undefined, plain: {system: Array|undefined, toolConfig: object|undefined}}}
 */
function planPromptCache({ modelId, systemText, toolConfig }) {
    const plain = {
        system: systemText ? [{ text: systemText }] : undefined,
        toolConfig,
    };

    const decline = (reason) => ({ applied: false, reason, ...plain, plain });

    if (!promptCacheEnabled()) return decline('disabled by BEDROCK_PROMPT_CACHE');
    if (latchedOff) return decline(`latched off after a rejection: ${latchedOff}`);
    if (!modelSupportsPromptCache(modelId)) return decline(`model not on the cache allowlist`);

    // What is actually being cached: the system prompt plus every tool schema.
    const prefixTokens = estimateTokens(systemText || '')
        + estimateTokens(JSON.stringify(toolConfig?.tools || []));
    if (prefixTokens < MIN_CACHEABLE_TOKENS) {
        return decline(`prefix is ~${prefixTokens} tokens, below the ~${MIN_CACHEABLE_TOKENS} minimum`);
    }

    // The system block is optional in the request, so only mark it when present —
    // a cache point with no text before it caches nothing.
    const system = systemText
        ? [{ text: systemText }, { cachePoint: { type: 'default' } }]
        : undefined;

    // A cache point must come AFTER the specs it covers, so it is appended — and
    // only when there are specs to cover.
    const hasTools = Array.isArray(toolConfig?.tools) && toolConfig.tools.length > 0;
    const cachedToolConfig = hasTools
        ? { ...toolConfig, tools: [...toolConfig.tools, { cachePoint: { type: 'default' } }] }
        : toolConfig;

    return {
        applied: true,
        reason: `caching a ~${prefixTokens}-token prefix`,
        system,
        toolConfig: cachedToolConfig,
        plain,
    };
}

/**
 * Latch caching off for the process after a rejection. Deliberately loud: this
 * line is the only signal that the cost saving is not happening.
 */
function disablePromptCache(error, modelId) {
    latchedOff = error?.message || 'ValidationException';
    logger.warn(
        `🪨 Prompt caching REJECTED by Bedrock for ${modelId} — disabling it for this process `
        + `(set BEDROCK_PROMPT_CACHE=0 to silence, or fix the model allowlist): ${latchedOff}`,
    );
}

/** Test seam: forget a latch and any override. */
function _resetForTests() {
    latchedOff = null;
}

module.exports = {
    planPromptCache,
    disablePromptCache,
    isCacheRejection,
    promptCacheEnabled,
    modelSupportsPromptCache,
    CACHEABLE_MODEL_PATTERNS,
    MIN_CACHEABLE_TOKENS,
    _resetForTests,
    _latchedReason: () => latchedOff,
};
