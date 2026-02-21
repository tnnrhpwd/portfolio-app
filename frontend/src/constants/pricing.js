/**
 * Centralized pricing & plan configuration – frontend mirror.
 *
 * Keep in sync with backend/constants/pricing.js.
 * All plan names, credit limits, quotas, and feature lists are
 * defined here so every component imports from one place.
 */

// ──────────────────────────────────────────────
// Plan IDs & display names
// ──────────────────────────────────────────────
export const PLAN_IDS = Object.freeze({
  FREE:   'free',
  PRO:    'pro',
  SIMPLE: 'simple',
});

export const PLAN_NAMES = Object.freeze({
  [PLAN_IDS.FREE]:   'Free',
  [PLAN_IDS.PRO]:    'Pro',
  [PLAN_IDS.SIMPLE]: 'Simple',
});

/** Old rank strings still stored in some DynamoDB records. */
export const LEGACY_ALIASES = Object.freeze({
  Flex:    'Pro',
  Premium: 'Simple',
});

/** All rank strings that map to a given tier. */
export const PRO_RANKS    = Object.freeze(['Pro', 'Flex']);
export const SIMPLE_RANKS = Object.freeze(['Simple', 'Premium']);

// ──────────────────────────────────────────────
// Credits / billing
// ──────────────────────────────────────────────
export const CREDITS = Object.freeze({
  [PLAN_IDS.FREE]: {
    monthlyLimit: 0,
    display: '$0.00',
  },
  [PLAN_IDS.PRO]: {
    monthlyLimit: 0.50,
    display: '$0.50',
  },
  [PLAN_IDS.SIMPLE]: {
    defaultLimit: 10.00,
    display: '$10.00',
  },
});

// ──────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────
export const STORAGE_DISPLAY = Object.freeze({
  [PLAN_IDS.FREE]:   '100 MB',
  [PLAN_IDS.PRO]:    '5 GB',
  [PLAN_IDS.SIMPLE]: '50 GB',
});

// ──────────────────────────────────────────────
// Quotas
// ──────────────────────────────────────────────
export const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]:   '50 commands/day',
  [PLAN_IDS.PRO]:    '500 commands/day',
  [PLAN_IDS.SIMPLE]: '5,000 commands/day',
});

/** Short quota descriptions used in comparison strings */
export const QUOTA_SHORT = Object.freeze({
  [PLAN_IDS.FREE]:   '50 cmds/day',
  [PLAN_IDS.PRO]:    '500 cmds/day',
  [PLAN_IDS.SIMPLE]: '5,000 cmds/day',
});

// ──────────────────────────────────────────────
// Plan features
// ──────────────────────────────────────────────
export const FEATURES = Object.freeze({
  [PLAN_IDS.FREE]: [
    '🌐 /net AI chat (bring your own API key)',
    '🖥️ CSimple addon — 14-day free trial',
    '⚡ 50 addon commands per day',
    '📁 100 MB cloud storage',
  ],
  [PLAN_IDS.PRO]: [
    '✅ Everything in Free',
    '⚡ 500 addon commands per day',
    '📁 5 GB cloud storage',
    '📊 Full analytics dashboard',
    '📧 Email support',
  ],
  [PLAN_IDS.SIMPLE]: [
    '✅ Everything in Pro',
    '♾️ 5,000 addon commands per day',
    '📱 Phone → PC remote control',
    '💾 50 GB cloud storage',
    '⭐ Priority support',
  ],
});

// ──────────────────────────────────────────────
// Descriptions (pricing cards)
// ──────────────────────────────────────────────
export const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]:   'Try the addon free for 14 days',
  [PLAN_IDS.PRO]:    'More addon power & storage for daily use',
  [PLAN_IDS.SIMPLE]: 'Full PC automation with priority support',
});

// ──────────────────────────────────────────────
// Plan badge mapping (DataResult display)
// ──────────────────────────────────────────────
export const PLAN_BADGE = Object.freeze({
  Simple:  'Gold',
  Premium: 'Gold',
  Pro:     'Silver',
  Flex:    'Silver',
  Free:    'Free',
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Normalize a legacy rank to the current name. */
export function normalizePlanName(rank) {
  return LEGACY_ALIASES[rank] || rank;
}

/** True when rank is Pro tier (including legacy 'Flex'). */
export function isProTier(rank) {
  return PRO_RANKS.includes(rank);
}

/** True when rank is Simple tier (including legacy 'Premium'). */
export function isSimpleTier(rank) {
  return SIMPLE_RANKS.includes(rank);
}

/** True when rank is any paid tier. */
export function isPaidTier(rank) {
  return isProTier(rank) || isSimpleTier(rank);
}

/** Get the credit display string for a plan rank. */
export function getCreditDisplay(rank) {
  const normalized = normalizePlanName(rank);
  const key = normalized.toLowerCase();
  return CREDITS[key]?.display ?? CREDITS[PLAN_IDS.FREE].display;
}

/** Get the default credit limit for a plan rank. */
export function getDefaultCreditLimit(rank) {
  const normalized = normalizePlanName(rank);
  const key = normalized.toLowerCase();
  const plan = CREDITS[key];
  if (!plan) return 0;
  return plan.monthlyLimit ?? plan.defaultLimit ?? 0;
}
