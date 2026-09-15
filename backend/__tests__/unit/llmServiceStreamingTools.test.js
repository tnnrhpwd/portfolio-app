/**
 * llmServiceStreamingTools.test.js — regression for the /net streaming turn whose
 * tool loop runs to its cap.
 *
 * The bug (2026-09-14): `streamCompressionRequest()` resolves tools with
 * non-streamed calls, then deliberately drops them for the final streaming leg
 * (the SSE reader only consumes text deltas, so a tool call there would be
 * silently discarded). `messages` still held the loop's assistant `tool_calls`
 * turns and `tool` results, and Bedrock's Converse API rejects `toolUse` /
 * `toolResult` blocks that arrive without a `toolConfig`. Users saw a bare
 *   **Error:** The toolConfig field must be defined when using toolUse and
 *   toolResult content blocks.
 * and the repo edit the chat had been asked for never happened — a 3-round cap
 * meant it was cut off while still investigating.
 *
 * bedrockService.test.js asserts our request shape. THIS test drives the real
 * `streamCompressionRequest()` against a mocked Bedrock client that ENFORCES
 * AWS's validation rules, so the interaction can't silently regress again even if
 * the adapter is refactored.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ kind: 'converse', input })),
    ConverseStreamCommand: jest.fn().mockImplementation((input) => ({ kind: 'stream', input })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn() },
    PutCommand: class { constructor(input) { this.input = input; } },
    UpdateCommand: class { constructor(input) { this.input = input; } },
    GetCommand: class { constructor(input) { this.input = input; } },
}));

// Keeps the run quiet — every branch below expects a clean turn.
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// No DynamoDB in this test: the guards that would touch it are stubbed out.
jest.mock('../../utils/paginatedScan', () => ({ paginatedScan: jest.fn(async () => []) }));
jest.mock('../../utils/apiUsageTracker', () => ({
    API_COSTS: { bedrock: { default: { input: 0.000001, output: 0.000002 } } },
    isSpecialUser: jest.fn(() => false),
}));

jest.mock('../../services/workspaceContext', () => ({
    buildWorkspaceContext: jest.fn(async () => ({ workspaceContext: '', sections: [], bytes: 0 })),
}));

jest.mock('../../services/memoryService', () => ({
    getGoalsSummary: jest.fn(async () => null),
    logAction: jest.fn(async () => {}),
}));

jest.mock('../../utils/llmProviders', () => ({
    checkApiUsage: jest.fn(async () => ({ canMake: true })),
    trackCompletion: jest.fn(async () => ({ success: true })),
    MODEL_TIER_REQUIREMENTS: {},
    PROVIDERS: {}, // no DeepSeek configured ⇒ the turn normalizes to Bedrock
    createCompletion: jest.fn(),
    streamCompletion: jest.fn(),
}));

// Two public tools + two repo tools: the admin context below may use them all,
// which is the exact posture that hit the bug.
jest.mock('../../services/netTools', () => ({
    TOOL_SCHEMAS: [
        { type: 'function', function: { name: 'save_note', description: 'Save a note', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_read_file', description: 'Read a repo file', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'repo_write_file', description: 'Write a repo file', parameters: { type: 'object', properties: {} } } },
    ],
    executeTool: jest.fn(async () => 'ok'),
}));

const { streamCompressionRequest } = require('../../services/llmService');
const { executeTool } = require('../../services/netTools');

const ADMIN_USER_ID = 'admin-user-1';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** Exactly what AWS raises for an invalid Converse request. */
function validationException(message) {
    const err = new Error(message);
    err.name = 'ValidationException';
    err.$metadata = { httpStatusCode: 400 };
    return err;
}

/**
 * AWS's own validation for tool blocks, applied to every outgoing request. This
 * is the oracle: if the adapter ever sends a combination Bedrock refuses, the
 * turn fails here the same way it failed in production.
 */
function enforceAwsToolRules(input) {
    const blocks = (input.messages || []).flatMap((m) => m.content || []);

    if (blocks.some((b) => b.toolUse || b.toolResult) && !input.toolConfig) {
        throw validationException(
            'The toolConfig field must be defined when using toolUse and toolResult content blocks.'
        );
    }

    if (input.toolConfig) {
        const defined = new Set(input.toolConfig.tools.map((t) => t.toolSpec.name));
        for (const block of blocks) {
            if (block.toolUse && !defined.has(block.toolUse.name)) {
                throw validationException(`The tool name ${block.toolUse.name} is not defined in the toolConfig.`);
            }
        }
    }
}

let toolUseSeq = 0;

