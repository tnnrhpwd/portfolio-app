/**
 * Simple Marketplace Controller (docs/implementation/simple-agent-prompt.md §4).
 *
 * Public/shared skill marketplace surface — deliberately a SEPARATE
 * DynamoDB id namespace (`csimple_market_*`) from the private per-user
 * workspace skill store (`csimple_ws_${userId}_skill_${slug}`, see
 * workspaceController.js). A "publish" action bridges the two: the addon
 * scrubs (POST /api/skill/scrub) and previews capabilities
 * (POST /api/skill/capabilities) locally (both addon-local routes), then
 * calls this backend's POST /api/data/market/skills — which ALSO
 * independently re-runs the scrub pass server-side (`services/
 * marketplaceScrub.js`, §4.5) before persisting, rather than trusting that
 * the client actually scrubbed first.
 *
 * Data model (DynamoDB table "Simple", same table as the rest of csimple):
 *   meta      id = `csimple_market_${marketId}`
 *             attrs: authorUserId, name, slug, latestVersion,
 *                    toolSchemaVersion, declaredCategories,
 *                    naturalLanguageDescription, downloads, installs,
 *                    creations, ratingCount, ratingSum, flagCount,
 *                    firstPublishedAt, updatedAt
 *             (NOTE: the DynamoDB range key is also literally named
 *             `createdAt` — set to the shared MARKET_CREATED_AT sentinel,
 *             same convention as workspaceController.js. The business-level
 *             "when was this skill first published" field is deliberately
 *             named `firstPublishedAt` instead, to avoid colliding with
 *             that sentinel key.)
 *   version   id = `csimple_market_${marketId}_v${version}`
 *             attrs: marketId, version, authorUserId, name, slug,
 *                    steps (server-scrubbed — see services/marketplaceScrub.js),
 *                    params (server-scrubbed, may include a synthesized
 *                    `userProfile` param — see marketplaceScrub.js),
 *                    declaredCategories, toolSchemaVersion,
 *                    naturalLanguageDescription, createdAt (immutable —
 *                    never overwritten once written)
 *   install   id = `csimple_market_${marketId}_install_${userId}`
 *             attrs: installedAt, attemptedRun, lastVersion
 *   rating    id = `csimple_market_${marketId}_v${version}_rating_${userId}`
 *             attrs: stars, outcome, ranAt, updatedAt (one per user+version;
 *                    re-rating overwrites and adjusts the meta aggregate)
 *   flag      id = `csimple_market_${marketId}_flag_${userId}_${ts}`
 *             attrs: reason, flaggedAt
 *   authorRate id = `csimple_market_author_${authorUserId}`
 *             attrs: recentPublishTimestamps[] (author-scope publish
 *                    rate-limit window, §4.6)
 *
 * Trust model (§4.3): NO manual moderation queue. Ranking = rating ×
 * volume × author reputation × recency, flags deprioritize (see
 * services/marketplaceRanking.js). The real safety floor for unreviewed
 * skills is the addon's execution-time permission gate — this controller
 * only adds the marketplace-specific gates: install-before-rate, and
 * surfacing `lowTrust` so the client can enforce dry-run-first.
 */

require('dotenv').config();
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { paginatedScan } = require('../utils/paginatedScan');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
    computeAuthorReputation,
    computeTrustScore,
    classifyLowTrust,
    canRate,
    sortSkills,
} = require('../services/marketplaceRanking');
const { scrubForPublish } = require('../services/marketplaceScrub');
const { summarizeCapabilities } = require('../services/marketplaceCapabilities');
const { upsertGoal, getGoalBySlug, slugifyGoal } = require('../services/workspaceGoals');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'Simple';
const MARKET_CREATED_AT = '2000-01-01T00:00:00.000Z';

// Lowercase slug — same shape as the workspace skill store's slug rule.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const NAME_MAX = 120;
const DESC_MAX = 2000;
const MAX_STEPS = 500;
const MAX_CATEGORIES = 20;
// Goals (§4.7): a shared goal is text — its description, success criteria and
// optional constraints — so it has its own size caps and no steps at all.
const GOAL_CONTENT_MAX = 4000;
const GOAL_CRITERIA_MAX = 400;

// Author-scope publish rate limit (§4.6: "reduce spam bursts").
const AUTHOR_PUBLISH_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AUTHOR_PUBLISH_MAX = 20;

function badRequest(res, msg) {
    res.status(400);
    throw new Error(msg);
}

