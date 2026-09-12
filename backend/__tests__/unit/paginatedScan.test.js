/**
 * paginatedScan.test.js — the shared full-table Scan (backend/utils/paginatedScan.js).
 *
 * This helper exists because a single `ScanCommand` only examines 1 MB and then
 * hands back a `LastEvaluatedKey`. Dropping that key is invisible: no error, no
 * partial-result flag, just fewer rows than the table holds. It has already
 * caused "no saved games yet" after a successful save, under-counted storage
 * usage (a quota bypass) and searches that returned nothing — so the property
 * worth pinning hardest is simply *it keeps going*.
 *
 * The AWS SDK doc-client is mocked; the module builds its client at import time.
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
    ScanCommand: jest.fn().mockImplementation((input) => ({ __scan: input })),
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { paginatedScan, DEFAULT_MAX_SCAN_PAGES } = require('../../utils/paginatedScan');
const { logger } = require('../../utils/logger');

/** The scan inputs passed to the mocked client, in order. */
const scanInputs = () => mockSend.mock.calls.map((call) => call[0].__scan);

const PARAMS = {
    TableName: 'Simple',
    FilterExpression: 'begins_with(id, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'csimple_memory_u1_' },
};

describe('paginatedScan', () => {
    beforeEach(() => {
        mockSend.mockReset();
        logger.warn.mockClear();
    });

    test('keeps going until DynamoDB stops handing back a cursor', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [{ id: 'page-1-a' }], LastEvaluatedKey: { id: 'k1' } })
            .mockResolvedValueOnce({ Items: [{ id: 'page-2-a' }], LastEvaluatedKey: { id: 'k2' } })
            .mockResolvedValueOnce({ Items: [{ id: 'page-3-a' }] });

        const items = await paginatedScan(PARAMS);

        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(items.map((i) => i.id)).toEqual(['page-1-a', 'page-2-a', 'page-3-a']);
    });

    test('passes the cursor from the previous page, and not on the first call', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { id: 'k1' } })
            .mockResolvedValueOnce({ Items: [] });

        await paginatedScan(PARAMS);

        const [first, second] = scanInputs();
        expect(first.ExclusiveStartKey).toBeUndefined();
        expect(second.ExclusiveStartKey).toEqual({ id: 'k1' });
    });

    test('forwards the caller\'s scan params untouched', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });

        await paginatedScan(PARAMS);

        expect(scanInputs()[0]).toMatchObject(PARAMS);
    });

    test('makes one call when the first page is also the last', async () => {
        mockSend.mockResolvedValueOnce({ Items: [{ id: 'only' }] });

        const items = await paginatedScan(PARAMS);

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(items).toHaveLength(1);
    });

    test('treats a page with no Items array as empty rather than throwing', async () => {
        mockSend.mockResolvedValueOnce({});

        await expect(paginatedScan(PARAMS)).resolves.toEqual([]);
    });

    test('stops at maxPages and warns that the result is incomplete', async () => {
        // Every page claims there is more — the runaway case the cap exists for.
        mockSend.mockResolvedValue({ Items: [{ id: 'x' }], LastEvaluatedKey: { id: 'more' } });

        const items = await paginatedScan(PARAMS, { maxPages: 3 });

        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(items).toHaveLength(3);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toContain('INCOMPLETE');
    });

    test('does not warn when the scan genuinely finishes', async () => {
        mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { id: 'k1' } });
        mockSend.mockResolvedValueOnce({ Items: [] });

        await paginatedScan(PARAMS);

        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('uses a caller-supplied client instead of its own', async () => {
        // llmService and workspaceContext inject their doc client rather than
        // importing one, so the helper has to honour that.
        const injected = { send: jest.fn().mockResolvedValue({ Items: [{ id: 'injected' }] }) };

        const items = await paginatedScan(PARAMS, { client: injected });

        expect(injected.send).toHaveBeenCalledTimes(1);
        expect(mockSend).not.toHaveBeenCalled();
        expect(items).toEqual([{ id: 'injected' }]);
    });

    test('propagates a scan failure rather than returning a partial list', async () => {
        // A caller must not mistake "the scan broke" for "there is nothing here".
        mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));

        await expect(paginatedScan(PARAMS)).rejects.toThrow('ProvisionedThroughputExceeded');
    });

    test('caps the page count at a sane default', () => {
        expect(DEFAULT_MAX_SCAN_PAGES).toBeGreaterThan(1);
        expect(DEFAULT_MAX_SCAN_PAGES).toBeLessThanOrEqual(1000);
    });
});
