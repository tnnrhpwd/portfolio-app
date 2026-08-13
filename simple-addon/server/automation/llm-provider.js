'use strict';

/**
 * §7.1 LLM provider seam.
 *
 * Every automation call site that talks to an LLM (agent-loop.js,
 * nl-compiler.js, tools/skill.js, tools/webcam.js, vision-fusion.js) used to
 * `require('../github-models-service')` and call the GitHub Models inference
 * API (https://models.github.ai) DIRECTLY from the desktop addon, using a
 * per-user GitHub PAT. GitHub Models was permanently retired on 2026-07-30,
 * AND per-user PATs were never the right shape for the addon's LLM calls in
 * the first place: real usage runs through AWS Bedrock (Claude Haiku 4.5),
 * authenticated with the app operator's AWS IAM credentials — credentials
 * that must NEVER be embedded in or reachable from a distributed desktop
 * addon (any user could extract them and access/bill the operator's entire
 * AWS account). So the addon must ALWAYS proxy LLM calls through the
 * portfolio backend's HTTP API, authenticated with the user's own JWT
 * (the same cloud-relay token every other workspace-client.js call uses) —
 * never call an LLM provider directly.
 *
 * This module centralizes that behind a single factory (`createLlmProvider`)
 * so:
 *   - a local/offline adapter can be swapped in without touching callers
 *     (`createLlmProvider({ mode: 'local-stub' })`),
 *   - retry/backoff policy for transient network failures lives in one
 *     place instead of being reimplemented (or omitted) per caller,
 *   - the backend-proxy HTTP plumbing lives in exactly one place
 *     (workspace-client.js's agentChat/agentVision), not duplicated per
 *     caller.
 *
 * IMPORTANT — no API change for callers: `createLlmProvider()` still returns
 * the same shape every caller already depends on (`.setToken(token)`,
 * `.chat(opts)`, `.chatWithImage(opts)`, `.chatMultimodal(opts)`). Only the
 * default adapter changed — from a direct GitHub Models client to a
 * backend-proxy client. `.setToken(token)` is now a no-op / explicit-override
 * hook: the real auth token is normally pulled automatically from
 * workspace-client's already-wired cloud-relay token getter, exactly like
 * every other backend call the addon makes.
 */

const wsClient = require('./workspace-client');

const CAPABILITIES = Object.freeze({
    'backend-proxy': Object.freeze({ chat: true, chatMultimodal: true, tools: true, local: false }),
    'local-stub': Object.freeze({ chat: true, chatMultimodal: false, tools: false, local: true }),
});

/**
 * Minimal deterministic offline adapter. Never makes a network call — useful
 * for local development without a signed-in session, and for tests that want
 * a real (not hand-rolled) provider instance without depending on the
 * backend. Deliberately NOT wired in as an automatic fallback for production
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
        async chatRaw({ messages } = {}) {
            const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
            return { text: `[local-stub] echoing last message.\n${typeof last?.content === 'string' ? last.content : ''}`, toolCalls: null };
        },
    };
}

/**
 * Default production adapter — proxies every call through the portfolio
 * backend's `/api/data/csimple/agent-chat` and `/api/data/csimple/agent-vision`
 * routes (see workspace-client.js), which run on the backend and (per the
 * companion backend migration) talk to AWS Bedrock server-side. The addon
 * never sees, stores, or transmits any AWS credential.
 *
 * Auth: normally sourced automatically from workspace-client's cloud-relay
 * token getter (wired once in automation/index.js's mountAutomation()).
 * `setToken()` is kept for explicit override (tests, or a caller that has a
 * fresher token handy) but is NOT required for normal operation.
 */