function unauthorized(res) {
    res.status(401);
    throw new Error('User not found');
}

function metaId(marketId) { return `csimple_market_${marketId}`; }
function versionId(marketId, version) { return `csimple_market_${marketId}_v${version}`; }
function installId(marketId, userId) { return `csimple_market_${marketId}_install_${userId}`; }
function ratingId(marketId, version, userId) { return `csimple_market_${marketId}_v${version}_rating_${userId}`; }
function authorLimiterId(authorUserId) { return `csimple_market_author_${authorUserId}`; }

async function getItem(id) {
    const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id, createdAt: MARKET_CREATED_AT },
        ConsistentRead: true,
    }));
    return Item || null;
}

function ageDaysOf(iso) {
    if (!iso) return 0;
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

/**
 * Author-scope publish rate limit, shared by skill and goal publishing (§4.6).
 * Reads the author's rolling window, refuses the publish when it's full, and
 * records this one. (publishSkill still inlines its own copy of this — migrate
 * it here next time that handler is touched.)
 */
async function checkAuthorPublishLimit(userId) {
    const limiterKey = authorLimiterId(userId);
    const limiterItem = await getItem(limiterKey);
    const now = Date.now();
    const recent = ((limiterItem && limiterItem.recentPublishTimestamps) || [])
        .filter(ts => now - ts < AUTHOR_PUBLISH_WINDOW_MS);
    if (recent.length >= AUTHOR_PUBLISH_MAX) {
        return { ok: false, message: `Publish rate limit exceeded (${AUTHOR_PUBLISH_MAX}/hour). Try again later.` };
    }
    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: limiterKey,
            createdAt: MARKET_CREATED_AT,
            recentPublishTimestamps: [...recent, now],
        },
    }));
    return { ok: true };
}

function metaToSummary(meta) {
    const ratingCount = meta.ratingCount || 0;
    const avgRating = ratingCount > 0 ? (meta.ratingSum || 0) / ratingCount : 0;
    const ageDays = ageDaysOf(meta.firstPublishedAt);
    // §5.6: fraction of ratings whose run outcome was recorded as "failed"
    // (from the skill's successCriteria evaluation — see tools/skill.js
    // `outcome` — NOT the star value). Feeds computeTrustScore's
    // outcomeFailRate penalty so a skill that "looks fine" by stars but
    // reliably fails its own success criteria still ranks lower.
    const outcomeFailCount = meta.outcomeFailCount || 0;
    const outcomeFailRate = ratingCount > 0 ? outcomeFailCount / ratingCount : 0;
    // NOTE: authorReputation here is seeded from THIS skill's own age/rating
    // history only (we don't yet cross-reference the author's other
    // published skills or account age — that's a documented follow-up,
    // see §4.6 backlog "ranking weights as explicit config").
    const authorReputation = computeAuthorReputation({
        accountAgeDays: ageDays,
        priorSkillCount: 0,
        priorAvgRating: avgRating,
    });
    const trustScore = computeTrustScore({
        avgRating,
        ratingCount,
        downloads: meta.downloads || 0,
        authorReputation,
        ageDays,
        flagCount: meta.flagCount || 0,
        outcomeFailRate,
    });
    const lowTrust = classifyLowTrust({ ratingCount, downloads: meta.downloads || 0, ageDays });

    return {
        marketId: meta.marketId || meta.id?.replace('csimple_market_', ''),
        // §4.7: one namespace, two kinds. Absent means 'skill' — every entry
        // written before goals existed is a skill.
        kind: meta.kind || 'skill',
        authorUserId: meta.authorUserId,
        name: meta.name,
        slug: meta.slug,
        latestVersion: meta.latestVersion,
        toolSchemaVersion: meta.toolSchemaVersion,
        declaredCategories: meta.declaredCategories || [],
        naturalLanguageDescription: meta.naturalLanguageDescription || '',
        // Goal payload (empty for skills).
        content: meta.content || '',
        successCriteria: meta.successCriteria || '',
        constraints: meta.constraints || '',
        priority: meta.priority ?? null,
        sourceGoalSlug: meta.sourceGoalSlug || null,
        downloads: meta.downloads || 0,
        installs: meta.installs || 0,
        creations: meta.creations || 0,
        ratingCount,
        avgRating,
        outcomeFailCount,
        outcomeFailRate,
        flagCount: meta.flagCount || 0,
        trustScore,
        lowTrust,
        createdAt: meta.firstPublishedAt,
        updatedAt: meta.updatedAt,
    };
}

