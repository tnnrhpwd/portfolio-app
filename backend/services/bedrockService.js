/**
 * bedrockService.js — AWS Bedrock adapter (Claude Haiku 4.5)
 *
 * GitHub Models (models.github.ai) was fully retired by GitHub on 2026-07-30, which
 * permanently broke every backend feature that called it. This adapter replaces it
 * with AWS Bedrock.
 *
 * Credentials: prefers a DEDICATED, least-privilege IAM credential
 * (AWS_BEDROCK_ACCESS_KEY_ID / AWS_BEDROCK_SECRET_ACCESS_KEY / AWS_BEDROCK_REGION)
 * scoped to just bedrock:InvokeModel + bedrock:InvokeModelWithResponseStream, so a
 * leak of this key can't touch DynamoDB/S3. Falls back to the app's existing
 * AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (shared with
 * backend/utils/accessData.js) if the dedicated pair isn't configured, so this
 * still works out-of-the-box without a second secret.
 *
 * Model: Claude Haiku 4.5 via Bedrock's cross-region inference profile
 * "us.anthropic.claude-haiku-4-5-20251001-v1:0" (verified against
 * docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html —
 * NOT Claude 3.5 Haiku, whose Bedrock EOL already passed).
 *
 * Two AWS-console prerequisites the human operator must do (not doable from code):
 *   1. Enable "Claude Haiku 4.5" model access in the Bedrock console, us-east-1.
 *   2. Attach bedrock:InvokeModel (and bedrock:InvokeModelWithResponseStream, used by
 *      streamBedrockCompletion below) permission to the IAM user identified by
 *      AWS_BEDROCK_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID if using the shared fallback).
 *
 * This module isolates ALL Bedrock-specific request/response translation so call
 * sites (workspaceController.js, llmService.js) can keep working against the
 * familiar OpenAI chat.completions.create()-shaped response:
 *   { choices: [{ message: { role, content, tool_calls }, finish_reason }],
 *     usage: { prompt_tokens, completion_tokens, total_tokens,
 *              cached_tokens, cache_write_tokens } }
 */

const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { logger } = require('../utils/logger');
const { planPromptCache, disablePromptCache, isCacheRejection } = require('./bedrockPromptCache.js');

const BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Resolve the AWS credentials Bedrock should authenticate with. Prefers a
 * dedicated, least-privilege Bedrock-only credential pair; falls back to the
 * shared app-wide AWS credentials (same ones DynamoDB/S3 use) when the
 * dedicated pair isn't set, so this keeps working without a second secret.
 */
function resolveBedrockCredentials() {
    const dedicatedKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID;
    const dedicatedSecret = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY;
    if (dedicatedKeyId && dedicatedSecret) {
        return {
            region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION,
            accessKeyId: dedicatedKeyId,
            secretAccessKey: dedicatedSecret,
            dedicated: true,
        };
    }
    return {
        region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        dedicated: false,
    };
}

/** True once either the dedicated or shared AWS credential pair is present. */
function isBedrockConfigured() {
    const creds = resolveBedrockCredentials();
    return !!(creds.accessKeyId && creds.secretAccessKey);
}

let _client = null;
function getBedrockClient() {
    if (!_client) {
        const { region, accessKeyId, secretAccessKey, dedicated } = resolveBedrockCredentials();
        logger.debug(`🪨 Bedrock client using ${dedicated ? 'dedicated AWS_BEDROCK_*' : 'shared AWS_*'} credentials (region: ${region})`);
        _client = new BedrockRuntimeClient({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return _client;
}

/**
 * Convert a single OpenAI-style message `content` value (string, or an array
 * of `{type:'text'|'image_url', ...}` blocks — the vision/multimodal shape
 * used by webcam/screenshot/vision-fusion call sites) into Bedrock Converse
 * content blocks.
 */
function toBedrockUserContent(content) {
    if (typeof content !== 'object' || content === null) {
        return [{ text: String(content ?? '') }];
    }
    if (!Array.isArray(content)) {
        return [{ text: String(content) }];
    }

    const blocks = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text') {
            blocks.push({ text: String(part.text ?? '') });
        } else if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            // data:<mime>;base64,<data>
            const match = /^data:image\/(\w+);base64,(.+)$/.exec(url);
            if (match) {
                const [, subtype, base64Data] = match;
                // Bedrock only accepts a fixed set of image formats.
                const format = ['png', 'jpeg', 'jpg', 'gif', 'webp'].includes(subtype)
                    ? (subtype === 'jpg' ? 'jpeg' : subtype)
                    : 'png';
                blocks.push({
                    image: {
                        format,
                        source: { bytes: Buffer.from(base64Data, 'base64') },
                    },
                });
            }
        }
    }
    return blocks.length > 0 ? blocks : [{ text: '' }];
}

