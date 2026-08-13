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
    toBedrockMessages,
    toBedrockToolConfig,
    fromBedrockResponse,
} = require('../../services/bedrockService');

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