// @desc    Publish a skill (new marketplace entry, or a new version of one
//          this user already authored). The addon is expected to have
//          already run POST /api/skill/scrub client-side (§6.1), but this
//          endpoint ALSO independently re-runs the same scrub pass
//          server-side before persisting (§4.5) — the persisted `steps` are
//          always the server-scrubbed output, never the raw request body,
//          so a client that skips/bypasses the client-side scrub can't get
//          unscrubbed content into the public marketplace.
// @route   POST /api/data/market/skills
// @access  Private
const publishSkill = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const {
        marketId: inputMarketId,
        name,
        slug,
        steps,
        params,
        declaredCategories,
        toolSchemaVersion,
        naturalLanguageDescription,
    } = req.body || {};

    if (!slug || !SLUG_RE.test(slug)) badRequest(res, 'Invalid slug. Lowercase letters/digits/underscore/hyphen, 1-100 chars.');
    if (typeof name !== 'string' || !name.trim()) badRequest(res, 'name is required');
    if (!Array.isArray(steps) || steps.length === 0) badRequest(res, 'steps (non-empty array) is required');
    if (steps.length > MAX_STEPS) badRequest(res, `steps: max ${MAX_STEPS}`);
    if (declaredCategories != null && !Array.isArray(declaredCategories)) badRequest(res, 'declaredCategories must be an array');
    if ((declaredCategories || []).length > MAX_CATEGORIES) badRequest(res, `declaredCategories: max ${MAX_CATEGORIES}`);
    if (naturalLanguageDescription != null && String(naturalLanguageDescription).length > DESC_MAX) {
        badRequest(res, `naturalLanguageDescription: max ${DESC_MAX} chars`);
    }

    // ── Server-side scrub re-enforcement (§4.5/§6.1) ────────────────────
    // Re-run the exact same PII/secret scrub the addon runs client-side.
    // `scrubbedSkill.steps`/`params` — never the raw `steps`/`params` from
    // req.body — are what actually get persisted below.
    const { skill: scrubbedSkill, report: scrubReport } = scrubForPublish({ steps, params: params || [] });

    // ── Server-side capability-mismatch re-enforcement (§4.5/§6.2) ──────
    // Re-run the declared-vs-actual category check server-side too, so a
    // client can't publish with an under-declared `declaredCategories`
    // (e.g. claiming `safe-read` while `steps` actually invoke `shell_run`)
    // undetected. This does not block publishing (no manual moderation
    // queue, §4.3/§9) — it's surfaced back on the response as
    // `capabilitySummary`, same "detect and disclose" pattern as `scrubReport`.
    const capabilitySummary = summarizeCapabilities({ steps: scrubbedSkill.steps, declaredCategories });

    // ── Author-scope publish rate limit (§4.6) ──────────────────────────
    const limiterKey = authorLimiterId(req.user.id);
    const limiterItem = await getItem(limiterKey);
    const now = Date.now();
    const recent = ((limiterItem && limiterItem.recentPublishTimestamps) || [])
        .filter(ts => now - ts < AUTHOR_PUBLISH_WINDOW_MS);
    if (recent.length >= AUTHOR_PUBLISH_MAX) {
        res.status(429);
        throw new Error(`Publish rate limit exceeded (${AUTHOR_PUBLISH_MAX}/hour). Try again later.`);
    }

    let marketId = inputMarketId;
    let existingMeta = null;
    if (marketId) {
        existingMeta = await getItem(metaId(marketId));
        if (!existingMeta) badRequest(res, `Unknown marketId: ${marketId}`);
        if (existingMeta.authorUserId !== req.user.id) {
            res.status(403);
            throw new Error('Only the original author can publish a new version of this skill.');
        }
    } else {
        marketId = crypto.randomUUID();
    }

    const version = existingMeta ? (existingMeta.latestVersion || 0) + 1 : 1;
    const nowIso = new Date().toISOString();

    // Immutable version record — written once, never overwritten.
    const versionItem = {
        id: versionId(marketId, version),
        createdAt: MARKET_CREATED_AT,
        marketId,
        version,
        authorUserId: req.user.id,
        name: name.trim().slice(0, NAME_MAX),
        slug,
        steps: scrubbedSkill.steps,
        params: scrubbedSkill.params,
        declaredCategories: declaredCategories || [],
        toolSchemaVersion: toolSchemaVersion ?? null,
        naturalLanguageDescription: (naturalLanguageDescription || '').slice(0, DESC_MAX),
        publishedAt: nowIso,
    };
    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item: versionItem }));

    const metaItem = {
        id: metaId(marketId),
        createdAt: MARKET_CREATED_AT,
        marketId,
        authorUserId: req.user.id,
        name: versionItem.name,
        slug,
        latestVersion: version,
        toolSchemaVersion: versionItem.toolSchemaVersion,
        declaredCategories: versionItem.declaredCategories,
        naturalLanguageDescription: versionItem.naturalLanguageDescription,
        downloads: existingMeta?.downloads || 0,
        installs: existingMeta?.installs || 0,
        creations: (existingMeta?.creations || 0) + (existingMeta ? 0 : 1),
        ratingCount: existingMeta?.ratingCount || 0,
        ratingSum: existingMeta?.ratingSum || 0,
        flagCount: existingMeta?.flagCount || 0,
        firstPublishedAt: existingMeta?.firstPublishedAt || nowIso,
        updatedAt: nowIso,
    };
    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item: metaItem }));

    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: limiterKey,
            createdAt: MARKET_CREATED_AT,
            recentPublishTimestamps: [...recent, now],
        },
    }));

    // `scrubReport` is intentionally safe to return in full — findings never
    // include the original sensitive value (see marketplaceScrub.js), so
    // this doubles as the "what will be shared" pre-publish review data
    // (§6.1) even when the client's own scrub pass already caught everything.
    res.status(200).json({ marketId, version, isNewSkill: !existingMeta, skill: metaToSummary(metaItem), scrubReport, capabilitySummary });
});

