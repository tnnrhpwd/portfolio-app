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

module.exports = {
  apiLimiter,
  authLimiter,
  paymentLimiter,
  llmLimiter,
  ocrLimiter,
  uploadLimiter
};