/**
 * Convert an OpenAI-style messages array (roles: system/user/assistant/tool) into
 * Bedrock Converse `messages` turns. `system` messages are excluded here — callers
 * should pass them via the `system` param instead (see createBedrockCompletion).
 *
 * Bedrock has no 'tool' role: a tool result is sent back as a `user` message with a
 * `toolResult` content block referencing the original `toolUseId`. Consecutive tool
 * results (from the same round) are merged into a single user turn so the
 * conversation still strictly alternates user/assistant, as Converse requires.
 *
 * `user` message `content` may be a plain string OR an OpenAI-style multimodal
 * array (`[{type:'text',...},{type:'image_url',image_url:{url:'data:...'}}]`),
 * used by the addon's vision/screenshot/webcam call sites (proxied through
 * `/api/data/csimple/agent-vision`).
 *
 * @param {Array} messages - OpenAI-style messages (system/user/assistant/tool).
 * @param {Object} [options] - { allowToolBlocks } — set to `false` when this call
 *   offers NO tools: the history is rewritten by `flattenToolHistory` so it carries
 *   no `toolUse`/`toolResult` blocks and no assistant-side tool traces at all.
 */
function toBedrockMessages(messages, options = {}) {
    // Converse rejects `toolUse`/`toolResult` content blocks unless a `toolConfig`
    // is ALSO present ("The toolConfig field must be defined when using toolUse and
    // toolResult content blocks") — and a toolConfig only makes sense when the
    // caller is actually offering tools. The one caller that keeps a tool-bearing
    // history while deliberately offering NO tools is llmService's streaming
    // "final answer" leg, so for that case the history is rewritten by
    // flattenToolHistory() first: it carries no assistant-side tool trace at all.
    const allowToolBlocks = options.allowToolBlocks !== false;
    const source = allowToolBlocks ? messages : flattenToolHistory(messages);
    const bedrockMessages = [];
    // The user turn currently collecting tool results, so consecutive results
    // (one per call in a round) merge into a single turn as Converse requires.
    let toolResultsTurn = null;

    for (const msg of source) {
        if (!msg || msg.role === 'system') continue;

        if (msg.role === 'tool') {
            const block = {
                toolResult: {
                    toolUseId: msg.tool_call_id,
                    content: [{ text: String(msg.content ?? '') }],
                },
            };
            if (toolResultsTurn) {
                toolResultsTurn.push(block);
            } else {
                toolResultsTurn = [block];
                bedrockMessages.push({ role: 'user', content: toolResultsTurn });
            }
            continue;
        }

        toolResultsTurn = null;

        if (msg.role === 'assistant') {
            const content = [];
            if (msg.content) content.push({ text: msg.content });
            if (Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                    let input = {};
                    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* leave as {} */ }
                    content.push({
                        toolUse: {
                            toolUseId: tc.id,
                            name: tc.function?.name,
                            input,
                        },
                    });
                }
            }
            // Bedrock requires at least one content block per turn.
            if (content.length === 0) content.push({ text: '' });
            bedrockMessages.push({ role: 'assistant', content });
            continue;
        }

        // user (and anything else) — text-only or multimodal (text + image).
        bedrockMessages.push({ role: 'user', content: toBedrockUserContent(msg.content) });
    }

    // Converse requires the turn sequence to start with a 'user' message.
    if (bedrockMessages.length === 0 || bedrockMessages[0].role !== 'user') {
        bedrockMessages.unshift({ role: 'user', content: [{ text: '(no input)' }] });
    }

    return bedrockMessages;
}

/**
 * Rewrite a tool-bearing history into one a tool-free call can accept, WITHOUT
 * leaving any trace of the tool calls in an assistant turn.
 *
 * The first version of this rendered them as `[used tool: x]` text inside the
 * ASSISTANT turn — which is exactly what a model continues: live replies came
 * back as `…after my edits[used tool: repo_read_file]` (seen twice on 2026-09-14).
 * So the assistant tool-call turns are dropped and every call/result is folded
 * into the neighbouring USER turn as a short activity log, which is not something
 * the model treats as its own words. The model still sees everything the tools
 * returned, so it can write a real answer.
 */
