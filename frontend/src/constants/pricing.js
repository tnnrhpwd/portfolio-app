/**
 * Centralized pricing & plan configuration – frontend mirror.
 *
 * Keep in sync with backend/constants/pricing.js.
 * The shared, user-facing subset is pinned by
 * backend/__tests__/unit/pricingSync.test.js — CI fails if it drifts.
 * Everything else below is frontend-only (QUOTA_SHORT, PLAN_BADGE, helpers).
 *
 * ►► VALUE BLOCK ◄◄ — the numbers you change live in ONE place:
 *   MONTHLY_PRICES / ANNUAL_PRICES   plan prices (USD)
 *   AI_CREDIT_ALLOWANCE              included monthly cloud-AI credits (USD)
 *   STORAGE_BYTES                    cloud-storage limit per plan (bytes)
 * Everything below (STORAGE_DISPLAY, FEATURES, DESCRIPTIONS, COMPARISON) is
 * DERIVED from those values — never hand-edit copy.
 *
 * AI usage is metered and server-paid (see constants/aiModel.js for the model
 * actually in use) with per-tier monthly credit limits — there is no
 * bring-your-own-key (BYOK) option.
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

/** Monthly plan price in dollars (also used for admin revenue estimation). */
export const MONTHLY_PRICES = Object.freeze({
  [PLAN_IDS.FREE]: 0,
  [PLAN_IDS.PRO]:  15,
});

/** Annual plan price in dollars, for plans that offer a yearly cadence. */
export const ANNUAL_PRICES = Object.freeze({
  [PLAN_IDS.FREE]: 0,
  [PLAN_IDS.PRO]:  144,
});

/**
 * Included monthly cloud-AI credit allowance in dollars — the same figure the
 * backend meters against (backend/utils/apiUsageTracker.js).
 */
export const AI_CREDIT_ALLOWANCE = Object.freeze({
  [PLAN_IDS.FREE]: 0.50,
  [PLAN_IDS.PRO]:  10.00,
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
// Storage (bytes) — VALUE BLOCK: change a number here only
// ──────────────────────────────────────────────
const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Canonical cloud-storage limit per plan, in bytes. */
export const STORAGE_BYTES = Object.freeze({
  [PLAN_IDS.FREE]: 100 * MB,
  [PLAN_IDS.PRO]:  50 * GB,
});

/** Human-readable storage label per plan, derived from STORAGE_BYTES. */
export const STORAGE_DISPLAY = Object.freeze(
  Object.fromEntries(
    Object.values(PLAN_IDS).map((planId) => [planId, formatBytes(STORAGE_BYTES[planId])])
  )
);

// ──────────────────────────────────────────────
// Quotas
// ──────────────────────────────────────────────
// The addon runs entirely on the user's own PC, so a locally-run command
// costs us nothing on either tier — there's no cost basis for a
// Free/Pro difference here. Both tiers share the same generous,
// anti-abuse-only limit.
export const QUOTAS = Object.freeze({
  [PLAN_IDS.FREE]: 'Unlimited automation commands (fair use)',
  [PLAN_IDS.PRO]:  'Unlimited automation commands (fair use)',
});

/** Short quota descriptions used in comparison strings */
export const QUOTA_SHORT = Object.freeze({
  [PLAN_IDS.FREE]: 'Unlimited (fair use)',
  [PLAN_IDS.PRO]:  'Unlimited (fair use)',
});

// ──────────────────────────────────────────────
// Plan features (DERIVED — edit the VALUE BLOCK above, not these strings)
// ──────────────────────────────────────────────
const AI_CHAT_FEATURE = (planId) =>
  `🌐 AI chat — ${formatUsd(AI_CREDIT_ALLOWANCE[planId])}/month cloud credits`;
const CLOUD_STORAGE_FEATURE = (planId, emoji) =>
  `${emoji} ${STORAGE_DISPLAY[planId]} cloud storage`;

export const FEATURES = Object.freeze({
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

// ──────────────────────────────────────────────
// Descriptions (pricing cards)
// ──────────────────────────────────────────────
export const DESCRIPTIONS = Object.freeze({
  [PLAN_IDS.FREE]: `AI chat with included credits, unlimited local automation, and ${STORAGE_DISPLAY[PLAN_IDS.FREE]} storage`,
  [PLAN_IDS.PRO]:  `More AI credits, ${STORAGE_DISPLAY[PLAN_IDS.PRO]} storage, phone viewing, and email support`,
});

/** Pricing-page comparison table rows (mirrors the backend constant). */
export const COMPARISON = Object.freeze([
  { feature: 'AI chat (cloud credits)', free: `${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.FREE])}/month`, pro: `${formatUsd(AI_CREDIT_ALLOWANCE[PLAN_IDS.PRO])}/month` },
  { feature: 'Local automation (Simple addon)', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Cloud storage', free: STORAGE_DISPLAY[PLAN_IDS.FREE], pro: STORAGE_DISPLAY[PLAN_IDS.PRO] },
  { feature: 'Live screen viewing from phone', free: '—', pro: 'Included' },
  { feature: 'Email support', free: 'Self-serve', pro: 'Included' },
]);

// ──────────────────────────────────────────────
// Plan badge mapping (plan badges shown in the UI)
// ──────────────────────────────────────────────
export const PLAN_BADGE = Object.freeze({
  Simple:  'Gold',
  Premium: 'Gold',
  Pro:     'Gold',
  Flex:    'Gold',
  Free:    'Free',
});

// ──────────────────────────────────────────────
// Formatting helpers (used to derive the copy above + by consumers)
// ──────────────────────────────────────────────

/** 0.5 → '$0.50', 10 → '$10.00', 15 → '$15.00'. */
export function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

/** 15 → '$15', 0 → '$0' (drops a trailing .00). */
export function formatUsdCompact(amount) {
  const n = Number(amount);
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/** 104857600 → '100 MB'; 53687091200 → '50 GB'. */
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes >= GB) return `${bytes / GB} GB`;
  if (bytes >= MB) return `${bytes / MB} MB`;
  if (bytes >= 1024) return `${bytes / 1024} KB`;
  return `${bytes} B`;
}

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

/** True when rank is any paid tier. */
export function isPaidTier(rank) {
  return isProTier(rank);
}
