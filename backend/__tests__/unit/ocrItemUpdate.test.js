/**
 * ocrItemUpdate.test.js — `updateItemWithOCR` in backend/services/ocrService.js.
 *
 * This is the write path behind "extract text from this item's image", and it
 * had three defects that all failed *quietly or confusingly* for real users:
 *
 *  1. It read the item with `FilterExpression: 'id = :itemId'` inside a Scan.
 *     A filter applies only within the ≤1 MB scanned page, so a valid item past
 *     that boundary threw "Data item not found".
 *  2. The ownership check sliced the creator id to a fixed 24 characters
 *     (`substring(i + 8, i + 32)`) and compared that to the caller's id. The ids
 *     in use are 32-char crypto hex, so the comparison failed and the *actual
 *     owner* was told "User not authorized to update this item".
 *  3. Ownership was skipped entirely when a record carried no `Creator:` tag,
 *     making an untagged record writable by anyone who knew its id.
 *
 * The AWS SDK is mocked at the doc-client boundary; the LLM/usage modules are
 * stubbed because this function uses neither.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ kind: 'scan', input })),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/llmProviders', () => ({
    initializeLLMClients: jest.fn(),
    createCompletion: jest.fn(),
    trackCompletion: jest.fn(),
}));
jest.mock('../../utils/apiUsageTracker', () => ({
    canMakeApiCall: jest.fn(),
}));

const { updateItemWithOCR } = require('../../services/ocrService');

/** A 32-char crypto hex id, as this table uses. */
const OWNER = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

const rowFor = (creatorId) => ({
    id: 'item-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: `Creator:${creatorId}|Action:existing notes`,
    updatedAt: '2026-01-01T00:00:00.000Z',
});

const lastCommand = () => mockSend.mock.calls[mockSend.mock.calls.length - 1][0];

describe('updateItemWithOCR', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    it('reads the item by partition key, never a filtered Scan', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor(OWNER)] }).mockResolvedValueOnce({});

        await updateItemWithOCR('item-1', OWNER, 'extracted');

        const read = mockSend.mock.calls[0][0];
        expect(read.kind).toBe('query');
        expect(read.input.KeyConditionExpression).toBe('id = :itemId');
        expect(read.input.FilterExpression).toBeUndefined();
    });

    it('lets the record\'s real owner update it (32-char id)', async () => {
        // The regression: the old fixed-24-char slice compared the wrong
        // substring, so this exact call threw "User not authorized".
        mockSend.mockResolvedValueOnce({ Items: [rowFor(OWNER)] }).mockResolvedValueOnce({});

        await expect(updateItemWithOCR('item-1', OWNER, 'extracted')).resolves.toBeTruthy();
        expect(lastCommand().kind).toBe('put');
    });

    it('still recognises a legacy 24-char creator id', async () => {
        const legacy = 'a1b2c3d4e5f6a7b8c9d0e1f2';
        mockSend.mockResolvedValueOnce({ Items: [rowFor(legacy)] }).mockResolvedValueOnce({});

        await expect(updateItemWithOCR('item-1', legacy, 'extracted')).resolves.toBeTruthy();
    });

    it('refuses a different user', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor(OWNER)] });

        await expect(updateItemWithOCR('item-1', 'someone-else', 'extracted'))
            .rejects.toThrow('User not authorized');
        // Nothing written.
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('refuses a record with no creator tag instead of allowing it', async () => {
        mockSend.mockResolvedValueOnce({
            Items: [{ ...rowFor(OWNER), text: 'no creator tag here' }],
        });

        await expect(updateItemWithOCR('item-1', OWNER, 'extracted'))
            .rejects.toThrow('User not authorized');
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('throws not-found when the item genuinely does not exist', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });

        await expect(updateItemWithOCR('missing', OWNER, 'extracted'))
            .rejects.toThrow('Data item not found');
    });

    it('appends the extracted text to the item\'s Action field', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor(OWNER)] }).mockResolvedValueOnce({});

        const updated = await updateItemWithOCR('item-1', OWNER, 'Line one');

        expect(updated.text).toContain('Line one');
        expect(updated.text).toContain('Creator:');
    });
});