function flattenToolHistory(messages) {
    const out = [];
    let pending = [];

    const flush = () => {
        if (pending.length === 0) return;
        const log = `Tool activity so far:\n${pending.map((line) => `- ${line}`).join('\n')}`;
        pending = [];
        const last = out[out.length - 1];
        // Merge into the user turn already there rather than adding a second one:
        // Converse requires the roles to alternate.
        if (last && last.role === 'user' && typeof last.content === 'string') {
            last.content = `${last.content}\n\n${log}`;
            return;
        }
        out.push({ role: 'user', content: log });
    };

    for (const msg of Array.isArray(messages) ? messages : []) {
        if (!msg || msg.role === 'system') continue;

        if (msg.role === 'tool') {
            const label = msg.name ? `${msg.name} result` : 'result';
            pending.push(`${label}: ${String(msg.content ?? '')}`);
            continue;
        }

        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        if (msg.role === 'assistant' && toolCalls.length > 0) {
            // Keep any prose the assistant actually wrote under its own name, but
            // never the call itself.
            if (msg.content) {
                flush();
                out.push({ role: 'assistant', content: String(msg.content) });
            }
            for (const tc of toolCalls) pending.push(`called ${tc.function?.name || 'a tool'}`);
            continue;
        }

        flush();
        out.push(msg);
    }
    flush();

    return out;
}

/**
 * True when an OpenAI-shaped history already contains tool-call turns and/or
 * tool-result turns. Converse rejects those unless the SAME request carries a
 * `toolConfig`, so call sites that offer no tools must flatten them
 * (`toBedrockMessages(messages, { allowToolBlocks: false })`) — see that function.
 */
function hasToolHistory(messages) {
    return (Array.isArray(messages) ? messages : []).some((m) => m.role === 'tool'
        || (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0));
}

/** Tool names referenced by the history's assistant `tool_calls` turns. */
function collectHistoryToolNames(messages) {
    const names = new Set();
    for (const msg of Array.isArray(messages) ? messages : []) {
        if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
        for (const tc of msg.tool_calls) {
            const name = tc?.function?.name;
            if (name) names.add(name);
        }
    }
    return names;
}

/**
 * Build the two halves of a Converse request that have to agree with each other:
 * the `messages` turns and the `toolConfig`. This is the ONLY place that decides
 * whether tool blocks may be emitted, so no call site can send a combination
 * Converse rejects:
 *
 *   1. `toolUse`/`toolResult` blocks require a `toolConfig` in the same request
 *      ("The toolConfig field must be defined when using toolUse and toolResult
 *      content blocks") — the exact error a /net repo edit used to die on.
 *   2. A `toolUse` block should name a tool the `toolConfig` actually defines.
 *
 * When either rule can't be met the history's tool turns are flattened to text
 * instead (`toBedrockMessages`) — the model still sees every call and result.
 * Tools that ARE offered still reach the model as real tool blocks.
 *
 * @param {Array} messages - OpenAI-shaped conversation.
 * @param {Object} [options] - { tools, tool_choice } — same as the entry points.
 * @returns {{messages: Array, toolConfig: Object|undefined, toolBlocksAllowed: boolean}}
 */
function buildConverseRequestParts(messages, options = {}) {
    const toolConfig = toBedrockToolConfig(options.tools, options.tool_choice);
    const offeredNames = new Set(toolConfig ? toolConfig.tools.map((t) => t.toolSpec.name) : []);
    const everyHistoryToolOffered = [...collectHistoryToolNames(messages)]
        .every((name) => offeredNames.has(name));
    const toolBlocksAllowed = !!toolConfig && everyHistoryToolOffered;

    return {
        messages: toBedrockMessages(messages, { allowToolBlocks: toolBlocksAllowed }),
        toolConfig,
        toolBlocksAllowed,
    };
}

/**
 * One debug line when a request had to flatten tool history — the signature of
 * "a tool loop ran, and this call deliberately offers no tools". Without it, a
 * flattened turn looks like a plain call in the logs.
 */
function logToolBlockPolicy(label, messages, toolBlocksAllowed, toolConfig) {
    if (toolBlocksAllowed || !hasToolHistory(messages)) return;
    const why = toolConfig
        ? "the history references a tool this call's toolConfig does not define"
        : 'no tools were offered for this call';
    logger.debug(`🪨 ${label}: flattened the history's tool call/result turns to text (${why}).`);
}

/**
 * Convert OpenAI function-calling `tools` + `tool_choice` into Bedrock's
 * `toolConfig` (toolSpec/inputSchema) shape.
 */
