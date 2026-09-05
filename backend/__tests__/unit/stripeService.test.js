/**
 * stripeService.test.js — unit tests for the Stripe billing helpers added for
 * deferred cancellation / reactivation (cancel_at_period_end) and monthly vs.
 * annual price resolution (billingInterval).
 *
 * All Stripe + AWS dependencies are mocked, so this runs offline with no live
 * keys — same pattern as storageTracker.test.js / test-ocr.js.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
    PutCommand: jest.fn(),
    ScanCommand: jest.fn(),
    GetCommand: jest.fn(),
    QueryCommand: jest.fn(),
}));
jest.mock('../../utils/stripeInstance', () => ({
    getStripe: jest.fn(),
    isTestMode: jest.fn(),
    liveStripe: {},
}));
jest.mock('../../services/emailService', () => ({
    sendEmail: jest.fn(),
}));

const stripeService = require('../../services/stripeService');
const { getStripe, isTestMode } = require('../../utils/stripeInstance');

function makeStripe(overrides = {}) {
    return {
        subscriptions: {
            list: jest.fn().mockResolvedValue({ data: [] }),
            update: jest.fn().mockResolvedValue({ id: 'sub_1', cancel_at_period_end: false }),
        },
        products: {
            list: jest.fn().mockResolvedValue({ data: [] }),
            create: jest.fn().mockResolvedValue({ id: 'prod_test', name: 'Pro Membership' }),
            retrieve: jest.fn(),
        },
        prices: {
            list: jest.fn().mockResolvedValue({ data: [] }),
            create: jest.fn().mockResolvedValue({ id: 'price_test' }),
        },
        ...overrides,
    };
}

describe('stripeService subscription helpers', () => {
    let s;

    beforeAll(() => {
        // Ensure env-var price overrides can't leak in from the developer's shell.
        delete process.env.STRIPE_PRO_PRICE_ID;
        delete process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
        delete process.env.TEST_STRIPE_PRO_PRICE_ID;
        delete process.env.TEST_STRIPE_PRO_ANNUAL_PRICE_ID;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        s = makeStripe();
        getStripe.mockReturnValue(s);
        isTestMode.mockReturnValue(false);
    });

    describe('listActiveSubscriptions', () => {
        it('filters to active/trialing/past_due/incomplete and lists with status "all"', async () => {
            s.subscriptions.list.mockResolvedValue({
                data: [
                    { id: 's1', status: 'active' },
                    { id: 's2', status: 'canceled' },
                    { id: 's3', status: 'trialing' },
                    { id: 's4', status: 'incomplete_expired' },
                    { id: 's5', status: 'past_due' },
                ],
            });

            const subs = await stripeService.listActiveSubscriptions('cus_1', 'u1');

            expect(s.subscriptions.list).toHaveBeenCalledWith(
                expect.objectContaining({ customer: 'cus_1', status: 'all' })
            );
            expect(subs.map(x => x.id).sort()).toEqual(['s1', 's3', 's5']);
        });
    });

    describe('deferActiveSubscriptionsToPeriodEnd', () => {
        it('sets cancel_at_period_end on non-pending subs and skips already-pending ones', async () => {
            s.subscriptions.list.mockResolvedValue({
                data: [
                    { id: 's1', status: 'active', cancel_at_period_end: false },
                    { id: 's2', status: 'active', cancel_at_period_end: true },
                ],
            });

            const count = await stripeService.deferActiveSubscriptionsToPeriodEnd('cus_1', 'u1');

            expect(count).toBe(1);
            expect(s.subscriptions.update).toHaveBeenCalledTimes(1);
            expect(s.subscriptions.update).toHaveBeenCalledWith('s1', { cancel_at_period_end: true });
        });

        it('returns 0 without calling update when there are no active subscriptions', async () => {
            s.subscriptions.list.mockResolvedValue({ data: [] });

            const count = await stripeService.deferActiveSubscriptionsToPeriodEnd('cus_1', 'u1');

            expect(count).toBe(0);
            expect(s.subscriptions.update).not.toHaveBeenCalled();
        });
    });

    describe('reactivateSubscription', () => {
        it('un-cancels by setting cancel_at_period_end to false', async () => {
            s.subscriptions.update.mockResolvedValue({ id: 's1', cancel_at_period_end: false });

            const sub = await stripeService.reactivateSubscription('s1', 'u1');

            expect(s.subscriptions.update).toHaveBeenCalledWith('s1', { cancel_at_period_end: false });
            expect(sub.cancel_at_period_end).toBe(false);
        });
    });

    describe('getOrCreatePriceId — live mode', () => {
        it('returns the monthly price when billingInterval is month', async () => {
            isTestMode.mockReturnValue(false);
            s.prices.list.mockResolvedValue({
                data: [
                    { id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } },
                    { id: 'price_y', unit_amount: 14400, recurring: { interval: 'year' } },
                ],
            });

            const id = await stripeService.getOrCreatePriceId('pro', null, 'u1', 'month');

            expect(id).toBe('price_m');
        });

        it('returns the yearly price when billingInterval is year', async () => {
            isTestMode.mockReturnValue(false);
            s.prices.list.mockResolvedValue({
                data: [
                    { id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } },
                    { id: 'price_y', unit_amount: 14400, recurring: { interval: 'year' } },
                ],
            });

            const id = await stripeService.getOrCreatePriceId('pro', null, 'u1', 'year');

            expect(id).toBe('price_y');
        });

        it('throws when no yearly price exists', async () => {
            isTestMode.mockReturnValue(false);
            s.prices.list.mockResolvedValue({
                data: [{ id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } }],
            });

            await expect(stripeService.getOrCreatePriceId('pro', null, 'u1', 'year'))
                .rejects.toThrow(/yearly pricing/);
        });
    });

    describe('getOrCreatePriceId — test mode', () => {
        it('creates a $15/month price when none exists', async () => {
            isTestMode.mockReturnValue(true);
            s.products.list.mockResolvedValue({ data: [{ id: 'prod_test', name: 'Pro Membership' }] });
            s.prices.list.mockResolvedValue({ data: [] });
            s.prices.create.mockResolvedValue({ id: 'price_m_new', unit_amount: 1500, recurring: { interval: 'month' } });

            const id = await stripeService.getOrCreatePriceId('pro', null, 'u1', 'month');

            expect(s.prices.create).toHaveBeenCalledWith(
                expect.objectContaining({ unit_amount: 1500, recurring: { interval: 'month' } })
            );
            expect(id).toBe('price_m_new');
        });

        it('creates a $144/year price when none exists', async () => {
            isTestMode.mockReturnValue(true);
            s.products.list.mockResolvedValue({ data: [{ id: 'prod_test', name: 'Pro Membership' }] });
            s.prices.list.mockResolvedValue({ data: [] });
            s.prices.create.mockResolvedValue({ id: 'price_y_new', unit_amount: 14400, recurring: { interval: 'year' } });

            const id = await stripeService.getOrCreatePriceId('pro', null, 'u1', 'year');

            expect(s.prices.create).toHaveBeenCalledWith(
                expect.objectContaining({ unit_amount: 14400, recurring: { interval: 'year' } })
            );
            expect(id).toBe('price_y_new');
        });
    });
});
