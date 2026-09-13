/**
 * adminAccess.js — who may reach which admin surface.
 *
 * Two distinct things are being confused by name, so they live together here:
 *
 * - **Admin** — the single `ADMIN_USER_ID` account. Full access to everything.
 * - **Special** — the `|Special:true` flag an admin can toggle on a user
 *   (`PUT /admin/users/:id/special`). It exists to grant unlimited API credits
 *   (see `utils/apiUsageTracker.isSpecialUser`), and since 2026-09-12 it also
 *   grants **read-only access to four admin views**: Dashboard, Visitor map,
 *   Reviews and Page rankings.
 *
 * The read-only/vs-full split is enforced twice, on purpose:
 *
 * 1. **Here**, per route, so a Special account can only reach the endpoints the
 *    four views actually call — not the users list, the purchase gate, the data
 *    explorer, the funnel tester, the bug-fixing tools or Deep Storage.
 * 2. **In the client** (`frontend/src/constants/admin.js`), so the console's
 *    navigation only offers what the server will serve.
 *
 * The client check is cosmetic — it stops a Special user seeing tabs that would
 * 403. This file is the actual boundary: never rely on the client alone.
 *
 * "Special" is a *billing/credits* concept, deliberately narrower than admin.
 * Do not widen a second route to this middleware without deciding, explicitly,
 * that a credits perk should see that data too.
 */

const { isSpecialUser, refreshUserDataCache } = require('../utils/apiUsageTracker');

/**
 * Is this request from the single admin account?
 * @param {Object} req Express request (must have run `protect` first)
 */
function isAdminRequest(req) {
    return !!(req.user && req.user.id === process.env.ADMIN_USER_ID);
}

/**
 * Is this request from an account flagged Special?
 *
 * `protect` attaches the whole (password-redacted) user record to `req.user`,
 * so the flag can be read straight off `req.user.text` — no extra lookup.
 * @param {Object} req Express request (must have run `protect` first)
 */
function isSpecialRequest(req) {
    return !!(req.user && isSpecialUser(req.user.text || ''));
}

/** Full admin or granted Special read access. */
function isAdminOrSpecialRequest(req) {
    return isAdminRequest(req) || isSpecialRequest(req);
}

/** Reject unless the request is from the admin account. */
function requireAdmin(req, res, next) {
    if (!isAdminRequest(req)) {
        return res.status(403).json({ dataMessage: 'Forbidden: admin access required' });
    }
    next();
}

/**
 * Reject unless the request is from the admin account or a Special account.
 * Use this only on the read endpoints behind Dashboard / Visitor map / Reviews /
 * Page rankings.
 */
function requireAdminOrSpecial(req, res, next) {
    if (!isAdminOrSpecialRequest(req)) {
        return res.status(403).json({ dataMessage: 'Forbidden: admin access required' });
    }
    next();
}

/**
 * Drop every cached copy of a user record that a Special toggle invalidates.
 *
 * The flag does not live in a column of its own — it is the literal
 * `|Special:true` inside the record's `text` blob — so anything holding a copy of
 * that record keeps serving the OLD answer until its own TTL expires. Two things
 * hold one, and both of them are load-bearing here:
 *
 * - `middleware/authMiddleware` caches the record it attaches to `req.user` for
 *   five minutes, and `isSpecialRequest` above reads the flag straight off
 *   `req.user.text`. Skip this one and a freshly tagged account is still refused
 *   by `requireAdminOrSpecial` for up to five minutes — and, closing the other
 *   direction, a *revoked* account keeps its access for up to five minutes.
 * - `utils/apiUsageTracker` caches its own copy for the credits path.
 *
 * Call this immediately after the write that changes the flag.
 *
 * @param {string} userId
 * @param {Object} [updatedItem] the record that was just written
 */
function refreshAccessCaches(userId, updatedItem) {
    // Required lazily on purpose: `authMiddleware` builds a DynamoDB client and
    // starts a cache-cleanup interval the moment it is imported, and this module
    // is also loaded by unit tests that have no business starting either.
    const { invalidateUserCache } = require('./authMiddleware');
    invalidateUserCache(userId);
    if (updatedItem) refreshUserDataCache(userId, updatedItem);
}

module.exports = {
    isAdminRequest,
    isSpecialRequest,
    isAdminOrSpecialRequest,
    requireAdmin,
    requireAdminOrSpecial,
    refreshAccessCaches,
};