// @desc    Search/browse published skills.
// @route   GET /api/data/market/skills?q=&sort=trust|downloads|recent&page=&perPage=
// @access  Private
const searchMarketSkills = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { q, sort = 'trust' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));

    const items = await paginatedScan({
        TableName: TABLE_NAME,
        // Strongly consistent read: a skill published moments ago must be
        // visible immediately, not subject to DynamoDB's eventual consistency
        // window (a just-published skill would otherwise vanish from the
        // first browse refresh).
        ConsistentRead: true,
        FilterExpression: 'begins_with(id, :prefix) AND attribute_exists(marketId) AND attribute_exists(latestVersion)',
        ExpressionAttributeValues: { ':prefix': 'csimple_market_' },
    });

    logger.debug('Marketplace browse', {
        q: q || null,
        sort,
        page,
        perPage,
        table: TABLE_NAME,
        rawItemCount: items.length,
        sampleIds: items.slice(0, 8).map(it => it.id),
    });

    let summaries = items.map(metaToSummary);

    // The skills browser shows skills; goals have their own endpoint (§4.7).
    summaries = summaries.filter(s => s.kind !== 'goal');

    if (q) {
        const needle = String(q).toLowerCase();
        summaries = summaries.filter(s =>
            (s.name || '').toLowerCase().includes(needle) ||
            (s.naturalLanguageDescription || '').toLowerCase().includes(needle) ||
            (s.slug || '').toLowerCase().includes(needle));
    }

    summaries = sortSkills(summaries, sort);

    const total = summaries.length;
    const start = (page - 1) * perPage;
    const pageItems = summaries.slice(start, start + perPage);

    res.status(200).json({ skills: pageItems, total, page, perPage });
});

// @desc    Fetch a specific published version (or the latest, if omitted).
// @route   GET /api/data/market/skills/:marketId/:version?
// @access  Private
const getMarketSkill = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { marketId } = req.params;
    const meta = await getItem(metaId(marketId));
    if (!meta) { res.status(404); throw new Error('Marketplace skill not found'); }

    const version = req.params.version ? parseInt(req.params.version, 10) : meta.latestVersion;
    if (!Number.isInteger(version) || version < 1) badRequest(res, 'Invalid version');

    const versionItem = await getItem(versionId(marketId, version));
    if (!versionItem) { res.status(404); throw new Error(`Version ${version} not found`); }

    res.status(200).json({ ...metaToSummary(meta), version, steps: versionItem.steps });
});