/** The model keeps asking for a tool — this is what exhausts the loop. */
function toolCallingResponse() {
    return {
        output: {
            message: {
                role: 'assistant',
                content: [
                    { text: 'Let me look at that file.' },
                    {
                        toolUse: {
                            toolUseId: `tooluse_${++toolUseSeq}`,
                            name: 'repo_read_file',
                            input: { path: 'frontend/src/pages/Simple/Net/Net.jsx' },
                        },
                    },
                ],
            },
        },
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

function streamResponse(tokens) {
    return {
        stream: (async function* () {
            for (const text of tokens) yield { contentBlockDelta: { delta: { text } } };
            yield { messageStop: { stopReason: 'end_turn' } };
            yield { metadata: { usage: { inputTokens: 200, outputTokens: 10, totalTokens: 210 } } };
        })(),
    };
}

/** A plain assistant text turn (no tool calls) — ends the loop. */
function textResponse(text) {
    return {
        output: { message: { role: 'assistant', content: [{ text }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

function fakeReq(message) {
    const payload = {
        message,
        // Two turns ⇒ not the first exchange, so no title-generation call muddies
        // the command counts below.
        conversationHistory: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ],
        behaviorFile: 'default.txt',
    };
    return {
        body: {
            data: JSON.stringify({ text: `Net:${JSON.stringify(payload)}` }),
            provider: 'bedrock',
            model: MODEL_ID,
        },
        user: {
            id: ADMIN_USER_ID,
            email: 'admin@example.com',
            nickname: 'Admin',
            text: '|Rank:Pro',
        },
    };
}

function fakeRes() {
    const events = [];
    return {
        events,
        headersSent: false,
        writeHead: jest.fn(),
        write: jest.fn((chunk) => {
            const match = /^data: (.*)\n\n$/.exec(chunk);
            if (match && match[1] !== '[DONE]') events.push(JSON.parse(match[1]));
            return true;
        }),
        end: jest.fn(),
    };
}

const fakeDynamo = () => ({ send: jest.fn(async () => ({})) });

describe('streamCompressionRequest — tool loop that exhausts its rounds', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        toolUseSeq = 0;
        process.env.ADMIN_USER_ID = ADMIN_USER_ID;

        // Every request is validated the way Bedrock validates it; the model never
        // stops asking for tools, so the loop runs to its cap and the turn falls
        // through to the tool-free streaming leg with tool history in `messages`.
        mockSend.mockImplementation(async (command) => {
            enforceAwsToolRules(command.input);
            return command.kind === 'stream' ? streamResponse(['Footer ', 'removed.']) : toolCallingResponse();
        });
    });

    it('finishes with a streamed answer instead of a toolConfig validation error', async () => {
        const res = fakeRes();

        await streamCompressionRequest(fakeReq('remove the footer from the /net page'), res, fakeDynamo());

        const types = res.events.map((e) => e.type);
        expect(types).not.toContain('error');
        expect(types).toContain('token');
        expect(res.events.filter((e) => e.type === 'token').map((e) => e.text).join('')).toBe('Footer removed.');
    });

    it('still reports which tools ran (the round is not silently lost)', async () => {
        const res = fakeRes();

        await streamCompressionRequest(fakeReq('remove the footer'), res, fakeDynamo());

        const toolsEvent = res.events.find((e) => e.type === 'tools');
        expect(toolsEvent).toBeDefined();
        expect(toolsEvent.tools.length).toBeGreaterThan(0);
        expect(toolsEvent.tools[0].tool).toBe('repo_read_file');
        expect(executeTool).toHaveBeenCalledTimes(12); // MAX_TOOL_ROUNDS
    });

    it('asks for a prose wrap-up with tools still offered when the rounds run out', async () => {
        const res = fakeRes();
        let converseCalls = 0;
        mockSend.mockImplementation(async (command) => {
            enforceAwsToolRules(command.input);
            if (command.kind === 'stream') return streamResponse(['stream leg should not run']);
            converseCalls++;
            // The initial call and every follow-up keep asking for tools; the
            // wrap-up call after the cap finally answers in prose.
            return converseCalls <= 13 ? toolCallingResponse()
                : textResponse('I raised the goal description limit to 30,000 characters.');
        });

        await streamCompressionRequest(fakeReq('raise the goal description limit'), res, fakeDynamo());

        const text = res.events.filter((e) => e.type === 'token').map((e) => e.text).join('');
        expect(text).toBe('I raised the goal description limit to 30,000 characters.');
        expect(res.events.some((e) => e.type === 'error')).toBe(false);

        // The answer came from the non-streamed wrap-up call, which kept the
        // toolConfig — so the history never had to be flattened into text.
        expect(mockSend.mock.calls.some(([c]) => c.kind === 'stream')).toBe(false);
        const wrapUp = mockSend.mock.calls.map(([c]) => c).filter((c) => c.kind === 'converse').pop();
        expect(wrapUp.input.toolConfig.tools.length).toBeGreaterThan(0);
        expect(JSON.stringify(wrapUp.input.system)).toMatch(/TOOL LIMIT REACHED/);
    });

    it('tells the model to wrap up in prose once the tool rounds are spent', async () => {
        const res = fakeRes();

        await streamCompressionRequest(fakeReq('remove the footer'), res, fakeDynamo());

        const stream = mockSend.mock.calls.map(([c]) => c).find((c) => c.kind === 'stream');
        const systemText = stream.input.system.map((s) => s.text).join('\n');
        expect(systemText).toMatch(/TOOL LIMIT REACHED/);
        expect(systemText).toMatch(/do not output tool-call syntax/i);
    });

    it('offers tools to the loop rounds and flattens the history for the stream leg', async () => {
        const res = fakeRes();

        await streamCompressionRequest(fakeReq('remove the footer'), res, fakeDynamo());

        const converse = mockSend.mock.calls.map(([c]) => c).filter((c) => c.kind === 'converse');
        const stream = mockSend.mock.calls.map(([c]) => c).filter((c) => c.kind === 'stream');

        // One initial call + one follow-up per round, then the wrap-up call that
        // returns no text, so exactly one streamed leg follows.
        expect(converse).toHaveLength(14); // 1 + MAX_TOOL_ROUNDS (12) + wrap-up
        expect(stream).toHaveLength(1);

        // Loop rounds legitimately use real tool blocks, backed by a toolConfig.
        // (The last loop call carries the whole accumulated tool history.)
        const lastLoopRequest = converse[converse.length - 1].input;
        expect(lastLoopRequest.toolConfig.tools.length).toBeGreaterThan(0);
        expect(JSON.stringify(lastLoopRequest.messages)).toMatch(/toolUse/);
        expect(JSON.stringify(lastLoopRequest.messages)).toMatch(/toolResult/);

        // The tool-free leg may not carry tool blocks — and must not lose them either.
        const finalRequest = stream[0].input;
        expect(finalRequest.toolConfig).toBeUndefined();
        expect(JSON.stringify(finalRequest.messages)).not.toMatch(/toolUse|toolResult/);
        expect(JSON.stringify(finalRequest.messages)).toMatch(/\[used tool: repo_read_file\]/);
        expect(JSON.stringify(finalRequest.messages)).toMatch(/\[tool result\]/);
        // ...and never the arguments: those made the model continue its own JSON.
        expect(JSON.stringify(finalRequest.messages)).not.toContain('Net.jsx')
        expect(finalRequest.messages.length).toBeGreaterThan(1);
    });

    it('streams progress events naming what is happening while the tools run', async () => {
        const res = fakeRes();

        await streamCompressionRequest(fakeReq('remove the footer'), res, fakeDynamo());

        const progress = res.events.filter((e) => e.type === 'progress');
        expect(progress.length).toBeGreaterThan(1);
        expect(progress[0].label).toBe('Looking into it');
        expect(progress.some((e) => e.label === 'Reading Net.jsx…')).toBe(true);
        expect(progress.every((e) => typeof e.label === 'string' && e.label.length > 0)).toBe(true);
        // Progress must arrive before any answer token, and before the tool
        // events: the whole point is that the client is never left idle while
        // the backend resolves tool calls.
        const firstProgress = res.events.findIndex((e) => e.type === 'progress');
        const firstTools = res.events.findIndex((e) => e.type === 'tools');
        const firstToken = res.events.findIndex((e) => e.type === 'token');
        expect(firstProgress).toBeLessThan(firstTools);
        expect(firstProgress).toBeLessThan(firstToken);
    });

    it('names the file in the progress line for a repo edit', async () => {
        const res = fakeRes();
        let converseCalls = 0;
        mockSend.mockImplementation(async (command) => {
            enforceAwsToolRules(command.input);
            if (command.kind === 'stream') return streamResponse(['done']);
            converseCalls++;
            if (converseCalls > 1) return textResponse('Edited it.');
            return {
                output: {
                    message: {
                        role: 'assistant',
                        content: [{
                            toolUse: {
                                toolUseId: 'tu_edit',
                                name: 'repo_edit_file',
                                input: {
                                    path: 'frontend/src/components/SimpleAddon/GoalManager.jsx',
                                    old_string: 'a',
                                    new_string: 'b',
                                },
                            },
                        }],
                    },
                },
                stopReason: 'tool_use',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            };
        });

        await streamCompressionRequest(fakeReq('raise the goal description limit'), res, fakeDynamo());

        const labels = res.events.filter((e) => e.type === 'progress').map((e) => e.label);
        expect(labels).toContain('Editing GoalManager.jsx…');
        expect(labels[labels.length - 1]).toBe('Editing GoalManager.jsx…');
    });

    it('does not flatten anything on an ordinary tool-free chat turn', async () => {
        const res = fakeRes();
        mockSend.mockImplementation(async (command) => {
            enforceAwsToolRules(command.input);
            return streamResponse(['Just ', 'chatting.']);
        });

        await streamCompressionRequest(fakeReq('what can you do?'), res, fakeDynamo());

        const stream = mockSend.mock.calls.map(([c]) => c).find((c) => c.kind === 'stream');
        expect(stream.input.toolConfig).toBeUndefined();
        expect(executeTool).not.toHaveBeenCalled();
        expect(stream.input.messages.some((m) => /\btool\b/.test(JSON.stringify(m)))).toBe(false);
        expect(res.events.some((e) => e.type === 'error')).toBe(false);
    });
});
