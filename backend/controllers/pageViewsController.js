/**
 * Page Views Controller — records page visits and ranks pages by traffic.
 *
 * The React SPA fires a lightweight beacon on every route change; this
 * controller stores each hit as a `PageView:<path>` record in the `Simple`
 * table and exposes ranking endpoints:
 *
 * POST /api/data/analytics/pageview          — public, fire-and-forget beacon
 * GET  /api/data/analytics/page-rankings     — private (admin) ranking report
 * GET  /api/data/analytics/project-rankings  — public counts for a given set of paths
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

// ── DynamoDB client (matches accessData.js / adminController.js pattern) ──
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const PAGEVIEW_PREFIX = 'PageView:';

// Counting requires a full-table scan, so cache the raw counts briefly.
let countsCache = { days: null, counts: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Normalize a frontend path so `/colosseum` and `/Colosseum` count together. */
function normalizePath(rawPath) {
    if (typeof rawPath !== 'string') return '/';
    let p = rawPath.trim();
    if (!p) return '/';
    if (!p.startsWith('/')) p = `/${p}`;
    // Strip a trailing slash (but keep the root as '/')
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p.toLowerCase();
}

/**
 * Scan the `Simple` table for page-view records and return a
 * `{ path: visitCount }` map for the given lookback window. Results are
 * cached in-memory for CACHE_TTL because the scan touches the whole table.
 */
async function getPageViewCounts(days) {
    const now = Date.now();
    if (countsCache.counts && countsCache.days === days && (now - countsCache.timestamp < CACHE_TTL)) {
        return countsCache.counts;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const counts = {};
    let lastKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            FilterExpression: 'begins_with(#text, :prefix)',
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: { ':prefix': PAGEVIEW_PREFIX },
            ExclusiveStartKey: lastKey,
        }));

        for (const item of result.Items || []) {
            const created = item.createdAt ? new Date(item.createdAt) : null;
            if (created && created < cutoff) continue;
            const page = normalizePath((item.text || '').slice(PAGEVIEW_PREFIX.length));
            counts[page] = (counts[page] || 0) + 1;
        }

        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    countsCache = { days, counts, timestamp: now };
    return counts;
}

/**
 * @desc    Record a single page view (fire-and-forget beacon)
 * @route   POST /api/data/analytics/pageview
 * @access  Public
 */
const recordPageView = asyncHandler(async (req, res) => {
    const path = normalizePath(req.body?.path);
    const now = new Date().toISOString();

    try {
        await dynamodb.send(new PutCommand({
            TableName: 'Simple',
            Item: {
                id: crypto.randomBytes(16).toString('hex'),
                text: `${PAGEVIEW_PREFIX}${path}`,
                updatedAt: now,
                createdAt: now,
            },
            ConditionExpression: 'attribute_not_exists(id)',
        }));
    } catch (error) {
        // Page-view tracking must never break a page load — log and move on.
        logger.error('Error recording page view:', error);
    }

    res.status(204).end();
});

/**
 * @desc    Rank pages by total visits
 * @route   GET /api/data/analytics/page-rankings
 * @access  Private (Admin only)
 */
const getPageRankings = asyncHandler(async (req, res) => {
    if (!req.user || req.user.id !== process.env.ADMIN_USER_ID) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    const days = Math.max(1, parseInt(req.query.days, 10) || 30);
    const counts = await getPageViewCounts(days);

    const rankings = Object.entries(counts)
        .map(([path, visits]) => ({ path, visits }))
        .sort((a, b) => b.visits - a.visits);

    res.status(200).json({
        success: true,
        days,
        totalViews: rankings.reduce((sum, r) => sum + r.visits, 0),
        pages: rankings,
    });
});

/**
 * @desc    Get visit counts for a specific set of pages (e.g. the /projects catalog)
 * @route   GET /api/data/analytics/project-rankings?paths=/fluid,/2048,/colosseum
 * @access  Public — only returns counts for the paths the caller asked for
 */
const getProjectRankings = asyncHandler(async (req, res) => {
    const rawPaths = typeof req.query.paths === 'string' ? req.query.paths : '';
    if (!rawPaths.trim()) {
        res.status(400);
        throw new Error('Provide a comma-separated "paths" query parameter.');
    }

    const days = Math.max(1, parseInt(req.query.days, 10) || 30);

    // Trim, drop empties, normalize, and cap the list to keep the scan cheap.
    const paths = rawPaths
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map(normalizePath);

    const counts = await getPageViewCounts(days);

    const pages = paths
        .map((path) => ({ path, visits: counts[path] || 0 }))
        .sort((a, b) => b.visits - a.visits);

    res.status(200).json({ success: true, days, pages });
});

module.exports = {
    recordPageView,
    getPageRankings,
    getProjectRankings,
    normalizePath,
};