// @desc    Install a published skill: atomically bumps downloads/installs,
//          records an install attestation (used to gate ratings), and
//          returns the installable scrubbed steps + a lowTrust flag so the
//          client can enforce dry-run-first (§4.3).
// @route   POST /api/data/market/skills/:marketId/install
// @access  Private
const installMarketSkill = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { marketId } = req.params;
    const meta = await getItem(metaId(marketId));
    if (!meta) { res.status(404); throw new Error('Marketplace skill not found'); }

    const version = req.body?.version ? parseInt(req.body.version, 10) : meta.latestVersion;
    const versionItem = await getItem(versionId(marketId, version));
    if (!versionItem) { res.status(404); throw new Error(`Version ${version} not found`); }

    const nowIso = new Date().toISOString();
    const { Attributes: updatedMeta } = await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: metaId(marketId), createdAt: MARKET_CREATED_AT },
        UpdateExpression: 'ADD downloads :one, installs :one SET updatedAt = :now',
        ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
        ReturnValues: 'ALL_NEW',
    }));

    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: installId(marketId, req.user.id), createdAt: MARKET_CREATED_AT },
        UpdateExpression: 'SET installedAt = :now, lastVersion = :v, attemptedRun = if_not_exists(attemptedRun, :false)',
        ExpressionAttributeValues: { ':now': nowIso, ':v': version, ':false': false },
    }));

    const summary = metaToSummary(updatedMeta || meta);
    const capabilitySummary = summarizeCapabilities({ steps: versionItem.steps, declaredCategories: versionItem.declaredCategories });
    res.status(200).json({
        marketId,
        version,
        skill: {
            marketId, version, name: versionItem.name, slug: versionItem.slug,
            steps: versionItem.steps, params: versionItem.params || [],
            declaredCategories: versionItem.declaredCategories,
            toolSchemaVersion: versionItem.toolSchemaVersion,
        },
        lowTrust: summary.lowTrust,
        capabilitySummary,
    });
});

// @desc    Submit a run-gated rating. Requires the caller to have already
//          installed this marketId (server-tracked attestation) and to
//          supply `ranAt` as run evidence (§4.1/§4.3 canRate gate).
// @route   POST /api/data/market/skills/:marketId/rate
// @access  Private
const rateMarketSkill = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { marketId } = req.params;
    const { stars, outcome, ranAt } = req.body || {};

    if (!Number.isInteger(stars) || stars < 1 || stars > 5) badRequest(res, 'stars must be an integer 1-5');
    if (!ranAt || Number.isNaN(new Date(ranAt).getTime())) badRequest(res, 'ranAt (ISO timestamp) is required as run evidence');

    const meta = await getItem(metaId(marketId));
    if (!meta) { res.status(404); throw new Error('Marketplace skill not found'); }

    const install = await getItem(installId(marketId, req.user.id));
    if (!canRate({ installed: !!install, attemptedRun: true })) {
        res.status(403);
        throw new Error('You must install and run this skill before rating it.');
    }

    const version = req.body.version ? parseInt(req.body.version, 10) : meta.latestVersion;
    const versionItem = await getItem(versionId(marketId, version));
    if (!versionItem) { res.status(404); throw new Error(`Version ${version} not found`); }

    const existingRating = await getItem(ratingId(marketId, version, req.user.id));
    const nowIso = new Date().toISOString();

    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: ratingId(marketId, version, req.user.id),
            createdAt: MARKET_CREATED_AT,
            marketId, version, raterUserId: req.user.id,
            stars, outcome: outcome || null, ranAt, updatedAt: nowIso,
        },
    }));

    // Adjust the meta aggregate: replace the old star value if re-rating,
    // otherwise add a brand-new rating to the count. Also track the
    // outcomeFailCount aggregate (§5.6) so a re-rating that flips outcome
    // from "failed" to "passed" (or vice versa) doesn't double/under-count.
    const starDelta = stars - (existingRating ? existingRating.stars : 0);
    const countDelta = existingRating ? 0 : 1;
    const wasFailed = existingRating ? existingRating.outcome === 'failed' : false;
    const isFailed = outcome === 'failed';
    const outcomeFailDelta = (isFailed ? 1 : 0) - (wasFailed ? 1 : 0);
    const { Attributes: updatedMeta } = await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: metaId(marketId), createdAt: MARKET_CREATED_AT },
        UpdateExpression: 'ADD ratingCount :countDelta, ratingSum :starDelta, outcomeFailCount :outcomeFailDelta SET updatedAt = :now',
        ExpressionAttributeValues: {
            ':countDelta': countDelta, ':starDelta': starDelta,
            ':outcomeFailDelta': outcomeFailDelta, ':now': nowIso,
        },
        ReturnValues: 'ALL_NEW',
    }));

    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: installId(marketId, req.user.id), createdAt: MARKET_CREATED_AT },
        UpdateExpression: 'SET attemptedRun = :true',
        ExpressionAttributeValues: { ':true': true },
    }));

    const summary = metaToSummary(updatedMeta);
    res.status(200).json({
        ok: true,
        ratingCount: summary.ratingCount,
        avgRating: summary.avgRating,
        outcomeFailRate: summary.outcomeFailRate,
    });
});

