/**
 * analyticsRetention.test.js — the retention window shared by the two
 * per-request analytics writers (visitor rows in utils/accessData.js and
 * page-view rows in controllers/pageViewsController.js).
 *
 * The important property is negative: `expiresAt` must never come out as NaN or
 * a string. DynamoDB TTL silently ignores both, so a regression here would not
 * fail loudly — it would just quietly restore the unbounded table growth the
 * attribute exists to stop.
 */

const {
    DEFAULT_RETENTION_DAYS,
    retentionDays,
    expiresAtSeconds,
} = require('../../utils/analyticsRetention');

const SECONDS_PER_DAY = 24 * 60 * 60;

describe('retentionDays', () => {
    afterEach(() => {
        delete process.env.ANALYTICS_RETENTION_DAYS;
    });

    it('defaults to 90 days', () => {
        expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS);
        expect(DEFAULT_RETENTION_DAYS).toBe(90);
    });

    it('honours ANALYTICS_RETENTION_DAYS', () => {
        process.env.ANALYTICS_RETENTION_DAYS = '14';
        expect(retentionDays()).toBe(14);
    });

    it.each(['', '0', '-5', 'soon', 'NaN'])(
        'falls back to the default for an unusable env value (%p)',
        (value) => {
            process.env.ANALYTICS_RETENTION_DAYS = value;
            expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS);
        }
    );
});

describe('expiresAtSeconds', () => {
    afterEach(() => {
        delete process.env.ANALYTICS_RETENTION_DAYS;
    });

    it('returns epoch seconds, window days after the row was created', () => {
        const createdAt = '2026-09-12T10:00:00.000Z';
        const base = Math.floor(Date.parse(createdAt) / 1000);

        expect(expiresAtSeconds(createdAt, 90)).toBe(base + 90 * SECONDS_PER_DAY);
    });

    it('defaults to the env-configured window', () => {
        process.env.ANALYTICS_RETENTION_DAYS = '7';
        const createdAt = '2026-09-12T10:00:00.000Z';

        expect(expiresAtSeconds(createdAt))
            .toBe(Math.floor(Date.parse(createdAt) / 1000) + 7 * SECONDS_PER_DAY);
    });

    it('is a Number, as DynamoDB TTL requires', () => {
        expect(typeof expiresAtSeconds(new Date().toISOString())).toBe('number');
    });

    it('accepts a Date and a timestamp', () => {
        const date = new Date('2026-01-01T00:00:00.000Z');
        const expected = Math.floor(date.getTime() / 1000) + 90 * SECONDS_PER_DAY;

        expect(expiresAtSeconds(date, 90)).toBe(expected);
        expect(expiresAtSeconds(date.getTime(), 90)).toBe(expected);
    });

    it('never produces NaN or a string for an unparseable createdAt', () => {
        const before = Math.floor(Date.now() / 1000) + 90 * SECONDS_PER_DAY;

        const result = expiresAtSeconds('not a date');

        expect(Number.isNaN(result)).toBe(false);
        expect(typeof result).toBe('number');
        // Falls back to "now + window" rather than dropping the TTL entirely.
        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThanOrEqual(before + 5);
    });

    it('never produces NaN for an unusable window', () => {
        const result = expiresAtSeconds('2026-09-12T10:00:00.000Z', NaN);

        expect(Number.isNaN(result)).toBe(false);
        expect(result).toBe(
            Math.floor(Date.parse('2026-09-12T10:00:00.000Z') / 1000)
            + DEFAULT_RETENTION_DAYS * SECONDS_PER_DAY
        );
    });
});
