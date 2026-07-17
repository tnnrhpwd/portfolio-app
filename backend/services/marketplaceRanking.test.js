/**
 * Offline unit tests for the marketplace ranking/trust helpers
 * (docs/new/csimple-agent-prompt.md §4.3/§4.6). No DynamoDB required.
 */
const {
    computeAuthorReputation,
    computeTrustScore,
    classifyLowTrust,
    canRate,
    sortSkills,
    LOW_TRUST_THRESHOLDS,
} = require('./marketplaceRanking');

describe('computeAuthorReputation', () => {
    test('brand-new author with no history scores 0', () => {
        expect(computeAuthorReputation({})).toBe(0);
    });

    test('older account with prior rated skills scores higher', () => {
        const newAuthor = computeAuthorReputation({ accountAgeDays: 1, priorSkillCount: 0, priorAvgRating: 0 });
        const establishedAuthor = computeAuthorReputation({ accountAgeDays: 400, priorSkillCount: 12, priorAvgRating: 4.8 });
        expect(establishedAuthor).toBeGreaterThan(newAuthor);
        expect(establishedAuthor).toBeLessThanOrEqual(100);
    });

    test('clamps to [0, 100] even with out-of-range inputs', () => {
        expect(computeAuthorReputation({ accountAgeDays: 999999, priorSkillCount: 999, priorAvgRating: 999 })).toBe(100);
        expect(computeAuthorReputation({ accountAgeDays: -50, priorSkillCount: -5, priorAvgRating: -5 })).toBe(0);
    });
});

describe('computeTrustScore', () => {
    test('a zero-rating (cold-start) skill scores 0 on the rating axis', () => {
        const score = computeTrustScore({ avgRating: 0, ratingCount: 0, downloads: 100, authorReputation: 90, ageDays: 1 });
        expect(score).toBe(0);
    });

    test('more downloads increases score, all else equal', () => {
        const base = { avgRating: 4, ratingCount: 10, authorReputation: 50, ageDays: 30 };
        const low = computeTrustScore({ ...base, downloads: 5 });
        const high = computeTrustScore({ ...base, downloads: 500 });
        expect(high).toBeGreaterThan(low);
    });

    test('higher author reputation increases score, all else equal', () => {
        const base = { avgRating: 4, ratingCount: 10, downloads: 50, ageDays: 30 };
        const lowRep = computeTrustScore({ ...base, authorReputation: 0 });
        const highRep = computeTrustScore({ ...base, authorReputation: 100 });
        expect(highRep).toBeGreaterThan(lowRep);
    });

    test('older skills (no recent update) score lower than freshly updated ones', () => {
        const base = { avgRating: 4, ratingCount: 10, downloads: 50, authorReputation: 50 };
        const fresh = computeTrustScore({ ...base, ageDays: 0 });
        const stale = computeTrustScore({ ...base, ageDays: 400 });
        expect(fresh).toBeGreaterThan(stale);
    });

    test('community flags deprioritize the score', () => {
        const base = { avgRating: 4, ratingCount: 10, downloads: 50, authorReputation: 50, ageDays: 10 };
        const clean = computeTrustScore({ ...base, flagCount: 0 });
        const flagged = computeTrustScore({ ...base, flagCount: 5 });
        expect(flagged).toBeLessThan(clean);
    });

    // §5.6: outcome (from successCriteria evaluation) feeding back into
    // ranking, not just the raw star average.
    test('a higher failed-outcome rate deprioritizes the score even at a fixed star average', () => {
        const base = { avgRating: 4.5, ratingCount: 20, downloads: 50, authorReputation: 50, ageDays: 10 };
        const noFailures = computeTrustScore({ ...base, outcomeFailRate: 0 });
        const someFailures = computeTrustScore({ ...base, outcomeFailRate: 0.5 });
        const allFailures = computeTrustScore({ ...base, outcomeFailRate: 1 });
        expect(someFailures).toBeLessThan(noFailures);
        expect(allFailures).toBeLessThan(someFailures);
    });

    test('outcomeFailRate defaults to 0 (no penalty) for callers that omit it', () => {
        const base = { avgRating: 4, ratingCount: 10, downloads: 50, authorReputation: 50, ageDays: 10 };
        expect(computeTrustScore(base)).toBe(computeTrustScore({ ...base, outcomeFailRate: 0 }));
    });

    test('outcomeFailRate is clamped to [0, 1] for out-of-range input', () => {
        const base = { avgRating: 4, ratingCount: 10, downloads: 50, authorReputation: 50, ageDays: 10 };
        expect(computeTrustScore({ ...base, outcomeFailRate: 5 })).toBe(computeTrustScore({ ...base, outcomeFailRate: 1 }));
        expect(computeTrustScore({ ...base, outcomeFailRate: -5 })).toBe(computeTrustScore({ ...base, outcomeFailRate: 0 }));
    });

    test('never negative, never NaN, for default/empty input', () => {
        const score = computeTrustScore();
        expect(Number.isNaN(score)).toBe(false);
        expect(score).toBeGreaterThanOrEqual(0);
    });
});

