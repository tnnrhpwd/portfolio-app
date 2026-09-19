/**
 * bedrockPromptCache.test.js — cost control that cannot break a turn.
 *
 * The rule this suite pins is not "caching is on". It is: **a wrong cache point
 * must never reach the user.** Three guards decide whether a point is sent, and
 * a fourth catches the case where all three were wrong:
 *
 *   1. the model allowlist,
 *   2. the minimum cacheable prefix size,
 *   3. the env switch,
 *   4. the latch + transparent retry — exercised through the real adapter below,
 *      because that is the only place the retry actually lives.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ input })),
    ConverseStreamCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const {
    planPromptCache,
    isCacheRejection,
    modelSupportsPromptCache,
    promptCacheEnabled,
    MIN_CACHEABLE_TOKENS,
    _resetForTests,
    _latchedReason,
} = require('../../services/bedrockPromptCache.js');

const { createBedrockCompletion, fromBedrockResponse, BEDROCK_MODEL_ID } = require('../../services/bedrockService.js');

const MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** A prefix comfortably above the minimum: ~4K tokens of schemas. */
const BIG_TOOL_CONFIG = () => ({
    tools: Array.from({ length: 40 }, (_, i) => ({
        toolSpec: { name: `tool_${i}`, description: 'x'.repeat(400), inputSchema: { json: {} } },
    })),
});

const SYSTEM = 'y'.repeat(4000);

const originalFlag = process.env.BEDROCK_PROMPT_CACHE;
afterEach(() => {
    if (originalFlag === undefined) delete process.env.BEDROCK_PROMPT_CACHE;
    else process.env.BEDROCK_PROMPT_CACHE = originalFlag;
    _resetForTests();
    mockSend.mockReset();
});

describe('planPromptCache — when a cache point is worth sending', () => {
    it('marks the system block AND the end of the tool specs', () => {
        const plan = planPromptCache({ modelId: MODEL, systemText: SYSTEM, toolConfig: BIG_TOOL_CONFIG() });

        expect(plan.applied).toBe(true);
        // The point must come AFTER the text it covers…
        expect(plan.system).toEqual([{ text: SYSTEM }, { cachePoint: { type: 'default' } }]);
        // …and after the last tool spec, so the whole schema list is inside it.
        const tools = plan.toolConfig.tools;
        expect(tools[tools.length - 1]).toEqual({ cachePoint: { type: 'default' } });
        expect(tools).toHaveLength(BIG_TOOL_CONFIG().tools.length + 1);
    });

    it('keeps the plain form identical to what was sent before, for the retry', () => {
        const toolConfig = BIG_TOOL_CONFIG();
        const plan = planPromptCache({ modelId: MODEL, systemText: SYSTEM, toolConfig });

        // The retry path must reuse the SAME toolConfig object semantics: same
        // specs, no extra block — anything else would be a different request.
        expect(plan.plain.system).toEqual([{ text: SYSTEM }]);
        expect(plan.plain.toolConfig).toBe(toolConfig);
        expect(plan.plain.toolConfig.tools).toHaveLength(40);
    });

    it('declines when the prefix is too small to cache', () => {
        const plan = planPromptCache({ modelId: MODEL, systemText: 'short', toolConfig: { tools: [] } });

        expect(plan.applied).toBe(false);
        expect(plan.reason).toMatch(/below the .* minimum/);
        expect(plan.system).toEqual([{ text: 'short' }]);
    });

    it('counts the tool schemas, so a tool turn caches even with a tiny system prompt', () => {
        // The dominant prefix in a /net turn is the TOOL SCHEMAS (~4.2K tokens),
        // not the prose prompt — missing that would mean never caching anything.
        const plan = planPromptCache({ modelId: MODEL, systemText: 'be brief', toolConfig: BIG_TOOL_CONFIG() });
        expect(plan.applied).toBe(true);
    });

    it('declines for a model that is not on the allowlist', () => {
        const plan = planPromptCache({ modelId: 'us.anthropic.claude-2-x', systemText: SYSTEM, toolConfig: BIG_TOOL_CONFIG() });

        expect(plan.applied).toBe(false);
        expect(plan.reason).toMatch(/allowlist/);
    });

    it('declines when there is no toolConfig at all', () => {
        // Nothing to put a toolConfig cache point after. The system block alone is
        // still cacheable — but only if it clears the MINIMUM on its own, which is
        // why the long prompt applies and the short one does not.
        expect(planPromptCache({ modelId: MODEL, systemText: 'y'.repeat(9000), toolConfig: undefined }).applied).toBe(true);
        expect(planPromptCache({ modelId: MODEL, systemText: 'y'.repeat(4000), toolConfig: undefined }).applied).toBe(false);
        // …and with no system text either there is nothing to cache.
        expect(planPromptCache({ modelId: MODEL, systemText: '', toolConfig: undefined }).applied).toBe(false);
    });

    it('honours the env switch, and lets =1 override the allowlist', () => {
        process.env.BEDROCK_PROMPT_CACHE = '0';
        expect(promptCacheEnabled()).toBe(false);
        expect(planPromptCache({ modelId: MODEL, systemText: SYSTEM, toolConfig: BIG_TOOL_CONFIG() }).applied).toBe(false);

        // An explicit on is for trying a newly-enabled model without a deploy.
        process.env.BEDROCK_PROMPT_CACHE = '1';
        expect(modelSupportsPromptCache('us.anthropic.some-new-model')).toBe(true);
        expect(planPromptCache({ modelId: 'us.anthropic.some-new-model', systemText: SYSTEM, toolConfig: BIG_TOOL_CONFIG() }).applied).toBe(true);
    });
});

