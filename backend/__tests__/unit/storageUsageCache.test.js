/**
 * storageUsageCache.test.js — behaviour of the storage-usage read path
 * (backend/utils/storageTracker.js).
 *
 * Two things here are easy to regress silently and expensive when they do:
 *
 *  1. Pagination. A ScanCommand returns at most 1 MB and applies its filter to
 *     that page only, so stopping at the first page silently *under-counts* a
 *     user's usage — which is a quota bypass, not just a wrong number.
 *  2. The cache. It exists to keep a full-table scan off every save, but if it
 *     is not invalidated (or bumped) when bytes actually change it turns into a
 *     stale quota check.
 *
 * The AWS SDK is mocked, as in the sibling storageTracker.test.js, because
 * @aws-sdk ships ESM builds this repo's Jest config can't parse.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
    ScanCommand: jest.fn().mockImplementation((input) => ({ __scan: input })),
}));

// The plan lookup pulls in Stripe; stub it so these tests stay offline and
// deterministic. `mockRank` is what the storage limit is derived from.
let mockRank = 'Free';
jest.mock('../../utils/apiUsageTracker', () => ({
    getUserRankFromStripe: jest.fn(async () => mockRank),
    getUserDataCached: jest.fn(async () => null),
    isSpecialUser: jest.fn(() => false),
}));

// Deliberately tiny ceilings. What a plan actually gets (100 MB free, 50 GB
// pro) is a business decision owned by pricing.js and covered by
// pricingSync.test.js; allocating tens of megabytes of test strings to prove
// an arithmetic point would be absurd, and would break every time those
// numbers are tuned. What matters here is that the comparison and the cache
// behave, at whatever the ceiling happens to be.
jest.mock('../../constants/pricing', () => ({
    STORAGE_LIMITS: { Free: 4096, Pro: 8192 },
}));

const {
    getUserStorageUsage,
    checkStorageCapacity,
    trackStorageUsage,
    invalidateStorageUsage,
    addStorageUsage,
    calculateItemSize,
} = require('../../utils/storageTracker');

/** A DynamoDB item as scanUserItems() would return it. */
const itemFor = (userId, bytes, id = 'item-1') => ({
    id,
    // `text` carries the creator id, which is how a user's items are found.
    // The `Creator:u1|` prefix is always 11 characters, so text length === bytes.
    text: `Creator:${userId}|${'x'.repeat(Math.max(0, bytes - 11))}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * What the storage maths will count for an item of `bytes` of text, computed
 * with the module's own sizing so the assertions can't drift from it.
 */
const countedSize = (bytes, id = 'item-1') => calculateItemSize(itemFor('u1', bytes, id));

beforeEach(() => {
    mockSend.mockReset();
    mockRank = 'Free';
    // Each test starts from a cold cache. Tests that assert on caching warm it
    // themselves; invalidating here keeps them from bleeding into each other.
    invalidateStorageUsage('u1');
    invalidateStorageUsage('u2');
});

describe('getUserStorageUsage — scan pagination', () => {
    test('follows LastEvaluatedKey so items past the first 1 MB page still count', async () => {
        const pageOneItem = itemFor('u1', 1000, 'page-1-item');
        const pageTwoItem = itemFor('u1', 2000, 'page-2-item');
        const pageThreeItem = itemFor('u1', 3000, 'page-3-item');

        mockSend
            .mockResolvedValueOnce({ Items: [pageOneItem], LastEvaluatedKey: { id: 'page-1-item' } })
            .mockResolvedValueOnce({ Items: [pageTwoItem], LastEvaluatedKey: { id: 'page-2-item' } })
            .mockResolvedValueOnce({ Items: [pageThreeItem] });

        const usage = await getUserStorageUsage('u1');

        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(usage.itemCount).toBe(3);
        expect(usage.totalStorage).toBe(
            countedSize(1000, 'page-1-item')
            + countedSize(2000, 'page-2-item')
            + countedSize(3000, 'page-3-item')
        );

        // Each call resumes from the previous page's key rather than restarting
        // at the top of the table, and the loop stops once a page reports no
        // key — so exactly three scans for a three-page result.
        expect(mockSend.mock.calls[0][0].__scan.ExclusiveStartKey).toBeUndefined();
        expect(mockSend.mock.calls[1][0].__scan.ExclusiveStartKey).toEqual({ id: 'page-1-item' });
        expect(mockSend.mock.calls[2][0].__scan.ExclusiveStartKey).toEqual({ id: 'page-2-item' });
    });

    test('handles an empty table without dividing by zero', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });

        const usage = await getUserStorageUsage('u1');

        expect(usage.totalStorage).toBe(0);
        expect(usage.itemCount).toBe(0);
        expect(Number.isNaN(usage.storageUsagePercent)).toBe(false);
        expect(usage.isOverLimit).toBe(false);
    });

    test('counts fewer bytes than the record holds for base64 file payloads', async () => {
        // files[].data is base64, and usage counts the decoded size (~0.75x).
        // A multiple of 3 keeps the ratio exact.
        const raw = Buffer.alloc(3000).toString('base64');
        mockSend.mockResolvedValueOnce({
            Items: [{
                id: 'with-file',
                text: 'Creator:u1|',
                files: [{ filename: 'a.png', contentType: 'image/png', data: raw }],
            }],
        });

        const usage = await getUserStorageUsage('u1');

        expect(usage.fileCount).toBe(1);
        // 3000 decoded + filename/contentType metadata + 100 bytes item overhead
        expect(usage.totalStorage).toBeGreaterThanOrEqual(3000);
        expect(usage.totalStorage).toBeLessThan(3000 + 200);
    });
});

describe('getUserStorageUsage — caching', () => {
    test('a second read inside the TTL reuses the first scan', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });

        await getUserStorageUsage('u1');
        await getUserStorageUsage('u1');

        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('concurrent reads for one user collapse onto a single scan', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });

        const results = await Promise.all([
            getUserStorageUsage('u1'),
            getUserStorageUsage('u1'),
            getUserStorageUsage('u1'),
        ]);

        expect(mockSend).toHaveBeenCalledTimes(1);
        // All three callers get the same resolved figure, not undefined.
        results.forEach((usage) => expect(usage.totalStorage).toBe(countedSize(500)));
    });

    test('forceRefresh bypasses a warm cache', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });
        await getUserStorageUsage('u1');
        expect(mockSend).toHaveBeenCalledTimes(1);

        await getUserStorageUsage('u1', { forceRefresh: true });
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('invalidateStorageUsage forces the next read to re-scan', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });
        await getUserStorageUsage('u1');

        invalidateStorageUsage('u1');
        await getUserStorageUsage('u1');

        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('caches per user, so one user never sees another user\'s total', async () => {
        mockSend.mockResolvedValueOnce({ Items: [itemFor('u1', 500)] });
        const first = await getUserStorageUsage('u1');

        mockSend.mockResolvedValueOnce({ Items: [itemFor('u2', 9000)] });
        const second = await getUserStorageUsage('u2');

        expect(first.totalStorage).toBe(countedSize(500));
        expect(second.totalStorage).toBe(countedSize(9000));
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('does not cache a failed scan', async () => {
        mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

        await expect(getUserStorageUsage('u1')).rejects.toThrow('DynamoDB unavailable');

        // The rejection must not have been stored, or every later caller would
        // keep failing for the rest of the TTL.
        mockSend.mockResolvedValueOnce({ Items: [itemFor('u1', 500)] });
        const usage = await getUserStorageUsage('u1');
        expect(usage.totalStorage).toBe(countedSize(500));
        expect(mockSend).toHaveBeenCalledTimes(2);
    });
});

describe('addStorageUsage', () => {
    test('bumps a warm cache so back-to-back saves do not re-scan', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });
        const before = await getUserStorageUsage('u1');
        expect(mockSend).toHaveBeenCalledTimes(1);

        addStorageUsage('u1', 4096, 1);
        const after = await getUserStorageUsage('u1');

        expect(mockSend).toHaveBeenCalledTimes(1); // still one scan
        expect(after.totalStorage).toBe(before.totalStorage + 4096);
        expect(after.itemCount).toBe(before.itemCount + 1);
        expect(after.fileCount).toBe(before.fileCount + 1);
    });

    test('is a no-op on a cold cache (nothing to correct)', async () => {
        invalidateStorageUsage('u1');
        expect(() => addStorageUsage('u1', 4096)).not.toThrow();

        mockSend.mockResolvedValueOnce({ Items: [itemFor('u1', 500)] });
        const usage = await getUserStorageUsage('u1');
        expect(usage.totalStorage).toBe(countedSize(500));
    });

    test('ignores non-finite or zero deltas', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 500)] });
        const before = await getUserStorageUsage('u1');

        addStorageUsage('u1', Number.NaN);
        addStorageUsage('u1', 0);
        addStorageUsage('u1', Infinity);

        const after = await getUserStorageUsage('u1');
        expect(after.totalStorage).toBe(before.totalStorage);
    });
});

describe('trackStorageUsage — quota enforcement through the cache', () => {
    // The mocked Free ceiling is 4096 bytes.
    test('allows an item that fits and reports it as stored', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 1000)] });

        const result = await trackStorageUsage('u1', {
            id: 'new',
            text: `Creator:u1|${'y'.repeat(2000)}`,
        });

        expect(result.success).toBe(true);
        expect(result.itemSize).toBeGreaterThan(2000);
    });

    test('blocks an item that would cross the plan limit', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 1000)] });

        const result = await trackStorageUsage('u1', {
            id: 'huge',
            text: `Creator:u1|${'z'.repeat(10000)}`,
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Storage limit exceeded/i);
    });

    test('a successful save moves the cached total, so the next save is refused', async () => {
        // Seed just under the mocked ceiling (~3154 of 4096).
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 3000)] });

        const item = { id: 'a', text: `Creator:u1|${'x'.repeat(700)}` };

        const first = await trackStorageUsage('u1', item);
        expect(first.success).toBe(true);

        // An identically-sized second item is refused only because the first
        // save was carried into the cached total.
        const second = await trackStorageUsage('u1', item);
        expect(second.success).toBe(false);

        // The whole point: no second full-table scan was needed to reach that
        // verdict — the cached total carried the first item forward.
        expect(mockSend).toHaveBeenCalledTimes(1);
    });
});

describe('checkStorageCapacity', () => {
    test('reports available space and a percentage for a limited plan', async () => {
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 1000)] });

        const capacity = await checkStorageCapacity('u1', 500);

        expect(capacity.canStore).toBe(true);
        expect(capacity.currentUsage).toBe(countedSize(1000));
        expect(capacity.additionalSize).toBe(500);
        expect(capacity.availableSpace).toBe(capacity.storageLimit - capacity.currentUsage);
        expect(capacity.usagePercent).toBeGreaterThan(0);
    });

    test('an unrecognised plan rank does not produce NaN usage or block the user', async () => {
        // STORAGE_LIMITS has no entry for a rank Stripe hands back that we do
        // not recognise. The old arithmetic divided by that missing limit and
        // returned NaN, which callers then rendered in the UI.
        mockRank = 'Some-New-Tier';
        mockSend.mockResolvedValue({ Items: [itemFor('u1', 1000)] });

        const capacity = await checkStorageCapacity('u1', 500);

        expect(capacity.canStore).toBe(true);
        expect(Number.isNaN(capacity.usagePercent)).toBe(false);
        expect(capacity.usagePercent).toBe(0);
        expect(capacity.storageLimitFormatted).toBe('N/A');
    });
});
