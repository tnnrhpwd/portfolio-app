/**
 * Centralized pricing & plan configuration.
 * 
 * ALL plan names, credit limits, storage limits, features, and quotas
 * are defined here.  Every other file should import from this module
 * instead of hard-coding values.
 *
 * Stripe product names are set in the Stripe dashboard and mapped
 * to internal plan IDs here.
 */

// ──────────────────────────────────────────────
// Plan IDs & names
// ──────────────────────────────────────────────
const PLAN_IDS = Object.freeze({
  FREE:   'free',
  PRO:    'pro',
  SIMPLE: 'simple',
});

const PLAN_NAMES = Object.freeze({
  [PLAN_IDS.FREE]:   'Free',
  [PLAN_IDS.PRO]:    'Pro',
  [PLAN_IDS.SIMPLE]: 'Simple',
});

/** Old rank strings that may still exist in DynamoDB records. */
const LEGACY_ALIASES = Object.freeze({
  Flex:    PLAN_NAMES[PLAN_IDS.PRO],     // 'Flex'    → 'Pro'
  Premium: PLAN_NAMES[PLAN_IDS.SIMPLE],  // 'Premium' → 'Simple'
});

/** All rank strings that should be treated as a given tier. */
const PRO_RANKS     = Object.freeze(['Pro', 'Flex']);
const SIMPLE_RANKS  = Object.freeze(['Simple', 'Premium']);

/** Regex that matches any stored rank string (used for text replacement). */
const RANK_REGEX = /(\|Rank:)(Free|Pro|Simple|Flex|Premium)/;

// ──────────────────────────────────────────────
// Stripe product → internal plan mapping
// ──────────────────────────────────────────────

/** Map Stripe product IDs to internal plan IDs (avoids extra API calls). */
const STRIPE_PRODUCT_IDS = Object.freeze({
  'prod_T5NvvJFzla8PSo': PLAN_IDS.PRO,     // Pro Membership – $12/mo
  'prod_T5NsEloas3D4yu': PLAN_IDS.SIMPLE,   // Simple Membership – $39/mo
});

/** Reverse lookup: internal plan ID → Stripe product ID. */
const PLAN_TO_STRIPE_PRODUCT = Object.freeze({
  [PLAN_IDS.PRO]:    'prod_T5NvvJFzla8PSo',
  [PLAN_IDS.SIMPLE]: 'prod_T5NsEloas3D4yu',
});

/** Map Stripe product display names → internal plan IDs (fallback). */
const STRIPE_PRODUCT_MAP = Object.freeze({
  'Pro Membership':    PLAN_IDS.PRO,
  'Simple Membership': PLAN_IDS.SIMPLE,
});

// ──────────────────────────────────────────────
// Credits / billing
// ──────────────────────────────────────────────
const CREDITS = Object.freeze({
  [PLAN_IDS.FREE]: {
    monthlyLimit: 0,
  },
  [PLAN_IDS.PRO]: {
    monthlyLimit: 0.50,      // $0.50/month
  },
  [PLAN_IDS.SIMPLE]: {
    defaultLimit: 10.00,     // $10.00 default custom limit
    minLimit:     0.50,      // minimum custom limit
  },
});

// ──────────────────────────────────────────────
// Storage (bytes)
// ──────────────────────────────────────────────
const STORAGE_LIMITS = Object.freeze({
  [PLAN_NAMES[PLAN_IDS.FREE]]:   100 * 1024 * 1024,           // 100 MB
  [PLAN_NAMES[PLAN_IDS.PRO]]:    5 * 1024 * 1024 * 1024,      // 5 GB
  [PLAN_NAMES[PLAN_IDS.SIMPLE]]: null,                         // Unlimited
  // backward compat keys that may exist in DB/lookups
  Flex:    5 * 1024 * 1024 * 1024,
  Premium: null,
});

const STORAGE_DISPLAY = Object.freeze({
  [PLAN_IDS.FREE]:   '100 MB',
  [PLAN_IDS.PRO]:    '5 GB',
  [PLAN_IDS.SIMPLE]: 'Unlimited',
});

// ──────────────────────────────────────────────
// Quotas (displayed on pricing page / emails)
// ──────────────────────────────────────────────
const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]:   '50 commands/day',
  [PLAN_IDS.PRO]:    '500 commands/day',
  [PLAN_IDS.SIMPLE]: 'Unlimited',
});

// ──────────────────────────────────────────────
// Feature lists (shown on pricing / emails)
// ──────────────────────────────────────────────
const FEATURES = Object.freeze({
  [PLAN_IDS.FREE]: [
    '🌐 /net AI chat (bring your own API key)',
    '🖥️ CSimple addon — 14-day free trial',
    `⚡ ${QUOTAS[PLAN_IDS.FREE].replace('commands/day', 'addon commands per day')}`,
    `📁 ${STORAGE_DISPLAY[PLAN_IDS.FREE]} cloud storage`,
  ],
  [PLAN_IDS.PRO]: [
    '✅ Everything in Free',
    `⚡ ${QUOTAS[PLAN_IDS.PRO].replace('commands/day', 'addon commands per day')}`,
    `📁 ${STORAGE_DISPLAY[PLAN_IDS.PRO]} cloud storage`,
    '📊 Full analytics dashboard',
    '📧 Email support',
  ],
  [PLAN_IDS.SIMPLE]: [
    '✅ Everything in Pro',
    '♾️ Unlimited addon commands',
    '📱 Phone → PC remote control',
    '💾 Unlimited cloud storage',
    '⭐ Priority support',
  ],
});

/** Plain-text feature bullets (no emoji) for emails */
const FEATURES_PLAIN = Object.freeze({
  [PLAN_IDS.FREE]: [
    'Basic features only',
    'Community support',
  ],
  [PLAN_IDS.PRO]: [
    `${QUOTAS[PLAN_IDS.PRO].replace('commands/day', 'addon commands per day')}`,
    `${STORAGE_DISPLAY[PLAN_IDS.PRO]} cloud storage`,
    'Full analytics dashboard',
    'Email support',
  ],
  [PLAN_IDS.SIMPLE]: [
    'Unlimited addon commands',
    'Phone → PC remote control',
    'Unlimited cloud storage',
    'Priority support',
  ],
});

// ──────────────────────────────────────────────
// Descriptions (used on pricing cards)
// ──────────────────────────────────────────────
const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]:   'Try the addon free for 14 days',
  [PLAN_IDS.PRO]:    'More addon power & storage for daily use',
  [PLAN_IDS.SIMPLE]: 'Unlimited addon with full PC automation',
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Normalize a rank string to the current plan name.
 * e.g. 'Flex' → 'Pro', 'Premium' → 'Simple'
 */
function normalizePlanName(rank) {
  return LEGACY_ALIASES[rank] || rank;
}

/** True when `rank` is Pro (or legacy Flex). */
function isProTier(rank) {
  return PRO_RANKS.includes(rank);
}

/** True when `rank` is Simple (or legacy Premium). */
function isSimpleTier(rank) {
  return SIMPLE_RANKS.includes(rank);
}

/** True when `rank` is a paid tier (Pro or Simple, including legacy names). */
function isPaidTier(rank) {
  return isProTier(rank) || isSimpleTier(rank);
}

module.exports = {
  PLAN_IDS,
  PLAN_NAMES,
  LEGACY_ALIASES,
  PRO_RANKS,
  SIMPLE_RANKS,
  RANK_REGEX,
  STRIPE_PRODUCT_IDS,
  PLAN_TO_STRIPE_PRODUCT,
  STRIPE_PRODUCT_MAP,
  CREDITS,
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