// @desc    Community flag — no manual moderation queue (§9 non-goals);
//          flags feed directly into the ranking penalty (§4.3).
// @route   POST /api/data/market/skills/:marketId/flag
// @access  Private
const flagMarketSkill = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { marketId } = req.params;
    const { reason } = req.body || {};
    if (reason != null && String(reason).length > 500) badRequest(res, 'reason: max 500 chars');

    const meta = await getItem(metaId(marketId));
    if (!meta) { res.status(404); throw new Error('Marketplace skill not found'); }

    const nowIso = new Date().toISOString();
    // One flag per user per skill: repeat flags update the reason/timestamp but
    // do NOT inflate the counter, so a single user cannot spam flags to tank a
    // competitor's ranking (flagCount feeds the trust-score penalty).
    const flagId = `csimple_market_${marketId}_flag_${req.user.id}`;
    const existingFlag = await getItem(flagId);

    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: flagId,
            createdAt: MARKET_CREATED_AT,
            marketId, flaggedBy: req.user.id, reason: reason || null, flaggedAt: nowIso,
        },
    }));

    let updatedMeta = meta;
    if (!existingFlag) {
        const { Attributes } = await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: metaId(marketId), createdAt: MARKET_CREATED_AT },
            UpdateExpression: 'ADD flagCount :one SET updatedAt = :now',
            ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
            ReturnValues: 'ALL_NEW',
        }));
        updatedMeta = Attributes;
    }

    res.status(200).json({ ok: true, flagCount: updatedMeta.flagCount });
});

/* ── Shared GOALS (§4.7) ─────────────────────────────────────────────────────
   Goals ride the exact same machinery as skills: one `csimple_market_*`
   namespace, one trust ranking, one install-attestation gate. The differences
   are all in the payload — a goal is its text (content + success criteria +
   constraints) instead of a compiled `steps` array, and its marketId is the
   goal's slug, because a slug is what someone can share.

   "Install" for a goal means *save a copy into my workspace*, where it becomes
   an ordinary goal the caller owns and can edit, enlist an agent for, or delete.
   ────────────────────────────────────────────────────────────────────────── */