function toBedrockToolConfig(tools, toolChoice) {
    if (!tools || tools.length === 0) return undefined;

    const toolConfig = {
        tools: tools.map((t) => ({
            toolSpec: {
                name: t.function.name,
                description: t.function.description,
                inputSchema: { json: t.function.parameters || { type: 'object', properties: {} } },
            },
        })),
    };

    if (toolChoice === 'required') {
        toolConfig.toolChoice = { any: {} };
    } else if (toolChoice && typeof toolChoice === 'object' && toolChoice.function?.name) {
        toolConfig.toolChoice = { tool: { name: toolChoice.function.name } };
    } else {
        toolConfig.toolChoice = { auto: {} };
    }

    return toolConfig;
}

const STOP_REASON_MAP = {
    end_turn: 'stop',
    tool_use: 'tool_calls',
    max_tokens: 'length',
    stop_sequence: 'stop',
    content_filtered: 'content_filter',
};

/**
 * Convert a Bedrock Converse response into an OpenAI
 * chat.completions.create()-shaped response object.
 */
function fromBedrockResponse(bedrockResponse) {
    const contentBlocks = bedrockResponse.output?.message?.content || [];

    let textContent = '';
    const toolCalls = [];
    for (const block of contentBlocks) {
        if (block.text) textContent += block.text;
        if (block.toolUse) {
            toolCalls.push({
                id: block.toolUse.toolUseId,
                type: 'function',
                function: {
                    name: block.toolUse.name,
                    arguments: JSON.stringify(block.toolUse.input || {}),
                },
            });
        }
    }

    const message = { role: 'assistant', content: textContent || null };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    return {
        choices: [{
            message,
            finish_reason: STOP_REASON_MAP[bedrockResponse.stopReason] || bedrockResponse.stopReason || 'stop',
        }],
        usage: {
            prompt_tokens: bedrockResponse.usage?.inputTokens || 0,
            completion_tokens: bedrockResponse.usage?.outputTokens || 0,
            total_tokens: bedrockResponse.usage?.totalTokens || 0,
            // Prompt caching (see bedrockPromptCache.js) can only be confirmed on
            // a real turn, so it must be VISIBLE on one: `cached_tokens` is what a
            // cache READ of the fixed prefix reports, and a non-zero value on
            // round 2 of a tool turn is the proof the saving is real. Without it,
            // "caching is on" would be an assumption nobody could check.
            cached_tokens: bedrockResponse.usage?.cacheReadInputTokens || 0,
            cache_write_tokens: bedrockResponse.usage?.cacheWriteInputTokens || 0,
        },
        model: BEDROCK_MODEL_ID,
    };
}

/**
 * Tag a Bedrock SDK error with a stable `.code` our call sites can branch on,
 * without losing the original error identity/message.
 */
function classifyBedrockError(error) {
    const name = error?.name || '';
    const message = error?.message || '';
    if (name === 'ThrottlingException' || error?.$metadata?.httpStatusCode === 429) {
        error.code = 'BEDROCK_THROTTLED';
    } else if (name === 'AccessDeniedException') {
        error.code = 'BEDROCK_ACCESS_DENIED';
    } else if (/use case details/i.test(message)) {
        // Anthropic-on-Bedrock's one-time-per-AWS-account "First Time Use" gate:
        // AWS surfaces this as a ValidationException whose message literally says
        // "Model use case details have not been submitted for this account." — not
        // a distinct error name, so match on message content. Fixed by an operator
        // submitting the use-case form once in the Bedrock console's model catalog
        // (or via the PutUseCaseForModelAccess API); no retry/backoff on our end
        // will resolve it faster than that.
        error.code = 'BEDROCK_USE_CASE_NOT_SUBMITTED';
    }
    return error;
}

/**
 * Main adapter entry point (non-streaming). Accepts an OpenAI-chat-shaped
 * `messages` array (system/user/assistant/tool roles, optional `tools` +
 * `tool_choice` in `options`) and returns an OpenAI
 * chat.completions.create()-shaped response.
 *
 * @param {Array} messages - OpenAI-style messages (system/user/assistant/tool)
 * @param {Object} [options] - { maxTokens, temperature, tools, tool_choice }
 */