describe('planPromptCache — recognising a cache rejection', () => {
    it('matches only errors that name the cache point', () => {
        expect(isCacheRejection(new Error('The cachePoint field is not supported for this model.'))).toBe(true);
        expect(isCacheRejection(new Error('ValidationException: malformed cache point'))).toBe(true);
        // A throttling error must NOT be mistaken for one: retrying without the
        // cache point would not help, and latching caching off would be wrong.
        expect(isCacheRejection(new Error('ThrottlingException: too many requests'))).toBe(false);
        expect(isCacheRejection(new Error('The model use case details have not been submitted'))).toBe(false);
    });
});

describe('createBedrockCompletion — the retry the guards fall back on', () => {
    const toolCalling = () => ({
        output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: 'end_turn',
    });

    const toolOptions = () => ({
        maxTokens: 100,
        tools: Array.from({ length: 40 }, (_, i) => ({
            type: 'function',
            function: { name: `tool_${i}`, description: 'x'.repeat(400), parameters: { type: 'object', properties: {} } },
        })),
    });

    it('sends the cached form when the model is allowlisted', async () => {
        mockSend.mockResolvedValueOnce(toolCalling());

        await createBedrockCompletion(
            [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'go' }],
            toolOptions(),
        );

        const sent = mockSend.mock.calls[0][0].input;
        expect(sent.system[sent.system.length - 1]).toEqual({ cachePoint: { type: 'default' } });
        expect(sent.toolConfig.tools[sent.toolConfig.tools.length - 1]).toEqual({ cachePoint: { type: 'default' } });
    });

    it('retries WITHOUT the cache point when Bedrock rejects it, and the user sees no error', async () => {
        const rejection = new Error('The cachePoint field is not supported for this model.');
        rejection.name = 'ValidationException';
        mockSend.mockRejectedValueOnce(rejection).mockResolvedValueOnce(toolCalling());

        const response = await createBedrockCompletion(
            [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'go' }],
            toolOptions(),
        );

        // One failed attempt, one clean retry, one answer.
        expect(mockSend).toHaveBeenCalledTimes(2);
        const retry = mockSend.mock.calls[1][0].input;
        expect(JSON.stringify(retry)).not.toContain('cachePoint');
        expect(response.choices[0].message.content).toBe('ok');
        expect(_latchedReason()).toBeTruthy();
    });

    it('latches the failure, so the NEXT turn does not pay the doubled round trip', async () => {
        const rejection = new Error('cachePoint unsupported');
        mockSend.mockRejectedValueOnce(rejection).mockResolvedValue(toolCalling());

        const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'go' }];
        await createBedrockCompletion(messages, toolOptions()); // latches
        mockSend.mockClear();
        mockSend.mockResolvedValueOnce(toolCalling());

        await createBedrockCompletion(messages, toolOptions());

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockSend.mock.calls[0][0].input)).not.toContain('cachePoint');
    });

    it('does NOT retry a rejection that has nothing to do with caching', async () => {
        // Retrying a throttling error without cache points would double the load
        // for no reason and disable a working feature.
        mockSend.mockRejectedValueOnce(new Error('ThrottlingException: slow down'));

        await expect(createBedrockCompletion(
            [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'go' }],
            toolOptions(),
        )).rejects.toThrow();

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(_latchedReason()).toBeNull();
    });

    it('does not add a cache point to a small request', async () => {
        mockSend.mockResolvedValueOnce(toolCalling());

        await createBedrockCompletion([{ role: 'user', content: 'hello' }], { maxTokens: 100 });

        const sent = mockSend.mock.calls[0][0].input;
        expect(JSON.stringify(sent)).not.toContain('cachePoint');
        expect(BEDROCK_MODEL_ID).toBeTruthy();
    });
});

describe('fromBedrockResponse — making the cache provable on a real turn', () => {
    const reply = (usage) => ({
        output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
        usage,
        stopReason: 'end_turn',
    });

    it('surfaces cache READS, which is what proves the prefix was reused', () => {
        // Round 2 of a tool turn should report a non-zero read here. Without this
        // field the saving would be an assumption nobody could check on the turn
        // that pays for it.
        const response = fromBedrockResponse(reply({
            inputTokens: 6000, outputTokens: 40, totalTokens: 6040,
            cacheReadInputTokens: 4700, cacheWriteInputTokens: 0,
        }));

        expect(response.usage).toMatchObject({
            prompt_tokens: 6000,
            cached_tokens: 4700,
            cache_write_tokens: 0,
        });
    });

    it('surfaces the write, and defaults both to 0 when Bedrock reports neither', () => {
        expect(fromBedrockResponse(reply({
            inputTokens: 100, outputTokens: 5, totalTokens: 105, cacheWriteInputTokens: 4700,
        })).usage.cache_write_tokens).toBe(4700);

        // An uncached model reports nothing — that must read as 0, not undefined,
        // so a summary that sums these fields can't produce NaN.
        const plain = fromBedrockResponse(reply({ inputTokens: 100, outputTokens: 5, totalTokens: 105 }));
        expect(plain.usage.cached_tokens).toBe(0);
        expect(plain.usage.cache_write_tokens).toBe(0);
    });
});
