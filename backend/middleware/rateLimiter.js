const rateLimit = require('express-rate-limit');

// Key generator for authenticated endpoints — rate-limit per user when
// possible (req.user is set by the `protect` middleware), falling back to IP.
// This prevents one user from exhausting another's rate-limit bucket.
const userKeyGenerator = (req) => req.user?.id || req.ip;

// General API rate limiter — applied globally (before auth, so IP-only)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strict rate limiter for authentication endpoints (unauthenticated — IP-only)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Payment endpoint rate limiter — per-user (runs after `protect`)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 payment requests per 15 min per user
  keyGenerator: userKeyGenerator,
  message: {
    error: 'Too many payment requests. Please wait a few minutes before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// LLM / AI chat rate limiter — per-user (runs after `protect`)
const llmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 LLM requests per 15 min per user
  keyGenerator: userKeyGenerator,
  message: {
    error: 'Too many AI requests. Please wait a few minutes before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OCR rate limiter — per-user, CPU-intensive
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 OCR requests per 15 min per user
  keyGenerator: userKeyGenerator,
  message: {
    error: 'Too many OCR requests. Please wait a few minutes before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// File upload rate limiter — per-user
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 uploads per 15 min per user
  keyGenerator: userKeyGenerator,
  message: {
    error: 'Too many file uploads. Please wait a few minutes before trying again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSimple workspace read endpoints (GET list/item/context/telemetry).
// Per-user; generous since the web UI may poll the context preview.
const workspaceReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 120, // 2 req/sec average
  keyGenerator: userKeyGenerator,
  message: { error: 'Too many workspace read requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSimple workspace write endpoints (PUT/DELETE/POST log+action).
// Tighter: writes also hit DynamoDB + run server-side audit logging.
const workspaceWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 1 req/sec average
  keyGenerator: userKeyGenerator,
  message: { error: 'Too many workspace writes. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Action ring-buffer append — the addon emits one per tool call so this
// needs to support bursts when the agent is active. Keep it firmly bounded
// to prevent a runaway loop from spamming DynamoDB.
const workspaceActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180, // 3 req/sec average; burst-friendly
  keyGenerator: userKeyGenerator,
  message: { error: 'Action log append rate exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSimple marketplace read endpoints (search/browse/fetch). Per-user;
// generous since browsing may involve several quick lookups.
const marketReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 2 req/sec average
  keyGenerator: userKeyGenerator,
  message: { error: 'Too many marketplace read requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSimple marketplace publish endpoint — tighter than generic writes since
// each publish creates an immutable version record; author-scope spam
// limits are additionally enforced inside marketplaceController itself.
const marketPublishLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  message: { error: 'Too many publish requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// CSimple marketplace install/rate/flag endpoints — per-user.
const marketWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userKeyGenerator,
  message: { error: 'Too many marketplace requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
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
