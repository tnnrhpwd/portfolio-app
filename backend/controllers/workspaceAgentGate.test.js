/**
 * workspaceAgentGate.test.js — unit tests for the §8 monetization seam at the
 * LLM provider boundary (agent-chat / agent-vision proxies in
 * backend/controllers/workspaceController.js).
 *
 * Mocks the Bedrock adapter, the usage tracker, the logger, and the AWS SDK
 * doc-client boundary so the tests are fast and need no real AWS credentials
 * or network — the same mocking approach as uiMapperController.test.js.
 */

const mockCreateBedrockCompletion = jest.fn();
const mockCanMakeApiCall = jest.fn();
const mockTrackApiUsage = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
    GetCommand: jest.fn(),
    PutCommand: jest.fn(),
    DeleteCommand: jest.fn(),
    ScanCommand: jest.fn(),
    UpdateCommand: jest.fn(),
}));
jest.mock('../services/bedrockService', () => ({
    createBedrockCompletion: (...args) => mockCreateBedrockCompletion(...args),
}));
jest.mock('../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../utils/apiUsageTracker', () => ({
    canMakeApiCall: (...args) => mockCanMakeApiCall(...args),
    trackApiUsage: (...args) => mockTrackApiUsage(...args),
}));

const { agentChatProxy, agentVisionProxy } = require('./workspaceController');

function mockReq(body = {}) {
    return { user: { id: 'user-123' }, body };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const GATE_ALLOW = { canMake: true, membership: 'Free', currentCredits: 0.5 };
const GATE_BLOCK = {
    canMake: false,
    reason: 'Monthly AI usage limit reached for your Free plan. Available: $0.0012, this request needs ~$0.0011.',
    membership: 'Free',
    limit: 0.5,
    currentCredits: 0.0012,
};

describe('agentChatProxy — §8 monetization gate', () => {
    beforeEach(() => {
        mockCreateBedrockCompletion.mockReset();
        mockCanMakeApiCall.mockReset();
        mockTrackApiUsage.mockReset();
        mockTrackApiUsage.mockResolvedValue({ success: true, cost: 0.0011 });
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: 'hello from bedrock' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
    });

    it('blocks with a structured 402 when the user has exhausted their monthly AI credits', async () => {
        mockCanMakeApiCall.mockResolvedValue(GATE_BLOCK);
        const res = mockRes();

        await agentChatProxy(mockReq({ messages: [{ role: 'user', content: 'hi' }] }), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            ok: false,
            planRequired: true,
            requiresUpgrade: true,
            membership: 'Free',
            limit: 0.5,
        }));
        // The Bedrock call must NOT happen when the gate blocks.
        expect(mockCreateBedrockCompletion).not.toHaveBeenCalled();
        expect(mockTrackApiUsage).not.toHaveBeenCalled();
    });

    it('gates BEFORE the Bedrock call using an estimated input/output budget', async () => {
        mockCanMakeApiCall.mockResolvedValue(GATE_ALLOW);
        const res = mockRes();

        await agentChatProxy(mockReq({ messages: [{ role: 'user', content: 'hi' }] }), res, jest.fn());

        expect(mockCanMakeApiCall).toHaveBeenCalledWith('user-123', 'bedrock', expect.objectContaining({
            inputTokens: 500,
            outputTokens: 500,
        }));
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('tracks ACTUAL usage (from the Bedrock usage object) after a successful call', async () => {
        mockCanMakeApiCall.mockResolvedValue(GATE_ALLOW);
        const res = mockRes();

        await agentChatProxy(mockReq({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-haiku-4-5' }), res, jest.fn());

        expect(mockTrackApiUsage).toHaveBeenCalledWith('user-123', 'bedrock', {
            inputTokens: 10,
            outputTokens: 5,
        }, 'claude-haiku-4-5');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, text: 'hello from bedrock' }));
    });
});

describe('agentVisionProxy — §8 monetization gate', () => {
    beforeEach(() => {
        mockCreateBedrockCompletion.mockReset();
        mockCanMakeApiCall.mockReset();
        mockTrackApiUsage.mockReset();
        mockTrackApiUsage.mockResolvedValue({ success: true });
        mockCreateBedrockCompletion.mockResolvedValue({
            choices: [{ message: { content: 'a screenshot of a form' } }],
            usage: { prompt_tokens: 1600, completion_tokens: 120 },
        });
    });

    it('blocks with a structured 402 when denied', async () => {
        mockCanMakeApiCall.mockResolvedValue(GATE_BLOCK);
        const res = mockRes();

        await agentVisionProxy(mockReq({ prompt: 'describe', imageBase64: 'AAAA' }), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ planRequired: true, requiresUpgrade: true }));
        expect(mockCreateBedrockCompletion).not.toHaveBeenCalled();
    });

    it('gates with a vision-appropriate (token-heavy) input estimate and tracks real usage', async () => {
        mockCanMakeApiCall.mockResolvedValue(GATE_ALLOW);
        const res = mockRes();

        await agentVisionProxy(mockReq({ prompt: 'describe', imageBase64: 'AAAA' }), res, jest.fn());

        expect(mockCanMakeApiCall).toHaveBeenCalledWith('user-123', 'bedrock', expect.objectContaining({
            inputTokens: 2000,
            outputTokens: 300,
        }));
        expect(mockTrackApiUsage).toHaveBeenCalledWith('user-123', 'bedrock', {
            inputTokens: 1600,
            outputTokens: 120,
        }, undefined);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ ok: true, text: 'a screenshot of a form' });
    });
});
