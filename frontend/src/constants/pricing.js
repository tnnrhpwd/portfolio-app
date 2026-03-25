/**
 * Centralized pricing & plan configuration – frontend mirror.
 *
 * Keep in sync with backend/constants/pricing.js.
 * Two tiers: Free and Pro ($15/mo).
 * AI usage is BYOK (Bring Your Own Key) — no platform credits.
 */

// ──────────────────────────────────────────────
// Plan IDs & display names
// ──────────────────────────────────────────────
export const PLAN_IDS = Object.freeze({
  FREE: 'free',
  PRO:  'pro',
});

export const PLAN_NAMES = Object.freeze({
  [PLAN_IDS.FREE]: 'Free',
  [PLAN_IDS.PRO]:  'Pro',
});

/** Old rank strings still stored in some DynamoDB records. */
export const LEGACY_ALIASES = Object.freeze({
  Flex:    'Pro',
  Premium: 'Pro',
  Simple:  'Pro',
});

/** All rank strings that map to Pro tier. */
export const PRO_RANKS = Object.freeze(['Pro', 'Flex', 'Simple', 'Premium']);

// ──────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────
export const STORAGE_DISPLAY = Object.freeze({
  [PLAN_IDS.FREE]: '100 MB',
  [PLAN_IDS.PRO]:  '50 GB',
});

// ──────────────────────────────────────────────
// Quotas
// ──────────────────────────────────────────────
export const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]: '50 automation commands/day',
  [PLAN_IDS.PRO]:  '5,000 automation commands/day',
});

/** Short quota descriptions used in comparison strings */
export const QUOTA_SHORT = Object.freeze({
  [PLAN_IDS.FREE]: '50 cmds/day',
  [PLAN_IDS.PRO]:  '5,000 cmds/day',
});

// ──────────────────────────────────────────────
// Plan features
// ──────────────────────────────────────────────
export const FEATURES = Object.freeze({
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

// ──────────────────────────────────────────────
// Descriptions (pricing cards)
// ──────────────────────────────────────────────
export const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]: 'Try the addon free for 14 days',
  [PLAN_IDS.PRO]:  'Full Windows automation with priority support',
});

// ──────────────────────────────────────────────
// Plan badge mapping (DataResult display)
// ──────────────────────────────────────────────
export const PLAN_BADGE = Object.freeze({
  Simple:  'Gold',
  Premium: 'Gold',
  Pro:     'Gold',
  Flex:    'Gold',
  Free:    'Free',
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Normalize a legacy rank to the current name. */
export function normalizePlanName(rank) {
  return LEGACY_ALIASES[rank] || rank;
}

/** True when rank is Pro tier (including legacy Flex/Simple/Premium). */
export function isProTier(rank) {
  return PRO_RANKS.includes(rank);
}

/** @deprecated — kept for backward compat. Now identical to isProTier. */
export function isSimpleTier(rank) {
  return isProTier(rank);
}

/** True when rank is any paid tier. */
export function isPaidTier(rank) {
  return isProTier(rank);
}
