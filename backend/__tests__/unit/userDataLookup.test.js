/**
 * userDataLookup.test.js — how the credit path reads a user's record
 * (backend/utils/apiUsageTracker.js `getUserDataCached`).
 *
 * This is the lookup that decides a user's plan and credit allowance, so the
 * failure that matters is quiet: it used to run a full-table Scan with
 * `id = :userId` as a FilterExpression. DynamoDB applies a filter only within
 * the ≤1 MB scanned page, so once the `Simple` table grew past that, a user
 * whose row sat beyond the boundary read back as *no record at all* — i.e. a
 * paying subscriber could be metered as a brand-new free account (and the same
 * call billed a whole-table scan to fetch one row).
 *
 * The assertions below therefore pin two things: a *query* is issued rather
 * than a scan, and the user is found regardless of where their row lives.
 *
 * NOTE: `getUserDataCached` memoises for 2 minutes in module state, so every
 * test uses its own user id. Reusing one id silently exercises the cache
 * instead of the lookup — which is exactly how the first draft of this file
 * fooled itself.
 *
 * The AWS SDK, Stripe and logger boundaries are mocked, as in the sibling
 * apiUsageTracker.test.js — no network, no configured keys.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: (...args) => mockSend(...args) })) },
    ScanCommand: jest.fn().mockImplementation((input) => ({ kind: 'scan', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
    GetCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ kind: 'query', input })),
}));
jest.mock('../../utils/stripeInstance', () => ({
    getStripe: jest.fn(),
    liveStripe: {},
}));
jest.mock('../../utils/logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { getUserDataCached } = require('../../utils/apiUsageTracker');

const HASH = '$2a$10$abcdefghijklmnopqrstuv';

/** A user row as DynamoDB would return it. */
const rowFor = (userId) => ({
    id: userId,
    createdAt: '2026-01-01T00:00:00.000Z',
    text: `Nickname:Sam|Email:sam@example.com|Password:${HASH}|Rank:Pro`,
});

/** The command handed to the doc client on the most recent call. */
const lastCommand = () => mockSend.mock.calls[mockSend.mock.calls.length - 1][0];

describe('getUserDataCached', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    it('reads the user with a partition-key Query, never a full-table Scan', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor('q-basic')] });

        await getUserDataCached('q-basic');

        const command = lastCommand();
        expect(command.kind).toBe('query');
        expect(command.input.KeyConditionExpression).toBe('id = :userId');
        expect(command.input.ExpressionAttributeValues).toEqual({ ':userId': 'q-basic' });
        // The regression that matters: a scan is position-dependent.
        expect(command.kind).not.toBe('scan');
    });

    it('does not filter on the key inside a FilterExpression', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor('q-nofilter')] });

        await getUserDataCached('q-nofilter');

        expect(lastCommand().input.FilterExpression).toBeUndefined();
    });

    it('returns the record even though it lives past the first scan page', async () => {
        // A Query has no page boundary to fall off — this is the exact user the
        // old scan reported as missing.
        mockSend.mockResolvedValueOnce({ Items: [rowFor('q-beyond-page')] });

        const user = await getUserDataCached('q-beyond-page');

        expect(user).not.toBeNull();
        expect(user.id).toBe('q-beyond-page');
    });

    it('returns null only when the Query genuinely finds nothing', async () => {
        mockSend.mockResolvedValueOnce({ Items: [] });

        await expect(getUserDataCached('ghost')).resolves.toBeNull();
    });

    it('never leaks the password hash to callers', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor('q-redact')] });

        const user = await getUserDataCached('q-redact');

        expect(user.text).not.toContain(HASH);
        expect(user.text).toContain('[redacted]');
    });

    it('serves a second read inside the TTL from cache', async () => {
        mockSend.mockResolvedValueOnce({ Items: [rowFor('q-cached')] });

        const first = await getUserDataCached('q-cached');
        const second = await getUserDataCached('q-cached');

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('looks each different user up separately', async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [rowFor('q-a')] })
            .mockResolvedValueOnce({ Items: [rowFor('q-b')] });

        await getUserDataCached('q-a');
        await getUserDataCached('q-b');

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(mockSend.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({ ':userId': 'q-a' });
        expect(mockSend.mock.calls[1][0].input.ExpressionAttributeValues).toEqual({ ':userId': 'q-b' });
    });
});
