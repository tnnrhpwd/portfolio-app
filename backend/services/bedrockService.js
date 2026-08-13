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
 *     usage: { prompt_tokens, completion_tokens, total_tokens } }
 */

const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { logger } = require('../utils/logger');

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
 */
function toBedrockMessages(messages) {
    const bedrockMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') continue;

        if (msg.role === 'tool') {
            const toolResultBlock = {
                toolResult: {
                    toolUseId: msg.tool_call_id,
                    content: [{ text: String(msg.content ?? '') }],
                },
            };
            const last = bedrockMessages[bedrockMessages.length - 1];
            if (last && last.role === 'user' && last.content.every((c) => c.toolResult)) {
                last.content.push(toolResultBlock);
            } else {
                bedrockMessages.push({ role: 'user', content: [toolResultBlock] });
            }
            continue;
        }

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
    if (name === 'ThrottlingException' || error?.$metadata?.httpStatusCode === 429) {
        error.code = 'BEDROCK_THROTTLED';
    } else if (name === 'AccessDeniedException') {
        error.code = 'BEDROCK_ACCESS_DENIED';
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

    const command = new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system: systemText ? [{ text: systemText }] : undefined,
        messages: toBedrockMessages(messages),
        inferenceConfig: {
            maxTokens: options.maxTokens || options.max_tokens || 1000,
            temperature: options.temperature ?? 0.7,
        },
        toolConfig: toBedrockToolConfig(options.tools, options.tool_choice),
    });

    logger.debug(`🪨 Bedrock Converse call: ${BEDROCK_MODEL_ID}${options.tools ? ` [${options.tools.length} tools]` : ''}`);
    const startTime = Date.now();
    try {
        const response = await client.send(command);
        logger.debug(`🪨 Bedrock Converse call completed in ${Date.now() - startTime}ms`);
        return fromBedrockResponse(response);
    } catch (error) {
        throw classifyBedrockError(error);
    }
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

    const command = new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system: systemText ? [{ text: systemText }] : undefined,
        messages: toBedrockMessages(messages),
        inferenceConfig: {
            maxTokens: options.maxTokens || options.max_tokens || 1000,
            temperature: options.temperature ?? 0.7,
        },
        toolConfig: toBedrockToolConfig(options.tools, options.tool_choice),
    });

    let fullText = '';
    let usage = null;
    let stopReason = null;

    try {
        const response = await client.send(command);
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
        },
    };
}

module.exports = {
    BEDROCK_MODEL_ID,
    getBedrockClient,
    isBedrockConfigured,
    createBedrockCompletion,
    streamBedrockCompletion,
    toBedrockMessages,
    toBedrockUserContent,
    toBedrockToolConfig,
    fromBedrockResponse,
};
