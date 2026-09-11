/**
 * Centralized pricing & plan configuration.
 * 
 * ALL plan names, storage limits, features, and quotas
 * are defined here.  Every other file should import from this module
 * instead of hard-coding values.
 *
 * The frontend mirror (frontend/src/constants/pricing.js) must keep the shared,
 * user-facing subset in sync — backend/__tests__/unit/pricingSync.test.js fails
 * CI if it drifts. Update SHARED_KEYS there when adding a shared constant.
 *
 * ►► VALUE BLOCK ◄◄ — the numbers you change live in ONE place:
 *   MONTHLY_PRICES / ANNUAL_PRICES   plan prices (USD)
 *   AI_CREDIT_ALLOWANCE              included monthly cloud-AI credits (USD)
 *   STORAGE_BYTES                    cloud-storage limit per plan (bytes)
 * Everything below (STORAGE_DISPLAY, FEATURES, FEATURES_PLAIN, DESCRIPTIONS,
 * COMPARISON, quotas) is DERIVED from those values — never hand-edit copy.
 *
 * AI credit allowances are also the metering limits: utils/apiUsageTracker.js
 * builds MEMBERSHIP_LIMITS from AI_CREDIT_ALLOWANCE.
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

/** Monthly plan price in dollars (also used for admin revenue estimation). */
const MONTHLY_PRICES = Object.freeze({
  [PLAN_IDS.FREE]: 0,
  [PLAN_IDS.PRO]:  15,
});

/** Annual plan price in dollars, for plans that offer a yearly cadence. */
const ANNUAL_PRICES = Object.freeze({
  [PLAN_IDS.FREE]: 0,
  [PLAN_IDS.PRO]:  144,
});

/**
 * Included monthly cloud-AI credit allowance in dollars — this is both the
 * displayed allowance and the real metering limit (see
 * utils/apiUsageTracker.js, which derives MEMBERSHIP_LIMITS from it).
 */
const AI_CREDIT_ALLOWANCE = Object.freeze({
  [PLAN_IDS.FREE]: 0.50,
  [PLAN_IDS.PRO]:  10.00,
});

/** Bounds for an admin-set per-user custom credit limit (USD). */
const MIN_CUSTOM_CREDIT_LIMIT = AI_CREDIT_ALLOWANCE[PLAN_IDS.FREE];
const MAX_CUSTOM_CREDIT_LIMIT = 10000;

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
// Storage (bytes) — VALUE BLOCK: change a number here only
// ──────────────────────────────────────────────
const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Canonical cloud-storage limit per plan, in bytes. */
const STORAGE_BYTES = Object.freeze({
  [PLAN_IDS.FREE]: 100 * MB,
  [PLAN_IDS.PRO]:  50 * GB,
});

/**
 * Storage limit keyed by every rank string that can appear in a stored user
 * record (plan id + display name + legacy aliases). Derived from
 * STORAGE_BYTES so it can never drift from the canonical values.
 */
const STORAGE_LIMITS = Object.freeze({
  ...Object.fromEntries(Object.entries(STORAGE_BYTES)),
  [PLAN_NAMES[PLAN_IDS.FREE]]: STORAGE_BYTES[PLAN_IDS.FREE],
  [PLAN_NAMES[PLAN_IDS.PRO]]:  STORAGE_BYTES[PLAN_IDS.PRO],
  Flex:    STORAGE_BYTES[PLAN_IDS.PRO],
  Premium: STORAGE_BYTES[PLAN_IDS.PRO],
  Simple:  STORAGE_BYTES[PLAN_IDS.PRO],
});

/** Human-readable storage label per plan, derived from STORAGE_BYTES. */
const STORAGE_DISPLAY = Object.freeze(
  Object.fromEntries(
    Object.values(PLAN_IDS).map((planId) => [planId, formatBytes(STORAGE_BYTES[planId])])
  )
);

// ──────────────────────────────────────────────
// Quotas (displayed on pricing page / emails)
// ──────────────────────────────────────────────
// The Simple addon runs entirely on the user's own PC — a locally-run
// automation command costs us nothing whether it's the 1st or the
// 5,000th, so there's no cost basis for a Free/Pro difference here.
// Both tiers get the same generous, anti-abuse-only technical limit.
const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]: 'Unlimited automation commands (fair use)',
  [PLAN_IDS.PRO]:  'Unlimited automation commands (fair use)',
});

