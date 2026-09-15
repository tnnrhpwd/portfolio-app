/**
 * bedrockService.test.js — smoke tests for the AWS Bedrock adapter
 * (backend/services/bedrockService.js).
 *
 * The real @aws-sdk/client-bedrock-runtime package ships an ESM build that
 * this repo's Jest config can't parse (the same pre-existing issue that
 * affects @aws-sdk/client-dynamodb in back.test.js / test-ocr.js), so the
 * whole package is mocked here to keep this test fast, isolated, and
 * independent of real AWS credentials/network access.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ input })),
    ConverseStreamCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const {
    BEDROCK_MODEL_ID,
    createBedrockCompletion,
    streamBedrockCompletion,
    buildConverseRequestParts,
    hasToolHistory,
    toBedrockMessages,
    toBedrockToolConfig,
    fromBedrockResponse,
} = require('../../services/bedrockService');

/** A history that already ran one tool round (assistant tool_calls + tool result). */
const TOOL_HISTORY = [
    { role: 'system', content: 'You can edit the repo.' },
    { role: 'user', content: 'Remove the footer from /net' },
    {
        role: 'assistant',
        content: null,
        tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'repo_read_file', arguments: '{"path":"frontend/src/pages/Net/Net.jsx"}' },
        }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '<Footer /> found on line 42' },
];

/** True when any emitted content block is a toolUse/toolResult block. */
function hasToolBlocks(blocksOrMessages) {
    return /toolUse|toolResult/.test(JSON.stringify(blocksOrMessages));
}

describe('bedrockService — request shape translation', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    it('excludes system messages and converts plain user/assistant turns', () => {
        const messages = [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
        ];
        const result = toBedrockMessages(messages);
        expect(result).toEqual([
            { role: 'user', content: [{ text: 'Hello' }] },
            { role: 'assistant', content: [{ text: 'Hi there!' }] },
        ]);
    });

    it('converts an assistant tool_calls message into assistant toolUse content blocks', () => {
        const messages = [
            { role: 'user', content: 'What is the weather?' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
                ],
            },
        ];
        const result = toBedrockMessages(messages);
        expect(result[1]).toEqual({
            role: 'assistant',
            content: [{ toolUse: { toolUseId: 'call_1', name: 'get_weather', input: { city: 'NYC' } } }],
        });
    });

    it('merges consecutive tool-result messages into a single user turn with toolResult blocks', () => {
        const messages = [
            { role: 'user', content: 'Do two things' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'a', arguments: '{}' } },
                    { id: 'call_2', type: 'function', function: { name: 'b', arguments: '{}' } },
                ],
            },
            { role: 'tool', tool_call_id: 'call_1', content: 'result A' },
            { role: 'tool', tool_call_id: 'call_2', content: 'result B' },
        ];
        const result = toBedrockMessages(messages);
        // user, assistant(toolUse x2), user(toolResult x2 merged)
        expect(result).toHaveLength(3);
        expect(result[2]).toEqual({
            role: 'user',
            content: [
                { toolResult: { toolUseId: 'call_1', content: [{ text: 'result A' }] } },
                { toolResult: { toolUseId: 'call_2', content: [{ text: 'result B' }] } },
            ],
        });
    });

    it('prepends a placeholder user turn if the conversation would otherwise start with assistant', () => {
        const messages = [{ role: 'assistant', content: 'unexpected first turn' }];
        const result = toBedrockMessages(messages);
        expect(result[0].role).toBe('user');
        expect(result[1].role).toBe('assistant');
    });

    it('converts OpenAI function-calling tools into Bedrock toolConfig', () => {
        const tools = [{
            type: 'function',
            function: {
                name: 'save_goal',
                description: 'Save a goal',
                parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
            },
        }];
        const toolConfig = toBedrockToolConfig(tools, 'auto');
        expect(toolConfig.tools).toEqual([{
            toolSpec: {
                name: 'save_goal',
                description: 'Save a goal',
                inputSchema: { json: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
            },
        }]);
        expect(toolConfig.toolChoice).toEqual({ auto: {} });
    });

    it('returns undefined toolConfig when no tools are provided', () => {
        expect(toBedrockToolConfig(undefined, 'auto')).toBeUndefined();
        expect(toBedrockToolConfig([], 'auto')).toBeUndefined();
    });

    it('flattens tool-call/tool-result turns to plain text when tool blocks are not allowed', () => {
        const result = toBedrockMessages(TOOL_HISTORY, { allowToolBlocks: false });

        expect(result).toEqual([
            { role: 'user', content: [{ text: 'Remove the footer from /net' }] },
            {
                role: 'assistant',
                content: [{ text: '[used tool: repo_read_file]' }],
            },
            { role: 'user', content: [{ text: '[tool result] <Footer /> found on line 42' }] },
        ]);
        // Converse rejects these blocks when no toolConfig accompanies them.
        expect(hasToolBlocks(result)).toBe(false);
    });

    it('merges consecutive flattened tool results into a single turn', () => {
        const messages = [
            { role: 'user', content: 'two things' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'a', arguments: '{}' } },
                    { id: 'c2', type: 'function', function: { name: 'b', arguments: '{}' } },
                ],
            },
            { role: 'tool', tool_call_id: 'c1', content: 'result A' },
            { role: 'tool', tool_call_id: 'c2', content: 'result B' },
        ];
        const result = toBedrockMessages(messages, { allowToolBlocks: false });

        expect(result).toHaveLength(3);
        expect(result[2]).toEqual({
            role: 'user',
            content: [{ text: '[tool result] result A' }, { text: '[tool result] result B' }],
        });
    });

    it('reports whether a history contains tool turns', () => {
        expect(hasToolHistory(TOOL_HISTORY)).toBe(true);
        expect(hasToolHistory([{ role: 'tool', content: 'orphan result' }])).toBe(true);
        expect(hasToolHistory([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ])).toBe(false);
        expect(hasToolHistory(undefined)).toBe(false);
    });
});

