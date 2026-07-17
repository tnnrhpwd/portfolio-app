/**
 * Pure, DB-free ranking + trust-gate helpers for the CSimple skill
 * marketplace (docs/new/csimple-agent-prompt.md §4.3 / §4.6).
 *
 * Kept separate from marketplaceController.js so the ranking/trust logic
 * can be unit tested without a DynamoDB connection, and so the weights
 * live in one explicit config object instead of being scattered magic
 * numbers inside route handlers (§4.6 backlog item).
 */

// ─── Explicit ranking weights (tune here, not inline in route code) ────────
const RANKING_WEIGHTS = {
    // Multiplier bounds for author reputation (1x for a brand-new author,
    // up to 2x for a max-reputation author).
    reputationMin: 1,
    reputationMax: 2,
    // Recency half-life-ish decay window, in days. A skill this old (with
    // no further updates) decays to the recencyFloor multiplier.
    recencyWindowDays: 365,
    recencyFloor: 0.1,
    // Each additional flag divides the score by (1 + flagCount * flagWeight).
    flagWeight: 1,
    // §5.6: each additional point of failed-outcome RATE (0-1, not raw
    // count) divides the score by (1 + failureOutcomeRate * outcomeFailWeight).
    // A skill with a perfect 5-star average but where every rater's
    // `successCriteria` outcome recorded "failed" should still rank below
    // an equally-starred skill whose runs actually succeeded — stars alone
    // can't detect "it looked done but the assertion failed."
    outcomeFailWeight: 3,
};

// ─── Explicit low-trust classification thresholds (§4.3 cold-start) ───────
const LOW_TRUST_THRESHOLDS = {
    minRatingCount: 3,
    minDownloads: 5,
    minAgeDays: 7,
};

/**
 * Author reputation, seeded from account age + prior skill ratings
 * (§4.3). Returns a number in [0, 100]; feed straight into
 * computeTrustScore's `authorReputation` input.
 */
function computeAuthorReputation({ accountAgeDays = 0, priorSkillCount = 0, priorAvgRating = 0 } = {}) {
    const ageComponent = Math.min(accountAgeDays / 365, 1) * 40; // up to 40 pts for a 1yr+ account
    const volumeComponent = Math.min(priorSkillCount, 10) * 3;   // up to 30 pts for 10+ prior skills
    const ratingComponent = Math.max(0, Math.min(priorAvgRating, 5)) / 5 * 30; // up to 30 pts for 5-star history
    return Math.round(Math.max(0, Math.min(100, ageComponent + volumeComponent + ratingComponent)));
}

/**
 * Marketplace trust/ranking score: rating × volume × author reputation ×
 * recency, with community flags deprioritizing (§4.3). Zero-rating skills
 * (cold start) score 0 on the rating axis by design — they rely on the
 * dry-run-first safety floor (§6), not ranking, to protect early
 * downloaders.
 */
function computeTrustScore({
    avgRating = 0,
    ratingCount = 0,
    downloads = 0,
    authorReputation = 0,
    ageDays = 0,
    flagCount = 0,
    // §5.6: fraction (0-1) of ratings whose run outcome was recorded as
    // "failed" (from the skill's successCriteria evaluation at run time,
    // see tools/skill.js `outcome`) — NOT the star rating. Defaults to 0
    // (no evidence of failure) so existing callers that don't pass this
    // yet see no behavior change.
    outcomeFailRate = 0,
} = {}) {
    const ratingComponent = ratingCount > 0 ? avgRating : 0;
    const volumeComponent = 1 + Math.log2(1 + Math.max(0, downloads));
    const { reputationMin, reputationMax, recencyWindowDays, recencyFloor, flagWeight, outcomeFailWeight } = RANKING_WEIGHTS;
    const reputationComponent = reputationMin +
        (reputationMax - reputationMin) * (Math.max(0, Math.min(authorReputation, 100)) / 100);
    const recencyComponent = Math.max(recencyFloor, 1 - Math.max(0, ageDays) / recencyWindowDays);
    const flagPenalty = 1 / (1 + Math.max(0, flagCount) * flagWeight);
    const outcomeFailPenalty = 1 / (1 + Math.max(0, Math.min(1, outcomeFailRate)) * outcomeFailWeight);

    return ratingComponent * volumeComponent * reputationComponent * recencyComponent * flagPenalty * outcomeFailPenalty;
}

/**
 * §4.3 cold-start mitigation: a brand-new or otherwise unproven skill is
 * classified "low trust" and should default to dry-run-first on its first
 * execution regardless of ranking score.
 */
function classifyLowTrust({ ratingCount = 0, downloads = 0, ageDays = 0 } = {}) {
    const t = LOW_TRUST_THRESHOLDS;
    return ratingCount < t.minRatingCount || downloads < t.minDownloads || ageDays < t.minAgeDays;
}

/**
 * §4.1 rating gate: "one rating per user per version, only accepted from
 * users who actually downloaded/ran it." `installed` = server has an
 * install attestation for this user+marketId; `attemptedRun` = the rater
 * supplied run evidence (a `ranAt` timestamp) with the rating submission.
 */
function canRate({ installed = false, attemptedRun = false } = {}) {
    return Boolean(installed && attemptedRun);
}

/**
 * Deterministic sort with explicit tie-breakers (§4.6): recency, then
 * downloads, then a stable id — so pagination never reorders items across
 * requests with identical scores.
 */
function sortSkills(skills, sortBy = 'trust') {
    const list = [...(skills || [])];
    const byRecency = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    const byDownloads = (a, b) => (b.downloads || 0) - (a.downloads || 0);
    const byId = (a, b) => String(a.marketId || '').localeCompare(String(b.marketId || ''));

    const tieBreak = (a, b) => byRecency(a, b) || byDownloads(a, b) || byId(a, b);

    if (sortBy === 'downloads') {
        list.sort((a, b) => byDownloads(a, b) || tieBreak(a, b));
    } else if (sortBy === 'recent') {
        list.sort((a, b) => byRecency(a, b) || tieBreak(a, b));
    } else {
        // 'trust' (default)
        list.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0) || tieBreak(a, b));
    }
    return list;
}

module.exports = {
    RANKING_WEIGHTS,
    LOW_TRUST_THRESHOLDS,
    computeAuthorReputation,
    computeTrustScore,
    classifyLowTrust,
    canRate,
    sortSkills,
};