// @desc    Publish a goal (new shared goal, or a new version of one this user
//          already authored). The goal's text is scrubbed with the same
//          PII/secret pass a skill gets (§6.1) before it is persisted.
// @route   POST /api/data/market/goals
// @access  Private
const publishGoal = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const {
        marketId: inputMarketId,
        name,
        slug,
        content,
        successCriteria,
        constraints,
        priority,
        naturalLanguageDescription,
        declaredCategories,
    } = req.body || {};

    if (!slug || !SLUG_RE.test(slug)) badRequest(res, 'Invalid slug. Lowercase letters/digits/underscore/hyphen, 1-100 chars.');
    if (typeof name !== 'string' || !name.trim()) badRequest(res, 'name is required');
    if (typeof content !== 'string' || !content.trim()) badRequest(res, 'content (what the goal is) is required');
    if (content.length > GOAL_CONTENT_MAX) badRequest(res, `content: max ${GOAL_CONTENT_MAX} chars`);
    if (successCriteria != null && String(successCriteria).length > GOAL_CRITERIA_MAX) badRequest(res, `successCriteria: max ${GOAL_CRITERIA_MAX} chars`);
    if (declaredCategories != null && !Array.isArray(declaredCategories)) badRequest(res, 'declaredCategories must be an array');
    if ((declaredCategories || []).length > MAX_CATEGORIES) badRequest(res, `declaredCategories: max ${MAX_CATEGORIES}`);
    if (naturalLanguageDescription != null && String(naturalLanguageDescription).length > DESC_MAX) {
        badRequest(res, `naturalLanguageDescription: max ${DESC_MAX} chars`);
    }

    let marketId = inputMarketId;
    let existingMeta = null;
    if (marketId) {
        existingMeta = await getItem(metaId(marketId));
        if (!existingMeta) badRequest(res, `Unknown marketId: ${marketId}`);
        if ((existingMeta.kind || 'skill') !== 'goal') badRequest(res, 'That marketId is a skill, not a goal.');
        if (existingMeta.authorUserId !== req.user.id) {
            res.status(403);
            throw new Error('Only the original author can publish a new version of this goal.');
        }
    } else {
        // A goal is addressed by its slug. If the slug is taken — by a skill
        // (which would make the two indistinguishable in search) or by someone
        // else's goal — say so instead of silently overwriting.
        marketId = slug;
        const taken = await getItem(metaId(marketId));
        if (taken && (taken.kind || 'skill') !== 'goal') {
            badRequest(res, `"${slug}" is already published as a skill. Give the goal a different name.`);
        }
        if (taken && taken.authorUserId !== req.user.id) {
            res.status(409);
            throw new Error(`A shared goal with the slug "${slug}" already exists. Give yours a different name.`);
        }
        existingMeta = taken || null;
    }

    const limit = await checkAuthorPublishLimit(req.user.id);
    if (!limit.ok) { res.status(429); throw new Error(limit.message); }

    // Scrub the goal's text with the same pass a skill's steps go through.
    const targets = [{ type: 'text', text: content.trim() }];
    if (successCriteria) targets.push({ type: 'text', text: String(successCriteria) });
    if (constraints) targets.push({ type: 'text', text: String(constraints) });
    const { skill: scrubbed, report: scrubReport } = scrubForPublish({ steps: targets, params: [] });

    const version = existingMeta ? (existingMeta.latestVersion || 0) + 1 : 1;
    const nowIso = new Date().toISOString();

    const versionItem = {
        id: versionId(marketId, version),
        createdAt: MARKET_CREATED_AT,
        marketId,
        version,
        kind: 'goal',
        authorUserId: req.user.id,
        name: name.trim().slice(0, NAME_MAX),
        slug,
        goal: {
            content: scrubbed.steps[0].text,
            successCriteria: scrubbed.steps[1]?.text || '',
            constraints: scrubbed.steps[2]?.text || '',
        },
        declaredCategories: declaredCategories || [],
        naturalLanguageDescription: (naturalLanguageDescription || '').slice(0, DESC_MAX),
        publishedAt: nowIso,
    };
    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item: versionItem }));

    const metaItem = {
        id: metaId(marketId),
        createdAt: MARKET_CREATED_AT,
        marketId,
        kind: 'goal',
        authorUserId: req.user.id,
        name: versionItem.name,
        slug,
        latestVersion: version,
        content: versionItem.goal.content,
        successCriteria: versionItem.goal.successCriteria,
        constraints: versionItem.goal.constraints,
        priority: typeof priority === 'number' ? priority : null,
        declaredCategories: versionItem.declaredCategories,
        naturalLanguageDescription: versionItem.naturalLanguageDescription,
        downloads: existingMeta?.downloads || 0,
        installs: existingMeta?.installs || 0,
        creations: (existingMeta?.creations || 0) + (existingMeta ? 0 : 1),
        ratingCount: existingMeta?.ratingCount || 0,
        ratingSum: existingMeta?.ratingSum || 0,
        flagCount: existingMeta?.flagCount || 0,
        firstPublishedAt: existingMeta?.firstPublishedAt || nowIso,
        updatedAt: nowIso,
    };
    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item: metaItem }));

    res.status(200).json({
        marketId,
        version,
        isNewGoal: !existingMeta,
        goal: metaToSummary(metaItem),
        scrubReport,
    });
});

// @desc    Search/browse shared goals.
// @route   GET /api/data/market/goals?q=&sort=trust|downloads|recent&page=&perPage=
// @access  Private
const listMarketGoals = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { q, sort = 'trust' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));

    const items = await paginatedScan({
        TableName: TABLE_NAME,
        ConsistentRead: true,
        FilterExpression: 'begins_with(id, :prefix) AND attribute_exists(marketId) AND attribute_exists(latestVersion)',
        ExpressionAttributeValues: { ':prefix': 'csimple_market_' },
    });

    let goals = items.map(metaToSummary).filter(s => s.kind === 'goal');

    if (q) {
        const needle = String(q).toLowerCase();
        goals = goals.filter(g =>
            (g.name || '').toLowerCase().includes(needle) ||
            (g.naturalLanguageDescription || '').toLowerCase().includes(needle) ||
            (g.content || '').toLowerCase().includes(needle) ||
            (g.slug || '').toLowerCase().includes(needle));
    }

    goals = sortSkills(goals, sort);

    const total = goals.length;
    const start = (page - 1) * perPage;
    res.status(200).json({ goals: goals.slice(start, start + perPage), total, page, perPage });
});