describe('classifyLowTrust', () => {
    test('a brand-new skill with no ratings/downloads/age is low-trust', () => {
        expect(classifyLowTrust({ ratingCount: 0, downloads: 0, ageDays: 0 })).toBe(true);
    });

    test('a proven skill above every threshold is not low-trust', () => {
        expect(classifyLowTrust({
            ratingCount: LOW_TRUST_THRESHOLDS.minRatingCount,
            downloads: LOW_TRUST_THRESHOLDS.minDownloads,
            ageDays: LOW_TRUST_THRESHOLDS.minAgeDays,
        })).toBe(false);
    });

    test('failing any single threshold is enough to stay low-trust', () => {
        const proven = { ratingCount: 50, downloads: 500, ageDays: 365 };
        expect(classifyLowTrust({ ...proven, ratingCount: 0 })).toBe(true);
        expect(classifyLowTrust({ ...proven, downloads: 0 })).toBe(true);
        expect(classifyLowTrust({ ...proven, ageDays: 0 })).toBe(true);
    });
});

describe('canRate', () => {
    test('requires both install attestation and run evidence', () => {
        expect(canRate({ installed: true, attemptedRun: true })).toBe(true);
        expect(canRate({ installed: true, attemptedRun: false })).toBe(false);
        expect(canRate({ installed: false, attemptedRun: true })).toBe(false);
        expect(canRate({ installed: false, attemptedRun: false })).toBe(false);
        expect(canRate()).toBe(false);
    });
});

describe('sortSkills', () => {
    const now = new Date('2026-07-16T00:00:00.000Z').toISOString();
    const older = new Date('2025-01-01T00:00:00.000Z').toISOString();

    const skills = [
        { marketId: 'b', trustScore: 5, downloads: 10, updatedAt: older },
        { marketId: 'a', trustScore: 5, downloads: 20, updatedAt: older },
        { marketId: 'c', trustScore: 9, downloads: 1, updatedAt: now },
    ];

    test('sorts by trust score descending by default', () => {
        const sorted = sortSkills(skills, 'trust');
        expect(sorted.map(s => s.marketId)).toEqual(['c', 'a', 'b']);
    });

    test('sorts by downloads descending when requested', () => {
        const sorted = sortSkills(skills, 'downloads');
        expect(sorted.map(s => s.marketId)).toEqual(['a', 'b', 'c']);
    });

    test('sorts by recency descending when requested', () => {
        const sorted = sortSkills(skills, 'recent');
        expect(sorted.map(s => s.marketId)).toEqual(['c', 'a', 'b']);
    });

    test('ties break deterministically by marketId (stable across calls)', () => {
        const tied = [
            { marketId: 'z', trustScore: 5, downloads: 5, updatedAt: older },
            { marketId: 'y', trustScore: 5, downloads: 5, updatedAt: older },
        ];
        const first = sortSkills(tied, 'trust').map(s => s.marketId);
        const second = sortSkills(tied, 'trust').map(s => s.marketId);
        expect(first).toEqual(second);
        expect(first).toEqual(['y', 'z']);
    });

    test('does not mutate the input array', () => {
        const original = [...skills];
        sortSkills(skills, 'trust');
        expect(skills).toEqual(original);
    });
});
