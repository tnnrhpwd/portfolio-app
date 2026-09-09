/**
 * apiUsageTracker.test.js — unit tests for the §8 monetization credit
 * state-machine helpers (backend/utils/apiUsageTracker.js):
 *   - getMembershipLimit(rank)          → per-tier monthly USD cap
 *   - needsMonthlyReset(credits, ...)   → when to top-off / roll over
 *   - performMonthlyReset(credits, ...) → the top-off (free / paid / expired)
 *
 * These cover the free / paid / expired / grace-period states the §8.1
 * checklist calls for, at the pure-function level (no DynamoDB / Stripe
 * network calls — the AWS SDK, Stripe, and logger boundaries are mocked).
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => ({ send: jest.fn() })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
    ScanCommand: jest.fn(),
    PutCommand: jest.fn(),
    GetCommand: jest.fn(),
    QueryCommand: jest.fn(),
}));
jest.mock('./stripeInstance', () => ({
    getStripe: jest.fn(),
    liveStripe: {},
}));
jest.mock('./logger', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
    getMembershipLimit,
    needsMonthlyReset,
    performMonthlyReset,
    MEMBERSHIP_LIMITS,
} = require('./apiUsageTracker');

const NOW_ISO = new Date().toISOString();
const FRESH_RESET = NOW_ISO;
const OLD_RESET = '2020-01-15T00:00:00.000Z';

describe('getMembershipLimit — per-tier monthly cap', () => {
    it('maps Free to the Free allowance', () => {
        expect(getMembershipLimit('Free')).toBe(MEMBERSHIP_LIMITS.Free);
        expect(getMembershipLimit('Free')).toBe(0.5);
    });

    it('maps Pro (and legacy aliases) to the Pro allowance', () => {
        expect(getMembershipLimit('Pro')).toBe(MEMBERSHIP_LIMITS.Pro);
        expect(getMembershipLimit('Simple')).toBe(MEMBERSHIP_LIMITS.Pro);
        expect(getMembershipLimit('Premium')).toBe(MEMBERSHIP_LIMITS.Pro);
        expect(getMembershipLimit('Flex')).toBe(MEMBERSHIP_LIMITS.Pro);
    });

    it('falls back to Free for unknown ranks', () => {
        expect(getMembershipLimit('nonsense')).toBe(MEMBERSHIP_LIMITS.Free);
    });
});

describe('needsMonthlyReset — when to top-off / roll over', () => {
    it('requires a reset when there is no lastReset (brand-new user)', () => {
        expect(needsMonthlyReset({ lastReset: null }, 'Free', 0.5)).toBe(true);
    });

    it('requires a reset when the last reset is over a month old (expired period)', () => {
        expect(needsMonthlyReset({ lastReset: OLD_RESET, appliedLimit: 0.5 }, 'Free', 0.5)).toBe(true);
    });

    it('does NOT require a reset for a fresh, unchanged period', () => {
        expect(needsMonthlyReset({ lastReset: FRESH_RESET, appliedLimit: 0.5 }, 'Free', 0.5)).toBe(false);
    });

    it('requires a top-off when the plan limit changed since it was applied (limit raised)', () => {
        expect(needsMonthlyReset(
            { lastReset: FRESH_RESET, appliedLimit: 0.5, customLimit: null },
            'Free',
            10,
        )).toBe(true);
    });

    it('does NOT top-off on a plan-limit change when a custom limit is set', () => {
        expect(needsMonthlyReset(
            { lastReset: FRESH_RESET, appliedLimit: 0.5, customLimit: 3 },
            'Free',
            10,
        )).toBe(false);
    });
});

describe('performMonthlyReset — the top-off', () => {
    it('tops Free up to the Free allowance regardless of subscription status', () => {
        const credits = { availableCredits: 0.01, lastReset: null };
        performMonthlyReset(credits, 'Free', false);
        expect(credits.availableCredits).toBe(MEMBERSHIP_LIMITS.Free);
        expect(credits.membershipLevel).toBe('Free');
        expect(credits.appliedLimit).toBe(MEMBERSHIP_LIMITS.Free);
        expect(credits.lastReset).toBeTruthy();
    });

    it('tops an ACTIVE Pro subscription up to the Pro allowance (paid state)', () => {
        const credits = { availableCredits: 0, lastReset: null };
        performMonthlyReset(credits, 'Pro', true);
        expect(credits.availableCredits).toBe(MEMBERSHIP_LIMITS.Pro);
        expect(credits.membershipLevel).toBe('Pro');
        expect(credits.appliedLimit).toBe(MEMBERSHIP_LIMITS.Pro);
    });

    it('does NOT grant fresh Pro credits to a lapsed subscription (expired state)', () => {
        const credits = { availableCredits: 0.02, lastReset: OLD_RESET };
        const before = { ...credits };
        performMonthlyReset(credits, 'Pro', false);
        expect(credits).toEqual(before); // unchanged — no free Pro top-off on expiry
    });

    it('honors a custom limit over the plan default', () => {
        const credits = { availableCredits: 0, lastReset: null, customLimit: 3 };
        performMonthlyReset(credits, 'Free', true);
        expect(credits.availableCredits).toBe(3);
        expect(credits.appliedLimit).toBe(MEMBERSHIP_LIMITS.Free);
    });
});
