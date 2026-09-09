'use strict';

/**
 * marketplace-eval-stub.js — deterministic, in-memory stand-in for the
 * backend marketplace client (workspace-client.js's publishMarketSkill /
 * searchMarketSkills / getMarketSkill / installMarketSkill / rateMarketSkill /
 * flagMarketSkill) used ONLY by the eval harness.
 *
 * The addon's /api/market/skills* routes are thin proxies to the shared
 * portfolio backend (docs/implementation/simple-agent-prompt.md §4.2). To
 * exercise them end-to-end in the offline eval harness you'd otherwise need a
 * live backend + signed-in JWT. This stub closes that gap (the §4.5 eval
 * scenario): the routes detect the request-scoped `X-Simple-Eval-Stub: 1`
 * header and swap in this client, so the scenario can assert the full proxy
 * wiring (routing, status codes, JSON shape) with no network calls.
 *
 * Not reachable in production: the header gate lives in the route wiring in
 * server/automation/index.js, and a real client never sends that header.
 */

// Per-process in-memory state. Fresh on each eval run (the harness boots its
// own Node process).
const skills = new Map();   // marketId -> record
const versions = new Map(); // `${marketId}:${version}` -> record
const ratings = new Map();  // `${marketId}:${version}:${rater}` -> rating
const flags = [];           // { marketId, reason, at }

function _slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function _notFound() {
    const e = new Error('skill not found');
    e.status = 404;
    throw e;
}

function publishMarketSkill(body = {}) {
    const marketId = body.marketId || `mk-${String(1 + skills.size).padStart(3, '0')}`;
    const version = body.version || '1.0.0';
    const record = {
        marketId,
        name: body.name || 'stub skill',
        slug: body.slug || _slugify(body.name),
        version,
        authorUserId: body.authorUserId || 'stub-user',
        steps: Array.isArray(body.steps) ? body.steps : [],
        downloads: 0,
        installs: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
    };
    skills.set(marketId, record);
    versions.set(`${marketId}:${version}`, record);
    return { ok: true, marketId, version, slug: record.slug };
}

function searchMarketSkills({ q, sort, page, perPage } = {}) {
    const all = [...skills.values()];
    const filtered = q
        ? all.filter((s) => (s.name || '').includes(q) || (s.slug || '').includes(q))
        : all;
    const p = Math.max(1, Number(page) || 1);
    const pp = Math.max(1, Number(perPage) || 20);
    return { ok: true, skills: filtered.slice((p - 1) * pp, p * pp), total: filtered.length, page: p, perPage: pp, sort: sort || 'recent' };
}

function getMarketSkill(marketId, version) {
    const rec = versions.get(`${marketId}:${version}`) || (!version ? skills.get(marketId) : null);
    if (!rec) _notFound();
    return { ok: true, skill: rec };
}

function installMarketSkill(marketId, version) {
    const rec = skills.get(marketId);
    if (!rec) _notFound();
    rec.downloads += 1;
    rec.installs += 1;
    return {
        ok: true,
        marketId,
        version: version || rec.version,
        downloads: rec.downloads,
        installs: rec.installs,
        steps: rec.steps,
        lowTrust: false,
    };
}

function rateMarketSkill(marketId, body = {}) {
    const rec = skills.get(marketId);
    if (!rec) _notFound();
    const version = body.version || rec.version;
    const rater = body.raterUserId || 'stub-rater';
    ratings.set(`${marketId}:${version}:${rater}`, { stars: body.stars ?? 5, outcome: body.outcome ?? 'success' });
    return { ok: true, marketId, version, stars: body.stars ?? 5 };
}

function flagMarketSkill(marketId, reason) {
    flags.push({ marketId, reason: reason || '', at: '2026-01-01T00:00:00.000Z' });
    return { ok: true, marketId, flagged: true };
}

module.exports = {
    publishMarketSkill,
    searchMarketSkills,
    getMarketSkill,
    installMarketSkill,
    rateMarketSkill,
    flagMarketSkill,
    // Exposed for tests that want to reset state between scenario runs.
    _reset() { skills.clear(); versions.clear(); ratings.clear(); flags.length = 0; },
};
