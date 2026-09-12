/**
 * analyticsRetention.js — how long the high-volume analytics rows live.
 *
 * The `Simple` table is one shared table: alongside durable records (users,
 * workspace items, goals, plans, tickets) it holds rows written *per request* —
 * one visitor row for every `checkIP()` call and one row for every page-view
 * beacon. Those two writers dominate row count and grow without bound, which is
 * the cost/scale problem this module exists to bound.
 *
 * A row is given an `expiresAt` epoch-seconds attribute, which DynamoDB TTL
 * deletes automatically. Two properties make that safe on a shared table:
 *
 *  1. TTL only ever deletes items that *carry* the attribute, so durable rows
 *     (which don't) can never be expired by it.
 *  2. The delete is a background best-effort sweep (typically within 48h of the
 *     timestamp), not a hard deadline — which is why retention is measured in
 *     days and no read path may *rely* on a row already being gone. The admin
 *     dashboard only looks at 7/30-day windows, comfortably inside the default.
 *
 * Enabling the table-side TTL is a one-off ops step:
 *   node backend/scripts/configure-analytics-ttl.js --apply
 *
 * Tunable (env): ANALYTICS_RETENTION_DAYS (default 90).
 */

const DEFAULT_RETENTION_DAYS = 90;
const SECONDS_PER_DAY = 24 * 60 * 60;

// The attribute the table's TTL must be configured on. Exported so the writers
// (accessData, pageViewsController) and the ops script that enables it
// (scripts/configure-analytics-ttl.js) can't drift — a mismatched name would
// silently expire nothing.
const TTL_ATTRIBUTE = 'expiresAt';

/** Retention window in days, from env with a sane fallback. */
function retentionDays() {
    const raw = parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

/**
 * Millisecond timestamp for anything a caller might hand us. `Date.parse`
 * only accepts a string, so numbers are handled explicitly rather than being
 * coerced to "1782..." and silently yielding NaN.
 */
function toMillis(createdAt) {
    if (createdAt instanceof Date) return createdAt.getTime();
    if (typeof createdAt === 'number') return createdAt;
    return Date.parse(createdAt);
}

/**
 * Epoch-seconds `expiresAt` for a row created at `createdAt`.
 *
 * DynamoDB TTL requires a Number in epoch *seconds*. An unparseable `createdAt`
 * falls back to "now" rather than producing NaN — a NaN attribute is silently
 * ignored by TTL, which would quietly reinstate the unbounded growth this
 * function exists to prevent.
 *
 * @param {string|number|Date} [createdAt] ISO string, ms timestamp, or Date
 * @param {number} [days]
 * @returns {number} epoch seconds
 */
function expiresAtSeconds(createdAt = Date.now(), days = retentionDays()) {
    const parsed = toMillis(createdAt);
    const baseMs = Number.isFinite(parsed) ? parsed : Date.now();
    const windowDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;

    return Math.floor(baseMs / 1000) + windowDays * SECONDS_PER_DAY;
}

module.exports = {
    DEFAULT_RETENTION_DAYS,
    TTL_ATTRIBUTE,
    retentionDays,
    expiresAtSeconds,
};