// @desc    Fetch one shared goal (summary only — the text lives on the meta item).
// @route   GET /api/data/market/goals/:marketId
// @access  Private
const getMarketGoal = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const meta = await getItem(metaId(req.params.marketId));
    if (!meta || (meta.kind || 'skill') !== 'goal') { res.status(404); throw new Error('Shared goal not found'); }
    res.status(200).json(metaToSummary(meta));
});

// @desc    "Install" a shared goal: save a private copy into the caller's
//          workspace goal store (a free slug — saving twice must not clobber
//          the first copy), bump the counters, and record the install so the
//          goal can be rated.
// @route   POST /api/data/market/goals/:marketId/install
// @access  Private
const installMarketGoal = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { marketId } = req.params;
    const meta = await getItem(metaId(marketId));
    if (!meta || (meta.kind || 'skill') !== 'goal') { res.status(404); throw new Error('Shared goal not found'); }

    const baseName = meta.name || 'Shared goal';
    let name = baseName;
    let clash = await getGoalBySlug(req.user.id, slugifyGoal(name));
    for (let i = 2; clash && i <= 20; i += 1) {
        const candidate = `${baseName} (${i})`;
        // eslint-disable-next-line no-await-in-loop
        clash = await getGoalBySlug(req.user.id, slugifyGoal(candidate));
        if (!clash) name = candidate;
    }

    const created = await upsertGoal(req.user.id, {
        name,
        content: meta.content || meta.naturalLanguageDescription || baseName,
        successCriteria: meta.successCriteria || undefined,
        constraints: meta.constraints || undefined,
        status: 'active',
        priority: typeof meta.priority === 'number' ? meta.priority : 50,
        createdBy: 'user',
        tags: ['marketplace', marketId],
    });

    const nowIso = new Date().toISOString();
    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: metaId(marketId), createdAt: MARKET_CREATED_AT },
        UpdateExpression: 'SET downloads = if_not_exists(downloads, :zero) + :one, installs = if_not_exists(installs, :zero) + :one',
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
    }));
    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id: installId(marketId, req.user.id),
            createdAt: MARKET_CREATED_AT,
            installedAt: nowIso,
            attemptedRun: false,
            lastVersion: meta.latestVersion,
        },
    }));

    const updated = await getItem(metaId(marketId));
    res.status(200).json({
        ok: true,
        goalSlug: created?.slug || slugifyGoal(name),
        name: created?.name || name,
        downloads: updated?.downloads || 0,
        installs: updated?.installs || 0,
    });
});

// @desc    Aggregate one author's marketplace totals (downloads, installs,
//          creations) across every skill they've published. Not an HTTP
//          route itself — called by workspaceController.getTelemetrySummary
//          to fold marketplace KPIs into the addon's /telemetry/summary
//          response (docs/implementation/simple-agent-prompt.md §10.2 P0) without
//          giving workspaceController.js a direct DynamoDB dependency on
//          the `csimple_market_*` namespace.
async function getAuthorMarketplaceTotals(authorUserId) {
    if (!authorUserId) return { downloads: 0, installs: 0, creations: 0, skillCount: 0 };
    const items = await paginatedScan({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix) AND attribute_exists(marketId) AND attribute_exists(latestVersion)',
        ExpressionAttributeValues: { ':prefix': 'csimple_market_' },
    });
    const authored = items.filter(it => it.authorUserId === authorUserId);
    return authored.reduce((acc, it) => {
        acc.downloads += it.downloads || 0;
        acc.installs += it.installs || 0;
        acc.creations += it.creations || 0;
        acc.skillCount += 1;
        return acc;
    }, { downloads: 0, installs: 0, creations: 0, skillCount: 0 });
}

module.exports = {
    publishSkill,
    searchMarketSkills,
    getMarketSkill,
    installMarketSkill,
    rateMarketSkill,
    flagMarketSkill,
    publishGoal,
    listMarketGoals,
    getMarketGoal,
    installMarketGoal,
    getAuthorMarketplaceTotals,
    // Exported for tests only.
    _internal: { TABLE_NAME, MARKET_CREATED_AT, metaId, versionId, installId, ratingId, authorLimiterId, metaToSummary },
};
