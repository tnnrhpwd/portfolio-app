/**
 * geoLookup.test.js — behaviour of the cached IP→geo helper
 * (backend/utils/geoLookup.js).
 *
 * This module sits on two hot paths and is easy to get subtly wrong:
 *
 *  1. It is awaited by `checkIP()` inside *every* non-localhost API request, so
 *     the cache is what keeps a third-party HTTP call (ipinfo) off the request
 *     path. If the cache or the timeout regresses, request latency regresses
 *     with it.
 *  2. Its failure path must *resolve null*, never throw. Callers (the home-title
 *     resolver, the access log) treat "no geo" as a normal, expected state; a
 *     rejection here turns a missing lookup into a lost feature.
 *
 * The `ipinfo` package is mocked so these tests stay offline and deterministic.
 * The module is re-required per test (via loadGeoLookup) because its cache is
 * module-level state — sharing it across tests would hide cache bugs.
 */

const mockIpinfo = jest.fn();
jest.mock('ipinfo', () => (...args) => mockIpinfo(...args));

/** Fresh module instance, with an empty cache. */
function loadGeoLookup() {
    let mod;
    jest.isolateModules(() => {
        mod = require('../../utils/geoLookup');
    });
    return mod;
}

/** A successful ipinfo payload (field names as the real API returns them). */
const IPINFO_OK = {
    city: 'Kansas City',
    region: 'Missouri',
    country: 'US',
    loc: '39.0997,-94.5786',
};

describe('getGeoForIp', () => {
    beforeEach(() => {
        mockIpinfo.mockReset();
        // Keep the timeout path instant in tests.
        process.env.GEO_TIMEOUT_MS = '50';
    });

    afterEach(() => {
        delete process.env.GEO_TIMEOUT_MS;
    });

    it('returns the location *and* coordinates the visitor map needs', async () => {
        mockIpinfo.mockImplementation((ip, cb) => cb(null, IPINFO_OK));
        const { getGeoForIp } = loadGeoLookup();

        const geo = await getGeoForIp('203.0.113.9');

        expect(geo).toMatchObject({
            city: 'Kansas City',
            region: 'Missouri',
            country: 'US',
            lat: 39.0997,
            lon: -94.5786,
        });
    });

    it('tolerates a payload with no coordinates', async () => {
        mockIpinfo.mockImplementation((ip, cb) => cb(null, { city: 'Nowhere', region: '', country: 'US' }));
        const { getGeoForIp } = loadGeoLookup();

        const geo = await getGeoForIp('203.0.113.11');

        expect(geo).toMatchObject({ city: 'Nowhere', country: 'US' });
        expect(geo.lat).toBeUndefined();
        expect(geo.lon).toBeUndefined();
    });

    it('resolves null — never throws — when the lookup fails', async () => {
        mockIpinfo.mockImplementation((ip, cb) => cb(new Error('ipinfo rate limit'), null));
        const { getGeoForIp } = loadGeoLookup();

        await expect(getGeoForIp('203.0.113.10')).resolves.toBeNull();
    });

    it('resolves null when ipinfo never calls back', async () => {
        mockIpinfo.mockImplementation(() => { /* hung request */ });
        const { getGeoForIp } = loadGeoLookup();

        await expect(getGeoForIp('203.0.113.12')).resolves.toBeNull();
    });

    it('does not look up localhost or a missing IP', async () => {
        const { getGeoForIp } = loadGeoLookup();

        await expect(getGeoForIp('127.0.0.1')).resolves.toBeNull();
        await expect(getGeoForIp('::1')).resolves.toBeNull();
        await expect(getGeoForIp('')).resolves.toBeNull();
        await expect(getGeoForIp(undefined)).resolves.toBeNull();

        expect(mockIpinfo).not.toHaveBeenCalled();
    });

    it('serves repeat lookups of the same IP from cache', async () => {
        mockIpinfo.mockImplementation((ip, cb) => cb(null, IPINFO_OK));
        const { getGeoForIp } = loadGeoLookup();

        const first = await getGeoForIp('203.0.113.13');
        const second = await getGeoForIp('203.0.113.13');

        expect(mockIpinfo).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('caches a miss briefly instead of re-calling ipinfo on every request', async () => {
        mockIpinfo.mockImplementation(() => { /* hung */ });
        const { getGeoForIp } = loadGeoLookup();

        await getGeoForIp('203.0.113.14');
        await getGeoForIp('203.0.113.14');

        expect(mockIpinfo).toHaveBeenCalledTimes(1);
    });
});

describe('extractIp', () => {
    it("prefers req.ip, which Express derives from the trusted proxy hop", () => {
        const { extractIp } = loadGeoLookup();

        // A spoofable, client-supplied XFF header must not win over req.ip.
        const ip = extractIp({
            ip: '203.0.113.5',
            headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.5' },
            connection: { remoteAddress: '10.0.0.1' },
        });

        expect(ip).toBe('203.0.113.5');
    });

    it('falls back to the leftmost XFF entry when req.ip is absent', () => {
        const { extractIp } = loadGeoLookup();

        const ip = extractIp({
            headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.5' },
            connection: { remoteAddress: '10.0.0.1' },
        });

        expect(ip).toBe('198.51.100.9');
    });

    it('falls back to the socket address, then normalizes IPv6 localhost', () => {
        const { extractIp } = loadGeoLookup();

        expect(extractIp({ headers: {}, socket: { remoteAddress: '10.0.0.2' } })).toBe('10.0.0.2');
        expect(extractIp({ headers: {}, socket: { remoteAddress: '::1' } })).toBe('127.0.0.1');
    });

    it('does not throw on a bare request object', () => {
        const { extractIp } = loadGeoLookup();

        expect(() => extractIp({ headers: {} })).not.toThrow();
    });
});
