/**
 * accessLogRetention.test.js — the contract of the visitor rows written by
 * `checkIP()` (backend/utils/accessData.js).
 *
 * Two things were added to this hot path and both are worth pinning down:
 *
 *  1. Retention. `checkIP` writes one row per non-localhost request, which is
 *     the biggest unbounded row source in the shared `Simple` table, so every
 *     row now carries an `expiresAt` TTL.
 *  2. Geo comes from `geoLookup`'s cache instead of a direct ipinfo call. The
 *     caller `await`s `checkIP` before responding, so a per-request lookup put a
 *     third-party round-trip (and its worst-case latency) on the critical path.
 *
 * AWS and `ipinfo` are mocked, as in the sibling referer tests, so this stays
 * offline and deterministic.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const mockSend = jest.fn().mockResolvedValue({});
const mockPutCommand = jest.fn((params) => ({ input: params }));

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
    PutCommand: mockPutCommand,
    ScanCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    DeleteCommand: jest.fn(),
}));

const mockIpinfo = jest.fn();
jest.mock('ipinfo', () => (...args) => mockIpinfo(...args));

const { checkIP } = require('../../utils/accessData');
const { DEFAULT_RETENTION_DAYS } = require('../../utils/analyticsRetention');

const SECONDS_PER_DAY = 24 * 60 * 60;
const IPINFO_OK = {
    city: 'Kansas City',
    region: 'Missouri',
    country: 'US',
    loc: '39.0997,-94.5786',
};

/** A minimal Express-ish request, as checkIP reads it. */
function buildRequest(overrides = {}) {
    return {
        ip: '203.0.113.7',
        headers: {
            'user-agent': 'Mozilla/5.0',
            referer: 'https://www.google.com/search?q=simple',
            host: 'sthopwood.com',
        },
        method: 'GET',
        originalUrl: '/api/data/things?token=secret',
        connection: {},
        socket: {},
        get: () => 'sthopwood.com',
        ...overrides,
    };
}

/** The single item passed to PutCommand by the last checkIP call. */
function lastItem() {
    const calls = mockPutCommand.mock.calls;
    return calls[calls.length - 1][0].Item;
}

describe('checkIP retention + geo', () => {
    beforeEach(() => {
        mockSend.mockClear();
        mockPutCommand.mockClear();
        mockIpinfo.mockReset();
        mockIpinfo.mockImplementation((ip, cb) => cb(null, IPINFO_OK));
        delete process.env.ANALYTICS_RETENTION_DAYS;
    });

    afterEach(() => {
        delete process.env.ANALYTICS_RETENTION_DAYS;
    });

    it('stamps a DynamoDB TTL on the visitor row', async () => {
        const expected = Math.floor(Date.now() / 1000) + DEFAULT_RETENTION_DAYS * SECONDS_PER_DAY;

        await checkIP(buildRequest());

        const item = lastItem();
        expect(typeof item.expiresAt).toBe('number');
        expect(Math.abs(item.expiresAt - expected)).toBeLessThan(60);
    });

    it('honours the configured retention window', async () => {
        process.env.ANALYTICS_RETENTION_DAYS = '7';
        const expected = Math.floor(Date.now() / 1000) + 7 * SECONDS_PER_DAY;

        await checkIP(buildRequest({ ip: '203.0.113.8' }));

        expect(Math.abs(lastItem().expiresAt - expected)).toBeLessThan(60);
    });

    it('keeps createdAt/updatedAt consistent with the TTL base', async () => {
        await checkIP(buildRequest({ ip: '203.0.113.9' }));

        const item = lastItem();
        expect(item.createdAt).toBe(item.updatedAt);
        expect(item.expiresAt).toBe(
            Math.floor(Date.parse(item.createdAt) / 1000) + DEFAULT_RETENTION_DAYS * SECONDS_PER_DAY
        );
    });

    it('logs a row per request without calling ipinfo per request', async () => {
        const request = buildRequest({ ip: '203.0.113.20' });

        await checkIP(request);
        await checkIP(request);
        await checkIP(request);

        expect(mockPutCommand).toHaveBeenCalledTimes(3);
        expect(mockIpinfo).toHaveBeenCalledTimes(1);
    });

    it('records the location and the coordinates the visitor map needs', async () => {
        await checkIP(buildRequest({ ip: '203.0.113.21' }));

        const text = lastItem().text;
        expect(text).toContain('|City:Kansas City|Region:Missouri|Country:US');
        expect(text).toContain('|Lat:39.0997|Lon:-94.5786');
    });

    it('still records the request without geo when the lookup fails', async () => {
        mockIpinfo.mockImplementation((ip, cb) => cb(new Error('ipinfo down'), null));

        await expect(checkIP(buildRequest({ ip: '203.0.113.22' }))).resolves.toBeUndefined();

        const text = lastItem().text;
        expect(text).toContain('IP:203.0.113.22');
        expect(text).not.toContain('|City:');
        expect(text).toContain('|RefererCategory:search_google');
    });

    it('strips the query string from the logged URL and never skips the TTL', async () => {
        await checkIP(buildRequest({ ip: '203.0.113.23' }));

        const item = lastItem();
        expect(item.text).toContain('|URL:/api/data/things');
        expect(item.text).not.toContain('token=secret');
        expect(item.expiresAt).toBeDefined();
    });

    it('does not write a row for localhost', async () => {
        await checkIP(buildRequest({ ip: '127.0.0.1' }));

        expect(mockPutCommand).not.toHaveBeenCalled();
    });

    it('does not write a row for a local dev frontend', async () => {
        await checkIP(buildRequest({
            ip: '203.0.113.24',
            headers: { origin: 'http://localhost:3000', 'user-agent': 'Mozilla/5.0' },
        }));

        expect(mockPutCommand).not.toHaveBeenCalled();
    });
});
