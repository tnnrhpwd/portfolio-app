const rateLimit = require('express-rate-limit');

// Key generator for authenticated endpoints — rate-limit per user when
// possible (req.user is set by the `protect` middleware), falling back to IP.
// This prevents one user from exhausting another's rate-limit bucket.
const userKeyGenerator = (req) => req.user?.id || req.ip;

// Builds a 429 handler that reports *which* limiter tripped and *how long*
// until the caller can retry, so clients (and users) don't have to guess
// whether a generic "too many requests" message means "you abused this one
// feature" vs. "your IP/account hit the site-wide safety net". Without this,
// every limiter's message looked identical and gave no actionable timing.
function buildRateLimitHandler(limiterId, friendlyMessage) {
  return (req, res /*, next, options */) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
      : undefined;
    if (retryAfterSeconds) res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: friendlyMessage,
      limiter: limiterId,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  };
}

// General API rate limiter — applied globally (before auth, so IP-only).
// This is a site-wide safety net shared by ALL /api/ routes, independent of
// any feature-specific limiter (e.g. `llmLimiter`) further down the chain.
// The message calls that out explicitly so a user hitting this cap while
// using one feature doesn't assume that feature itself is over its limit.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: buildRateLimitHandler(
    'global-ip',
    'Too many requests from this network (general site-wide limit of 100 requests / 15 min, shared across all API calls — not specific to any one feature). Please wait a few minutes and try again.'
  ),
});

// Strict rate limiter for authentication endpoints (unauthenticated — IP-only)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('auth', 'Too many authentication attempts from this IP, please try again later.'),
});

// Payment endpoint rate limiter — per-user (runs after `protect`)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 payment requests per 15 min per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('payment', 'Too many payment requests. Please wait a few minutes before trying again.'),
});

// LLM / AI chat rate limiter — per-user (runs after `protect`)
const llmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 LLM requests per 15 min per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('llm', 'Too many AI requests for your account. Please wait a few minutes before trying again.'),
});

// OCR rate limiter — per-user, CPU-intensive
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 OCR requests per 15 min per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('ocr', 'Too many OCR requests. Please wait a few minutes before trying again.'),
});

// File upload rate limiter — per-user
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 uploads per 15 min per user
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('upload', 'Too many file uploads. Please wait a few minutes before trying again.'),
});

// Simple workspace read endpoints (GET list/item/context/telemetry).
// Per-user; generous since the web UI may poll the context preview.
const workspaceReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 120, // 2 req/sec average
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('workspace-read', 'Too many workspace read requests. Slow down.'),
});

// Simple workspace write endpoints (PUT/DELETE/POST log+action).
// Tighter: writes also hit DynamoDB + run server-side audit logging.
const workspaceWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 1 req/sec average
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('workspace-write', 'Too many workspace writes. Please slow down.'),
});

// Action ring-buffer append — the addon emits one per tool call so this
// needs to support bursts when the agent is active. Keep it firmly bounded
// to prevent a runaway loop from spamming DynamoDB.
const workspaceActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180, // 3 req/sec average; burst-friendly
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('workspace-action', 'Action log append rate exceeded.'),
});

// Simple marketplace read endpoints (search/browse/fetch). Per-user;
// generous since browsing may involve several quick lookups.
const marketReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 2 req/sec average
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('market-read', 'Too many marketplace read requests. Slow down.'),
});

// Simple marketplace publish endpoint — tighter than generic writes since
// each publish creates an immutable version record; author-scope spam
// limits are additionally enforced inside marketplaceController itself.
const marketPublishLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('market-publish', 'Too many publish requests. Please slow down.'),
});

// Simple marketplace install/rate/flag endpoints — per-user.
const marketWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler('market-write', 'Too many marketplace requests. Please slow down.'),
});

module.exports = {
  apiLimiter,
  authLimiter,
  paymentLimiter,
  llmLimiter,
  ocrLimiter,
  uploadLimiter,
  workspaceReadLimiter,
  workspaceWriteLimiter,
  workspaceActionLimiter,
  marketReadLimiter,
  marketPublishLimiter,
  marketWriteLimiter,
};