function createBackendProxyProvider() {
    let explicitToken = null;

    return {
        providerName: 'backend-proxy',
        capabilities: CAPABILITIES['backend-proxy'],

        // Kept for interface compatibility with every existing call site
        // (`llmClient.setToken(...)`). No longer required for normal
        // operation — the backend call authenticates with the user's JWT,
        // resolved automatically via workspace-client.getToken(). An
        // explicit call here simply overrides that resolution (e.g. tests).
        setToken(token) { explicitToken = token || null; },

        async chat({ message, modelId, systemPrompt = '', temperature = 0.7, maxLength = 500, conversationHistory = [], tools, tool_choice } = {}) {
            const startTime = Date.now();
            const messages = [];
            for (const msg of conversationHistory) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
            messages.push({ role: 'user', content: message });

            const json = await wsClient.agentChat({
                messages,
                systemPrompt,
                tools,
                tool_choice,
                temperature,
                maxTokens: maxLength,
                model: modelId,
                ...(explicitToken ? { token: explicitToken } : {}),
            });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            return {
                text: json?.text || (json?.toolCalls ? '' : '(no response)'),
                generationTime: `${elapsed}s`,
                toolCalls: json?.toolCalls || null,
                message: json?.message,
                usage: json?.usage || null,
            };
        },

        async chatMultimodal({ prompt, imageBase64, mimeType = 'image/jpeg', modelId, temperature = 0.1, maxLength = 300 } = {}) {
            const startTime = Date.now();
            const json = await wsClient.agentVision({
                prompt,
                imageBase64,
                mimeType,
                temperature,
                maxTokens: maxLength,
                model: modelId,
                ...(explicitToken ? { token: explicitToken } : {}),
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            return { text: json?.text || '(no response)', generationTime: `${elapsed}s` };
        },

        // Alias so callers written against the older `chatWithImage` name
        // (vision-fusion.js et al) keep working unmodified.
        async chatWithImage(opts) { return this.chatMultimodal(opts); },

        /**
         * Send a raw, already-assembled messages array (used for tool-call
         * follow-up rounds where the caller needs to include the assistant's
         * tool_calls message + tool result messages verbatim — not
         * expressible via the `message`/`conversationHistory` shape above).
         */
        async chatRaw({ messages, modelId, temperature = 0.7, maxLength, maxTokens, tools, tool_choice } = {}) {
            const json = await wsClient.agentChat({
                messages,
                tools,
                tool_choice,
                temperature,
                maxTokens: maxTokens || maxLength,
                model: modelId,
                ...(explicitToken ? { token: explicitToken } : {}),
            });
            return {
                text: json?.text || '',
                toolCalls: json?.toolCalls || null,
                message: json?.message,
                usage: json?.usage || null,
            };
        },
    };
}

/** Only retry on transient/network-shaped failures — never on auth/config errors (retrying "token not configured" just delays the real error the user needs to see). */
function _defaultIsRetryable(err) {
    const msg = String((err && err.message) || err || '');
    if (/token not configured|not configured|no auth token|401|403|invalid.*token/i.test(msg)) return false;
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
 * @param {'backend-proxy'|'local-stub'} [opts.mode='backend-proxy'] - which adapter to construct when no `llmClient` is injected.
 * @param {number} [opts.retries=0] - when > 0, wraps `chat`/`chatWithImage`/`chatMultimodal` with bounded retry on transient network errors. Default 0 preserves prior (no-retry) behavior exactly.
 * @param {number} [opts.backoffMs=300] - linear backoff base for retries.
 */
function createLlmProvider(opts = {}) {
    const { llmClient, mode = 'backend-proxy', retries = 0, backoffMs = 300 } = opts;

    let client;
    if (llmClient) {
        client = llmClient;
    } else if (mode === 'local-stub') {
        client = createLocalStubProvider();
    } else {
        client = createBackendProxyProvider();
    }

    if (retries > 0) {
        for (const method of ['chat', 'chatWithImage', 'chatMultimodal', 'chatRaw']) {
            if (typeof client[method] === 'function') {
                const original = client[method].bind(client);
                client[method] = withRetries(original, { retries, backoffMs });
            }
        }
    }

    return client;
}

module.exports = { createLlmProvider, createLocalStubProvider, createBackendProxyProvider, withRetries, CAPABILITIES };
