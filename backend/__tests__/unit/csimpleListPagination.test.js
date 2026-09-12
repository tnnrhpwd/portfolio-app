/**
 * csimpleListPagination.test.js — regression tests for the Simple workspace
 * *list* endpoints in backend/controllers/csimpleController.js.
 *
 * What was wrong: each list ran a single `ScanCommand` with a
 * `begins_with(id, :prefix)` FilterExpression. DynamoDB applies a filter only
 * within the scanned page and examines at most 1 MB per call, so once the
 * `Simple` table passed a megabyte these endpoints started returning *some* of a
 * user's files — or none at all — for rows past that boundary, with no error.
 * The same unsorted scan also feeds `getSimpleUserContext`, which is what the
 * LLM is given as the user's memory: the assistant would silently "forget".
 *
 * So the assertion that matters here is not "it returns items" but "it returns
 * items that live on the *second* page".
 *
 * The AWS SDK is mocked at the doc-client boundary, as in
 * fileUploadStorageGate.test.js; `secretCrypto` is stubbed so the controller can
 * be imported without a configured key.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    DeleteCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ kind: 'scan', input })),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/secretCrypto', () => ({
    encryptString: (value) => value,
    decryptString: (value) => value,
}));

const {
    getSimpleMemoryFiles,
    getSimplePersonalityFiles,
    getSimpleBehaviors,
} = require('../../controllers/csimpleController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const req = { user: { id: 'u1' } };

const USER = 'u1';

describe('Simple workspace lists page through the whole table', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    test('memory list includes files found on a later page', async () => {
        mockSend
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_memory_${USER}_first.txt`, createdAt: '2026-01-01' }],
                LastEvaluatedKey: { id: 'cursor-1' },
            })
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_memory_${USER}_second.txt`, createdAt: '2026-01-02' }],
            });
        const res = mockRes();

        await getSimpleMemoryFiles(req, res);

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            files: [
                { name: 'first.txt', updatedAt: '2026-01-01' },
                { name: 'second.txt', updatedAt: '2026-01-02' },
            ],
        });
    });

    test('personality list includes files found on a later page', async () => {
        mockSend
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_personality_${USER}_a.txt`, createdAt: '2026-01-01' }],
                LastEvaluatedKey: { id: 'cursor-1' },
            })
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_personality_${USER}_b.txt`, createdAt: '2026-01-02' }],
            });
        const res = mockRes();

        await getSimplePersonalityFiles(req, res);

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(res.json.mock.calls[0][0].files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    });

    test('behavior list includes files found on a later page', async () => {
        mockSend
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_behavior_${USER}_one.txt` }],
                LastEvaluatedKey: { id: 'cursor-1' },
            })
            .mockResolvedValueOnce({
                Items: [{ id: `csimple_behavior_${USER}_two.txt` }],
            });
        const res = mockRes();

        await getSimpleBehaviors(req, res);

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(res.json.mock.calls[0][0].behaviors.map((b) => b.name)).toEqual(['one.txt', 'two.txt']);
    });

    test('the second scan continues from the cursor, not from the start', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { id: 'cursor-1' } })
            .mockResolvedValueOnce({ Items: [] });
        const res = mockRes();

        await getSimpleMemoryFiles(req, res);

        const [first, second] = mockSend.mock.calls.map((c) => c[0].input);
        expect(first.ExclusiveStartKey).toBeUndefined();
        expect(second.ExclusiveStartKey).toEqual({ id: 'cursor-1' });
    });

    test('still scopes the scan to the requesting user', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });
        const res = mockRes();

        await getSimpleMemoryFiles(req, res);

        const { input } = mockSend.mock.calls[0][0];
        expect(input.ExpressionAttributeValues[':prefix']).toBe(`csimple_memory_${USER}_`);
        expect(input.FilterExpression).toContain('begins_with(id, :prefix)');
    });

    test('reports a scan failure as a 500 rather than an empty list', async () => {
        mockSend.mockRejectedValueOnce(new Error('scan blew up'));
        const res = mockRes();
        const next = jest.fn();

        await getSimpleMemoryFiles(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(next).toHaveBeenCalled();
    });
});
