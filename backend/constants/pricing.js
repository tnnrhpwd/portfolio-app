/**
 * Centralized pricing & plan configuration.
 * 
 * ALL plan names, storage limits, features, and quotas
 * are defined here.  Every other file should import from this module
 * instead of hard-coding values.
 *
 * Two tiers: Free and Pro ($15/mo).
 * AI usage is BYOK (Bring Your Own Key) — no platform credits.
 *
 * Stripe product names are set in the Stripe dashboard and mapped
 * to internal plan IDs here.
 */

// ──────────────────────────────────────────────
// Plan IDs & names
// ──────────────────────────────────────────────
const PLAN_IDS = Object.freeze({
  FREE: 'free',
  PRO:  'pro',
});

const PLAN_NAMES = Object.freeze({
  [PLAN_IDS.FREE]: 'Free',
  [PLAN_IDS.PRO]:  'Pro',
});

/** Monthly price in dollars (used for admin revenue estimation). */
const MONTHLY_PRICES = Object.freeze({
  [PLAN_IDS.FREE]: 0,
  [PLAN_IDS.PRO]:  15,
});

/** Old rank strings that may still exist in DynamoDB records. */
const LEGACY_ALIASES = Object.freeze({
  Flex:    'Pro',
  Premium: 'Pro',   // old "Simple"/"Premium" tier now maps to Pro
  Simple:  'Pro',   // old "Simple" tier now maps to Pro
});

/** All rank strings that should be treated as Pro tier. */
const PRO_RANKS = Object.freeze(['Pro', 'Flex', 'Simple', 'Premium']);

/** Regex that matches any stored rank string (used for text replacement). */
const RANK_REGEX = /(\|Rank:)(Free|Pro|Simple|Flex|Premium)/;

// ──────────────────────────────────────────────
// Stripe product → internal plan mapping
// ──────────────────────────────────────────────

/** Map Stripe product IDs to internal plan IDs (avoids extra API calls). */
const STRIPE_PRODUCT_IDS = Object.freeze({
  'prod_T5NvvJFzla8PSo': PLAN_IDS.PRO,   // legacy Pro product
  'prod_T5NsEloas3D4yu': PLAN_IDS.PRO,   // legacy Simple product → now Pro
});

/** Reverse lookup: internal plan ID → Stripe product ID. */
const PLAN_TO_STRIPE_PRODUCT = Object.freeze({
  [PLAN_IDS.PRO]: 'prod_T5NvvJFzla8PSo',
});

/** Map Stripe product display names → internal plan IDs (fallback). */
const STRIPE_PRODUCT_MAP = Object.freeze({
  'Pro Membership':    PLAN_IDS.PRO,
  'Simple Membership': PLAN_IDS.PRO,
});

// ──────────────────────────────────────────────
// Storage (bytes)
// ──────────────────────────────────────────────
const STORAGE_LIMITS = Object.freeze({
  // Primary keys: plan IDs
  [PLAN_IDS.FREE]: 100 * 1024 * 1024,           // 100 MB
  [PLAN_IDS.PRO]:  50 * 1024 * 1024 * 1024,     // 50 GB
  // Display-name keys (backward compat for DB lookups using user rank strings)
  Free:    100 * 1024 * 1024,
  Pro:     50 * 1024 * 1024 * 1024,
  // Legacy aliases
  Flex:    50 * 1024 * 1024 * 1024,
  Premium: 50 * 1024 * 1024 * 1024,
  Simple:  50 * 1024 * 1024 * 1024,
});

const STORAGE_DISPLAY = Object.freeze({
  [PLAN_IDS.FREE]: '100 MB',
  [PLAN_IDS.PRO]:  '50 GB',
});

// ──────────────────────────────────────────────
// Quotas (displayed on pricing page / emails)
// ──────────────────────────────────────────────
const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]: '50 automation commands/day',
  [PLAN_IDS.PRO]:  '5,000 automation commands/day',
});

// ──────────────────────────────────────────────
// Feature lists (shown on pricing / emails)
// ──────────────────────────────────────────────
const FEATURES = Object.freeze({
  [PLAN_IDS.FREE]: [
    '🌐 AI chat (bring your own API key)',
    '🖥️ CSimple addon — 14-day free trial',
    '⚡ 50 automation commands per day',
    '📁 100 MB cloud storage',
  ],
  [PLAN_IDS.PRO]: [
    '✅ Everything in Free',
    '🖥️ Full CSimple addon access',
    '⚡ 5,000 automation commands per day',
    '📱 Phone → PC remote control',
    '💾 50 GB cloud storage',
    '📊 Full analytics dashboard',
    '⭐ Priority email support',
  ],
});

/** Plain-text feature bullets (no emoji) for emails */
const FEATURES_PLAIN = Object.freeze({
  [PLAN_IDS.FREE]: [
    'AI chat (bring your own API key)',
    '14-day addon trial',
    '50 automation commands per day',
    '100 MB cloud storage',
  ],
  [PLAN_IDS.PRO]: [
    'Full CSimple addon access',
    '5,000 automation commands per day',
    'Phone to PC remote control',
    '50 GB cloud storage',
    'Full analytics dashboard',
    'Priority email support',
  ],
});

// ──────────────────────────────────────────────
// Descriptions (used on pricing cards)
// ──────────────────────────────────────────────
const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]: 'Try the addon free for 14 days',
  [PLAN_IDS.PRO]:  'Full Windows automation with priority support',
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Normalize a rank string to the current plan name.
 * e.g. 'Flex' → 'Pro', 'Premium' → 'Pro', 'Simple' → 'Pro'
 */
function normalizePlanName(rank) {
  return LEGACY_ALIASES[rank] || rank;
}

/** True when `rank` is Pro (including legacy Flex/Simple/Premium). */
function isProTier(rank) {
  return PRO_RANKS.includes(rank);
}

/** @deprecated — kept for backward compat. Now identical to isProTier. */
function isSimpleTier(rank) {
  return isProTier(rank);
}

/** True when `rank` is a paid tier. */
function isPaidTier(rank) {
  return isProTier(rank);
}

module.exports = {
  PLAN_IDS,
  PLAN_NAMES,
  MONTHLY_PRICES,
  LEGACY_ALIASES,
  PRO_RANKS,
  RANK_REGEX,
  STRIPE_PRODUCT_IDS,
  PLAN_TO_STRIPE_PRODUCT,
  STRIPE_PRODUCT_MAP,
  STORAGE_LIMITS,
  STORAGE_DISPLAY,
  QUOTAS,
  FEATURES,
  FEATURES_PLAIN,
  DESCRIPTIONS,
  normalizePlanName,
  isProTier,
  isSimpleTier,
  isPaidTier,
};
