/**
 * adminAccess.js — the server-side boundary between admin and Special accounts.
 *
 * Two names that sound alike and mean different things:
 *   admin   — the single ADMIN_USER_ID account: everything.
 *   Special — the `|Special:true` credits flag: four read-only admin views
 *             (Dashboard, Visitor map, Reviews, Page rankings) and nothing else.
 *
 * These tests pin the asymmetry, because the dangerous failure is silent: a
 * route switched to `requireAdminOrSpecial` by mistake would hand the users
 * list, the purchase gate or the data explorer to a credits perk.
 */

jest.mock('../../utils/apiUsageTracker', () => ({
    isSpecialUser: jest.fn(() => false),
    refreshUserDataCache: jest.fn(),
}));

jest.mock('../../middleware/authMiddleware', () => ({
    invalidateUserCache: jest.fn(),
}));

const { isSpecialUser, refreshUserDataCache } = require('../../utils/apiUsageTracker');
const { invalidateUserCache } = require('../../middleware/authMiddleware');
const {
    isAdminRequest,
    isSpecialRequest,
    isAdminOrSpecialRequest,
    requireAdmin,
    requireAdminOrSpecial,
    refreshAccessCaches,
} = require('../../middleware/adminAccess');

const ADMIN_ID = 'admin-account';
const SPECIAL_TEXT = 'Nickname:Helper|Email:helper@example.com|Password:x|Special:true';

/** Minimal Express req/res doubles. */
function mockReq(user) {
    return { user };
}
function mockRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(payload) {
            res.body = payload;
            return res;
        },
    };
    return res;
}

// File scope, not per-describe: the mock's return value decides whether a
// request is let through, so a value leaking out of one test silently changes
// the answer in the next one. It did — `mockReturnValue(true)` set in a
// predicates test made an ordinary account pass `requireAdminOrSpecial`.
beforeEach(() => {
    process.env.ADMIN_USER_ID = ADMIN_ID;
    isSpecialUser.mockReset();
    isSpecialUser.mockReturnValue(false);
    invalidateUserCache.mockReset();
    refreshUserDataCache.mockReset();
});

describe('adminAccess predicates', () => {
    test('the admin account is admin, not "special"', () => {
        const req = mockReq({ id: ADMIN_ID, text: 'Nickname:Owner' });
        expect(isAdminRequest(req)).toBe(true);
        expect(isSpecialRequest(req)).toBe(false);
    });

    test('a Special account is special, not admin', () => {
        isSpecialUser.mockImplementation((text) => /Special:true/.test(text || ''));
        const req = mockReq({ id: 'someone-else', text: SPECIAL_TEXT });
        expect(isAdminRequest(req)).toBe(false);
        expect(isSpecialRequest(req)).toBe(true);
    });

    test('reads the flag off req.user.text (no extra lookup)', () => {
        isSpecialUser.mockReturnValue(true);
        isSpecialRequest(mockReq({ id: 'x', text: SPECIAL_TEXT }));
        expect(isSpecialUser).toHaveBeenCalledWith(SPECIAL_TEXT);
    });

    test('tolerates a missing user (protect not run / not signed in)', () => {
        expect(isAdminRequest({})).toBe(false);
        expect(isSpecialRequest({})).toBe(false);
        expect(isAdminOrSpecialRequest({})).toBe(false);
        expect(isSpecialUser).not.toHaveBeenCalled();
    });
});

describe('requireAdmin', () => {
    test('lets the admin account through', () => {
        const next = jest.fn();
        requireAdmin(mockReq({ id: ADMIN_ID }), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('refuses a Special account — the write surfaces stay admin-only', () => {
        isSpecialUser.mockReturnValue(true);
        const res = mockRes();
        const next = jest.fn();
        requireAdmin(mockReq({ id: 'someone-else', text: SPECIAL_TEXT }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    test('refuses an ordinary account and an anonymous request', () => {
        const res = mockRes();
        const next = jest.fn();
        requireAdmin(mockReq({ id: 'nobody' }), res, next);
        requireAdmin({}, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});

describe('requireAdminOrSpecial', () => {
    test('lets the admin account through', () => {
        const next = jest.fn();
        requireAdminOrSpecial(mockReq({ id: ADMIN_ID }), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('lets a Special account through', () => {
        isSpecialUser.mockReturnValue(true);
        const next = jest.fn();
        requireAdminOrSpecial(mockReq({ id: 'someone-else', text: SPECIAL_TEXT }), mockRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('refuses an ordinary account and an anonymous request', () => {
        const res = mockRes();
        const next = jest.fn();
        requireAdminOrSpecial(mockReq({ id: 'nobody' }), res, next);
        requireAdminOrSpecial({}, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    test('a Special account without the flag in its text is still refused', () => {
        // The predicate reads the text blob, so "is special" and "was ever
        // flagged" are the same question — an ordinary signed-in account whose
        // text has no `|Special:true` must not get in.
        isSpecialUser.mockImplementation((text) => /(?:^|\|)Special:true/i.test(text || ''));
        const res = mockRes();
        const next = jest.fn();
        requireAdminOrSpecial(
            mockReq({ id: 'someone-else', text: 'Nickname:Helper|Email:h@example.com|Password:x' }),
            res,
            next,
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});

describe('refreshAccessCaches', () => {
    // The flag lives inside the record's `text`, so every cache holding that
    // record answers with the OLD value until its TTL expires. Forgetting the
    // auth one is invisible in production and expensive in both directions: a
    // freshly tagged account is refused for five minutes, and a *revoked* one
    // keeps its four views for five minutes.
    test('drops the auth cache the predicate reads through req.user.text', () => {
        refreshAccessCaches('user-1');
        expect(invalidateUserCache).toHaveBeenCalledWith('user-1');
    });

    test('also refreshes the credits cache when the written record is given', () => {
        const item = { id: 'user-1', text: 'Nickname:X|Email:x@example.com|Password:h|Special:true' };
        refreshAccessCaches('user-1', item);
        expect(refreshUserDataCache).toHaveBeenCalledWith('user-1', item);
    });

    test('skips the credits cache when there is no record to store', () => {
        refreshAccessCaches('user-1');
        expect(refreshUserDataCache).not.toHaveBeenCalled();
    });
});
