'use strict';

/**
 * §7.1 LLM provider seam.
 *
 * Every automation call site that talks to an LLM (agent-loop.js,
 * nl-compiler.js, tools/skill.js, and historically vision-fusion.js /
 * tools/webcam.js) used to `require('../github-models-service')` and
 * `new GitHubModelsService()` directly, hardcoding one specific cloud
 * provider into each caller. This module centralizes that instantiation
 * behind a single factory (`createLlmProvider`) so:
 *   - a local/offline adapter can be swapped in without touching callers
 *     (`createLlmProvider({ mode: 'local-stub' })`),
 *   - retry/backoff policy for transient network failures lives in one
 *     place instead of being reimplemented (or omitted) per caller,
 *   - future providers (self-hosted, other clouds) only need to be wired
 *     into this one module.
 *
 * IMPORTANT — no API change: `createLlmProvider()` returns the SAME shape
 * every caller already depended on (`.setToken(token)`, `.chat(opts)`,
 * `.chatWithImage(opts)`), plus additive `providerName`/`capabilities`/
 * `chatMultimodal` fields. This is a pure instantiation-seam refactor.
 * Existing `require.cache`-based test doubles (see `vision-fusion.test.js`)
 * keep working unmodified because `github-models-service.js` is still
 * `require()`'d lazily, at call time — same absolute module path, same
 * `require.cache` entry, regardless of which file does the requiring.
 */

const CAPABILITIES = Object.freeze({
    'github-models': Object.freeze({ chat: true, chatMultimodal: true, tools: true, local: false }),
    'local-stub': Object.freeze({ chat: true, chatMultimodal: false, tools: false, local: true }),
});

/**
 * Minimal deterministic offline adapter. Never makes a network call — useful
 * for local development without a configured token, and for tests that want
 * a real (not hand-rolled) provider instance without depending on GitHub
 * Models. Deliberately NOT wired in as an automatic fallback for production
 * callers (that would be a silent behavior change): callers opt in
 * explicitly via `createLlmProvider({ mode: 'local-stub' })`.
 */
function createLocalStubProvider() {
    return {
        providerName: 'local-stub',
        capabilities: CAPABILITIES['local-stub'],
        setToken() { /* no-op: local stub needs no token */ },
        async chat({ message, systemPrompt } = {}) {
            return {
                text: `[local-stub] no cloud LLM configured — echoing input.\n${systemPrompt ? `system: ${systemPrompt}\n` : ''}${message || ''}`,
                generationTime: '0ms',
                toolCalls: null,
            };
        },
        async chatMultimodal({ prompt } = {}) {
            return { text: `[local-stub] cannot analyze images offline. prompt was: ${prompt || ''}`, generationTime: '0ms' };
        },
        // Alias so callers written against the older `chatWithImage` name
        // (vision-fusion.js et al) work against the stub too.
        async chatWithImage(opts) { return this.chatMultimodal(opts); },
    };
}

/** Attach provider-interface metadata to a raw GitHubModelsService instance without changing its existing method behavior. */
function _wrapGithubModels(client) {
    if (client.providerName) return client; // already wrapped
    try {
        Object.defineProperties(client, {
            providerName: { value: 'github-models', enumerable: false, writable: true, configurable: true },
            capabilities: { value: CAPABILITIES['github-models'], enumerable: false, writable: true, configurable: true },
            chatMultimodal: { value: (opts) => client.chatWithImage(opts), enumerable: false, writable: true, configurable: true },
        });
    } catch { /* defineProperty can fail on frozen/hand-rolled test doubles; degrade silently — chat()/chatWithImage() still work. */ }
    return client;
}

/** Only retry on transient/network-shaped failures — never on auth/config errors (retrying "token not configured" just delays the real error the user needs to see). */
function _defaultIsRetryable(err) {
    const msg = String((err && err.message) || err || '');
    if (/token not configured|not configured|401|403|invalid.*token/i.test(msg)) return false;
    return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|aborted/i.test(msg);
}

/** Wrap an async fn with bounded retry + linear backoff. Exported standalone so any provider-boundary caller can reuse the same policy. */
function withRetries(fn, { retries = 0, backoffMs = 300, isRetryable = _defaultIsRetryable } = {}) {
    return async function retried(...args) {
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                return await fn(...args);
            } catch (err) {
                attempt++;
                if (attempt > retries || !isRetryable(err)) throw err;
                await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
            }
        }
    };
}

/**
 * Create (or pass through an injected) LLM provider.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.llmClient] - already-instantiated client (tests / explicit wiring). Passed through unchanged — takes priority over `mode`.
 * @param {'github-models'|'local-stub'} [opts.mode='github-models'] - which adapter to construct when no `llmClient` is injected.
 * @param {number} [opts.retries=0] - when > 0, wraps `chat`/`chatWithImage`/`chatMultimodal` with bounded retry on transient network errors. Default 0 preserves prior (no-retry) behavior exactly.
 * @param {number} [opts.backoffMs=300] - linear backoff base for retries.
 */
function createLlmProvider(opts = {}) {
    const { llmClient, mode = 'github-models', retries = 0, backoffMs = 300 } = opts;

    let client;
    if (llmClient) {
        client = llmClient;
    } else if (mode === 'local-stub') {
        client = createLocalStubProvider();
    } else {
        // Lazy require (not module-scope) so require.cache-based test doubles set
        // up by callers BEFORE their first LLM call still get picked up, exactly
        // like the original per-file `require('../github-models-service')` calls did.
        const { GitHubModelsService } = require('../github-models-service');
        client = _wrapGithubModels(new GitHubModelsService());
    }

    if (retries > 0) {
        for (const method of ['chat', 'chatWithImage', 'chatMultimodal']) {
            if (typeof client[method] === 'function') {
                const original = client[method].bind(client);
                client[method] = withRetries(original, { retries, backoffMs });
            }
        }
    }

    return client;
}

module.exports = { createLlmProvider, createLocalStubProvider, withRetries, CAPABILITIES };