describe('bedrockService — response shape translation', () => {
    it('converts a plain-text Converse response into an OpenAI chat.completions-shaped response', () => {
        const bedrockResponse = {
            output: { message: { role: 'assistant', content: [{ text: 'Hello back!' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
        const result = fromBedrockResponse(bedrockResponse);
        expect(result).toEqual({
            choices: [{ message: { role: 'assistant', content: 'Hello back!' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            model: BEDROCK_MODEL_ID,
        });
    });

    it('converts a toolUse Converse response into OpenAI tool_calls shape', () => {
        const bedrockResponse = {
            output: {
                message: {
                    role: 'assistant',
                    content: [{ toolUse: { toolUseId: 'tooluse_abc', name: 'get_weather', input: { city: 'NYC' } } }],
                },
            },
            stopReason: 'tool_use',
            usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        };
        const result = fromBedrockResponse(bedrockResponse);
        expect(result.choices[0].finish_reason).toBe('tool_calls');
        expect(result.choices[0].message.tool_calls).toEqual([{
            id: 'tooluse_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: JSON.stringify({ city: 'NYC' }) },
        }]);
    });
});

describe('bedrockService — createBedrockCompletion (mocked client)', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    it('sends the Claude Haiku 4.5 model ID and returns an OpenAI-shaped response', async () => {
        mockSend.mockResolvedValue({
            output: { message: { role: 'assistant', content: [{ text: 'Hi!' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        });

        const messages = [
            { role: 'system', content: 'Be nice.' },
            { role: 'user', content: 'Hello' },
        ];
        const response = await createBedrockCompletion(messages, { maxTokens: 50, temperature: 0.2 });

        expect(mockSend).toHaveBeenCalledTimes(1);
        const sentCommand = mockSend.mock.calls[0][0];
        expect(sentCommand.input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
        expect(sentCommand.input.system).toEqual([{ text: 'Be nice.' }]);
        expect(sentCommand.input.inferenceConfig).toEqual({ maxTokens: 50, temperature: 0.2 });

        expect(response.choices[0].message.content).toBe('Hi!');
        expect(response.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    });

    it('tags ThrottlingException with a BEDROCK_THROTTLED code', async () => {
        const err = new Error('Too many requests');
        err.name = 'ThrottlingException';
        mockSend.mockRejectedValue(err);

        await expect(createBedrockCompletion([{ role: 'user', content: 'hi' }]))
            .rejects.toMatchObject({ code: 'BEDROCK_THROTTLED' });
    });

    it('tags AccessDeniedException with a BEDROCK_ACCESS_DENIED code', async () => {
        const err = new Error('Not authorized to invoke model');
        err.name = 'AccessDeniedException';
        mockSend.mockRejectedValue(err);

        await expect(createBedrockCompletion([{ role: 'user', content: 'hi' }]))
            .rejects.toMatchObject({ code: 'BEDROCK_ACCESS_DENIED' });
    });

    it('tags the Anthropic "use case details" ValidationException with BEDROCK_USE_CASE_NOT_SUBMITTED', async () => {
        const err = new Error(
            'Model use case details have not been submitted for this account. Fill out the Anthropic ' +
            'use case details form before using the model. If you have already filled out the form, try again in 15 minutes.'
        );
        err.name = 'ValidationException';
        mockSend.mockRejectedValue(err);

        await expect(createBedrockCompletion([{ role: 'user', content: 'hi' }]))
            .rejects.toMatchObject({ code: 'BEDROCK_USE_CASE_NOT_SUBMITTED' });
    });
});

/**
 * Regression: the /net chat's streaming "final answer" leg is deliberately
 * tool-free, but its history still carries the turns from the tool loop above
 * it. Bedrock rejected the request with
 *   "The toolConfig field must be defined when using toolUse and toolResult content blocks."
 * which surfaced to the user as a bare `**Error:**` — the repo edit the chat had
 * already staged never got explained, and the turn looked like a hard failure.
 */
describe('bedrockService — tool history on a tool-free call (regression)', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    const TOOLS = [{
        type: 'function',
        function: {
            name: 'repo_read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: {} },
        },
    }];

    function mockStream(events) {
        mockSend.mockResolvedValue({
            stream: (async function* () { for (const event of events) yield event; })(),
        });
    }

    async function drain(generator) {
        const chunks = [];
        let next = await generator.next();
        while (!next.done) {
            chunks.push(next.value);
            next = await generator.next();
        }
        return { chunks, summary: next.value };
    }

    it('streams the final answer without sending tool blocks or an undefined toolConfig', async () => {
        mockStream([
            { contentBlockDelta: { delta: { text: 'Removed the footer.' } } },
            { metadata: { usage: { inputTokens: 40, outputTokens: 6, totalTokens: 46 } } },
            { messageStop: { stopReason: 'end_turn' } },
        ]);

        const { chunks, summary } = await drain(streamBedrockCompletion(TOOL_HISTORY, { maxTokens: 100 }));

        const input = mockSend.mock.calls[0][0].input;
        expect(input.toolConfig).toBeUndefined();
        expect(hasToolBlocks(input.messages)).toBe(false);
        expect(chunks).toEqual([{ type: 'token', text: 'Removed the footer.' }]);
        expect(summary.fullText).toBe('Removed the footer.');
        expect(summary.stopReason).toBe('end_turn');
    });

    it('keeps real toolUse/toolResult blocks when the call DOES offer tools', async () => {
        mockSend.mockResolvedValue({
            output: { message: { role: 'assistant', content: [{ text: 'done' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await createBedrockCompletion(TOOL_HISTORY, { tools: TOOLS, tool_choice: 'auto' });

        const input = mockSend.mock.calls[0][0].input;
        expect(input.toolConfig.tools).toHaveLength(1);
        expect(hasToolBlocks(input.messages)).toBe(true);
    });

    it('leaves a plain tool-free history untouched', async () => {
        mockSend.mockResolvedValue({
            output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await createBedrockCompletion([{ role: 'user', content: 'hi' }]);

        const input = mockSend.mock.calls[0][0].input;
        expect(input.toolConfig).toBeUndefined();
        expect(input.messages).toEqual([{ role: 'user', content: [{ text: 'hi' }] }]);
    });

    it('flattens a history whose tool is not defined in the offered toolConfig', async () => {
        mockSend.mockResolvedValue({
            output: { message: { role: 'assistant', content: [{ text: 'done' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        // TOOL_HISTORY used repo_read_file; this call only offers save_note.
        await createBedrockCompletion(TOOL_HISTORY, {
            tools: [{ type: 'function', function: { name: 'save_note', description: 'Save a note' } }],
            tool_choice: 'auto',
        });

        const input = mockSend.mock.calls[0][0].input;
        expect(input.toolConfig.tools.map((t) => t.toolSpec.name)).toEqual(['save_note']);
        expect(hasToolBlocks(input.messages)).toBe(false);
        expect(input.messages).toEqual(expect.arrayContaining([{
            role: 'assistant',
            content: [{ text: '[used tool: repo_read_file]' }],
        }]));
    });

    it('buildConverseRequestParts keeps messages and toolConfig in agreement', () => {
        const withTools = buildConverseRequestParts([{ role: 'user', content: 'hi' }], {
            tools: TOOLS,
            tool_choice: 'auto',
        });
        expect(withTools.toolBlocksAllowed).toBe(true);
        expect(withTools.toolConfig.tools).toHaveLength(1);

        const historyOnly = buildConverseRequestParts(TOOL_HISTORY, {});
        expect(historyOnly.toolConfig).toBeUndefined();
        expect(historyOnly.toolBlocksAllowed).toBe(false);
        expect(hasToolBlocks(historyOnly.messages)).toBe(false);
    });

    it('never re-emits tool arguments into the flattened history', async () => {
        // The leak that produced a wall of JSON in the chat: a big repo_write_file
        // payload rendered as the assistant's own last message, which the model
        // then simply continued.
        const bigContent = 'x'.repeat(5000);
        const messages = [
            { role: 'user', content: 'raise the goal description limit' },
            {
                role: 'assistant',
                content: 'Let me update that file.',
                tool_calls: [{
                    id: 'c1',
                    type: 'function',
                    function: { name: 'repo_write_file', arguments: JSON.stringify({ path: 'a.jsx', content: bigContent }) },
                }],
            },
            { role: 'tool', tool_call_id: 'c1', content: 'Error: arguments were cut off (invalid JSON)' },
        ];
        mockSend.mockResolvedValue({
            output: { message: { role: 'assistant', content: [{ text: 'sorry, that failed' }] } },
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });

        await createBedrockCompletion(messages);

        const input = mockSend.mock.calls[0][0].input;
        expect(input.messages[1]).toEqual({
            role: 'assistant',
            content: [{ text: 'Let me update that file.' }, { text: '[used tool: repo_write_file]' }],
        });
        expect(JSON.stringify(input.messages)).not.toContain('xxxxx');
    });
});