// ──────────────────────────────────────────────
// Feature lists (DERIVED — edit the VALUE BLOCK above, not these strings)
// ──────────────────────────────────────────────
const AI_CHAT_FEATURE = (planId) =>
  `🌐 AI chat — ${formatUsd(AI_CREDIT_ALLOWANCE[planId])}/month cloud credits`;
const CLOUD_STORAGE_FEATURE = (planId, emoji) =>
  `${emoji} ${STORAGE_DISPLAY[planId]} cloud storage`;

const FEATURES = Object.freeze({
  [PLAN_IDS.FREE]: [
    AI_CHAT_FEATURE(PLAN_IDS.FREE),
    '🖥️ Simple desktop addon — unlimited local automation',
    CLOUD_STORAGE_FEATURE(PLAN_IDS.FREE, '📁'),
  ],
  [PLAN_IDS.PRO]: [
    '✅ Everything in Free',
    AI_CHAT_FEATURE(PLAN_IDS.PRO),
    '📱 Live screen viewing from your phone',
    CLOUD_STORAGE_FEATURE(PLAN_IDS.PRO, '💾'),
    '✉️ Email support',
  ],
});

/** Plain-text feature bullets (no emoji) for emails */
const FEATURES_PLAIN = Object.freeze({
  [PLAN_IDS.FREE]: [
    `AI chat — ${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.FREE])}/month cloud credits`,
    'Simple desktop addon — unlimited local automation',
    `${STORAGE_DISPLAY[PLAN_IDS.FREE]} cloud storage`,
  ],
  [PLAN_IDS.PRO]: [
    'Everything in Free',
    `AI chat — ${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.PRO])}/month cloud credits`,
    'Live screen viewing from your phone',
    `${STORAGE_DISPLAY[PLAN_IDS.PRO]} cloud storage`,
    'Email support',
  ],
});

// ──────────────────────────────────────────────
// Descriptions (used on pricing cards)
// ──────────────────────────────────────────────
const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]: `AI chat with included credits, unlimited local automation, and ${STORAGE_DISPLAY[PLAN_IDS.FREE]} storage`,
  [PLAN_IDS.PRO]:  `More AI credits, ${STORAGE_DISPLAY[PLAN_IDS.PRO]} storage, phone viewing, and email support`,
});

/** Pricing-page comparison table rows (shared with the frontend). */
const COMPARISON = Object.freeze([
  { feature: 'AI chat (cloud credits)', free: `${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.FREE])}/month`, pro: `${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.PRO])}/month` },
  { feature: 'Local automation (Simple addon)', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Cloud storage', free: STORAGE_DISPLAY[PLAN_IDS.FREE], pro: STORAGE_DISPLAY[PLAN_IDS.PRO] },
  { feature: 'Live screen viewing from phone', free: '—', pro: 'Included' },
  { feature: 'Email support', free: 'Self-serve', pro: 'Included' },
]);

// ──────────────────────────────────────────────
// Formatting helpers (used to derive the copy above + by consumers)
// ──────────────────────────────────────────────

/** 0.5 → '$0.50', 10 → '$10.00', 15 → '$15.00'. */
function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

/** 15 → '$15', 0 → '$0' (drops a trailing .00). */
function formatUsdCompact(amount) {
  const n = Number(amount);
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** 104857600 → '100 MB'; 53687091200 → '50 GB'. */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes >= GB) return `${bytes / GB} GB`;
  if (bytes >= MB) return `${bytes / MB} MB`;
  if (bytes >= 1024) return `${bytes / 1024} KB`;
  return `${bytes} B`;
}

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

/** True when `rank` is a paid tier. */
function isPaidTier(rank) {
  return isProTier(rank);
}

module.exports = {
  PLAN_IDS,
  PLAN_NAMES,
  MONTHLY_PRICES,
  ANNUAL_PRICES,
  AI_CREDIT_ALLOWANCE,
  MIN_CUSTOM_CREDIT_LIMIT,
  MAX_CUSTOM_CREDIT_LIMIT,
  LEGACY_ALIASES,
  PRO_RANKS,
  RANK_REGEX,
  STRIPE_PRODUCT_IDS,
  PLAN_TO_STRIPE_PRODUCT,
  STRIPE_PRODUCT_MAP,
  STORAGE_BYTES,
  STORAGE_LIMITS,
  STORAGE_DISPLAY,
  QUOTAS,
  FEATURES,
  FEATURES_PLAIN,
  DESCRIPTIONS,
  COMPARISON,
  formatUsd,
  formatUsdCompact,
  formatBytes,
  normalizePlanName,
  isProTier,
  isPaidTier,
};