async function createBedrockCompletion(messages, options = {}) {
    const client = getBedrockClient();

    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');

    const requestParts = buildConverseRequestParts(messages, options);

    // Cache the part that never changes (system + tool schemas) so a multi-round
    // tool turn stops re-paying for it — see bedrockPromptCache.js.
    const cache = planPromptCache({
        modelId: BEDROCK_MODEL_ID,
        systemText,
        toolConfig: requestParts.toolConfig,
    });

    const buildCommand = ({ system, toolConfig }) => new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages: requestParts.messages,
        inferenceConfig: {
            maxTokens: options.maxTokens || options.max_tokens || 1000,
            temperature: options.temperature ?? 0.7,
        },
        toolConfig,
    });

    logToolBlockPolicy('Converse', messages, requestParts.toolBlocksAllowed, requestParts.toolConfig);

    logger.debug(`🪨 Bedrock Converse call: ${BEDROCK_MODEL_ID}${options.tools ? ` [${options.tools.length} tools]` : ''}${cache.applied ? ' [prompt cache]' : ''}`);
    const startTime = Date.now();
    let response;
    try {
        response = await client.send(buildCommand(cache));
    } catch (error) {
        // A rejected cache point is OUR mistake, not the user's problem: retry the
        // identical request without it. `disablePromptCache` latches caching off so
        // this costs one extra round trip ONCE per process, not once per turn.
        if (!cache.applied || !isCacheRejection(error)) throw classifyBedrockError(error);
        disablePromptCache(error, BEDROCK_MODEL_ID);
        try {
            response = await client.send(buildCommand(cache.plain));
        } catch (retryError) {
            throw classifyBedrockError(retryError);
        }
    }
    logger.debug(`🪨 Bedrock Converse call completed in ${Date.now() - startTime}ms`);
    return fromBedrockResponse(response);
}

/**
 * Streaming variant. Yields { type: 'token', text } chunks as they arrive and
 * returns a final { fullText, usage, stopReason } summary. Intended for the
 * final (tool-free) leg of a response, matching how Bedrock's Converse
 * streaming API delivers text — tool-use is resolved via non-streaming
 * createBedrockCompletion() calls beforehand.
 */
async function* streamBedrockCompletion(messages, options = {}) {
    const client = getBedrockClient();

    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');

    // Same rule as createBedrockCompletion: no tools offered ⇒ no toolConfig ⇒
    // the history's tool turns must be flattened to text. This is the leg that
    // used to blow up with "The toolConfig field must be defined when using
    // toolUse and toolResult content blocks" on any /net turn whose tool loop ran
    // out of rounds (see llmService.streamCompressionRequest).
    const requestParts = buildConverseRequestParts(messages, options);

    // Same cache points as the non-streaming entry point, and the same retry.
    const cache = planPromptCache({
        modelId: BEDROCK_MODEL_ID,
        systemText,
        toolConfig: requestParts.toolConfig,
    });

    const buildCommand = ({ system, toolConfig }) => new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages: requestParts.messages,
        inferenceConfig: {
            maxTokens: options.maxTokens || options.max_tokens || 1000,
            temperature: options.temperature ?? 0.7,
        },
        toolConfig,
    });

    logToolBlockPolicy('ConverseStream', messages, requestParts.toolBlocksAllowed, requestParts.toolConfig);

    let fullText = '';
    let usage = null;
    let stopReason = null;

    let response;
    try {
        response = await client.send(buildCommand(cache));
    } catch (error) {
        // The stream has not started yet, so retrying here is invisible to the
        // caller — it sees one stream, not a failed attempt.
        if (!cache.applied || !isCacheRejection(error)) throw classifyBedrockError(error);
        disablePromptCache(error, BEDROCK_MODEL_ID);
        try {
            response = await client.send(buildCommand(cache.plain));
        } catch (retryError) {
            throw classifyBedrockError(retryError);
        }
    }

    try {
        for await (const event of response.stream) {
            const deltaText = event.contentBlockDelta?.delta?.text;
            if (deltaText) {
                fullText += deltaText;
                yield { type: 'token', text: deltaText };
            }
            if (event.metadata?.usage) usage = event.metadata.usage;
            if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason;
        }
    } catch (error) {
        throw classifyBedrockError(error);
    }

    return {
        fullText,
        stopReason,
        usage: {
            prompt_tokens: usage?.inputTokens || 0,
            completion_tokens: usage?.outputTokens || 0,
            total_tokens: usage?.totalTokens || 0,
            // Same reason as fromBedrockResponse: the cache saving has to be
            // observable on the turn that pays for it.
            cached_tokens: usage?.cacheReadInputTokens || 0,
            cache_write_tokens: usage?.cacheWriteInputTokens || 0,
        },
    };
}

module.exports = {
    BEDROCK_MODEL_ID,
    getBedrockClient,
    resolveBedrockCredentials,
    isBedrockConfigured,
    classifyBedrockError,
    createBedrockCompletion,
    streamBedrockCompletion,
    buildConverseRequestParts,
    collectHistoryToolNames,
    flattenToolHistory,
    hasToolHistory,
    toBedrockMessages,
    toBedrockUserContent,
    toBedrockToolConfig,
    fromBedrockResponse,
};
