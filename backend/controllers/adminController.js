/**
 * Admin Controller — server-side aggregation for the admin dashboard.
 *
 * Instead of dumping the entire DynamoDB table to the client, these
 * endpoints compute stats in-process and return small JSON payloads.
 *
 * GET /api/data/admin/dashboard   — aggregated KPIs & charts data
 * GET /api/data/admin/users       — paginated user list
 * GET /api/data/admin/data        — paginated raw data browser
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { normalizePlanName, isPaidTier, PLAN_IDS } = require('../constants/pricing');

// ── DynamoDB client (matches existing getHashData.js pattern) ──
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

// ── Simple in-memory cache to avoid redundant full-table scans ──
let dashboardCache = { data: null, timestamp: 0 };
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// ── Helpers ──
const isAdmin = (req) => req.user && req.user.id === process.env.ADMIN_USER_ID;

/** Full paginated scan of the Simple table. */
async function fullScan() {
    const items = [];
    let lastKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            ExclusiveStartKey: lastKey,
        }));
        items.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

/** Parse a pipe-delimited text value safely. */
function parseField(text, key) {
    const re = new RegExp(`(?:^|\\|)${key}:([^|]*)`);
    const m = text.match(re);
    return m ? m[1].trim() : '';
}

/** Categorise a single DynamoDB item by its text pattern. */
function categorise(item) {
    const text = item.text || '';
    if (text.includes('Email:') && text.includes('Password:'))  return 'user';
    if (text.includes('IP:') && (text.includes('|OS:') || text.includes('|Browser:'))) return 'visitor';
    if (text.includes('Bug:') && text.includes('Status:') && text.includes('Creator:')) return 'bug';
    if ((text.includes('Review:') || text.includes('Rating:')) && text.includes('User:')) return 'review';
    return 'other';
}

// ═══════════════════════════════════════════════════════════════
// GET /api/data/admin/dashboard
// ═══════════════════════════════════════════════════════════════

const getAdminDashboard = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    // Return cached data if fresh (unless ?refresh=true)
    const now = Date.now();
    if (req.query.refresh !== 'true' && dashboardCache.data && (now - dashboardCache.timestamp < CACHE_TTL)) {
        return res.status(200).json(dashboardCache.data);
    }

    const allItems = await fullScan();

    // ── Classify every record once ──
    const users = [];
    const visitors = [];
    const bugReports = [];
    const reviews = [];

    for (const item of allItems) {
        const type = categorise(item);
        const text = item.text || '';

        switch (type) {
            case 'user': {
                const email    = parseField(text, 'Email');
                const nickname = parseField(text, 'Nickname');
                const rawRank  = parseField(text, 'Rank') || 'Free';
                const rank     = normalizePlanName(rawRank) || rawRank;
                const stripeid = parseField(text, 'stripeid');

                users.push({
                    id: item.id,
                    email,
                    nickname,
                    rank,
                    stripeid,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                });
                break;
            }
            case 'visitor': {
                visitors.push({
                    country:  parseField(text, 'Country'),
                    city:     parseField(text, 'City'),
                    region:   parseField(text, 'Region'),
                    browser:  parseField(text, 'Browser'),
                    os:       parseField(text, 'OS'),
                    ip:       parseField(text, 'IP'),
                    referer:  parseField(text, 'Referer'),
                    createdAt: item.createdAt,
                });
                break;
            }
            case 'bug': {
                bugReports.push({
                    status:   parseField(text, 'Status') || 'Open',
                    title:    parseField(text, 'Bug'),
                    creator:  parseField(text, 'Creator'),
                    createdAt: item.createdAt,
                });
                break;
            }
            case 'review': {
                const ratingStr = parseField(text, 'Rating');
                reviews.push({
                    rating:   parseFloat(ratingStr) || 0,
                    createdAt: item.createdAt,
                });
                break;
            }
            default:
                break;
        }
    }

    // ── Time boundaries ──
    const nowDate = new Date();
    const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const thirtyDaysAgo = new Date(nowDate); thirtyDaysAgo.setDate(nowDate.getDate() - 30);
    const sevenDaysAgo  = new Date(nowDate); sevenDaysAgo.setDate(nowDate.getDate() - 7);
    const oneDayAgo     = new Date(nowDate); oneDayAgo.setDate(nowDate.getDate() - 1);

    // ── User stats ──
    const byPlan = {};
    let newThisMonth = 0;
    let newLast30 = 0;

    for (const u of users) {
        const plan = (u.rank || 'Free').toLowerCase();
        byPlan[plan] = (byPlan[plan] || 0) + 1;
        if (u.createdAt) {
            const d = new Date(u.createdAt);
            if (d >= startOfMonth) newThisMonth++;
            if (d >= thirtyDaysAgo) newLast30++;
        }
    }

    const paidUsers = users.filter(u => isPaidTier(u.rank)).length;

    // Recent signups (last 20, newest first)
    const recentSignups = [...users]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 20)
        .map(u => ({ nickname: u.nickname, email: u.email, rank: u.rank, createdAt: u.createdAt }));

    // ── Revenue estimation ──
    // Prices from the Stripe product config
    const MONTHLY_PRICES = { pro: 12, simple: 39 };
    const estimatedMRR = Object.entries(byPlan).reduce((sum, [plan, count]) => {
        return sum + (MONTHLY_PRICES[plan] || 0) * count;
    }, 0);

    // ── Visitor stats ──
    const visitorsToday   = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= oneDayAgo).length;
    const visitorsWeek    = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= sevenDaysAgo).length;
    const visitorsMonth   = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= thirtyDaysAgo).length;

    // Top countries
    const countryCounts = {};
    visitors.forEach(v => {
        if (v.country && v.country !== 'undefined') {
            countryCounts[v.country] = (countryCounts[v.country] || 0) + 1;
        }
    });
    const topCountries = Object.entries(countryCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([country, count]) => ({ country, count }));

    // Unique IPs this week
    const uniqueIpsWeek = new Set(
        visitors
            .filter(v => v.createdAt && new Date(v.createdAt) >= sevenDaysAgo && v.ip)
            .map(v => v.ip)
    ).size;

    // Visitors per day (last 30 days) for chart
    const visitsByDay = {};
    visitors.forEach(v => {
        if (v.createdAt) {
            const day = new Date(v.createdAt).toISOString().split('T')[0];
            visitsByDay[day] = (visitsByDay[day] || 0) + 1;
        }
    });

    // Signups per day (last 30 days) for chart
    const signupsByDay = {};
    users.forEach(u => {
        if (u.createdAt) {
            const day = new Date(u.createdAt).toISOString().split('T')[0];
            signupsByDay[day] = (signupsByDay[day] || 0) + 1;
        }
    });

    // ── Bug stats ──
    const openBugs   = bugReports.filter(b => (b.status || '').toLowerCase() === 'open').length;
    const closedBugs = bugReports.filter(b => (b.status || '').toLowerCase() === 'closed').length;

    // ── Review stats ──
    const avgRating = reviews.length > 0
        ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
        : 0;

    // ── Referer / traffic source breakdown ──
    const refererCounts = {};
    visitors.forEach(v => {
        if (v.referer && v.referer !== 'undefined' && v.referer !== '') {
            try {
                const host = new URL(v.referer).hostname.replace('www.', '');
                refererCounts[host] = (refererCounts[host] || 0) + 1;
            } catch {
                refererCounts[v.referer] = (refererCounts[v.referer] || 0) + 1;
            }
        }
    });
    const topReferers = Object.entries(refererCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([source, count]) => ({ source, count }));

    // ── Build response ──
    const dashboard = {
        overview: {
            totalRecords: allItems.length,
            totalUsers:   users.length,
            totalVisitors: visitors.length,
            paidUsers,
            openBugs,
            avgRating: avgRating.toFixed(1),
            estimatedMRR: estimatedMRR.toFixed(2),
        },
        users: {
            total: users.length,
            byPlan,
            newThisMonth,
            newLast30,
            paidUsers,
            recentSignups,
        },
        revenue: {
            paidUsers,
            estimatedMRR: estimatedMRR.toFixed(2),
            byPlan: Object.entries(byPlan).reduce((obj, [plan, count]) => {
                obj[plan] = {
                    count,
                    revenue: ((MONTHLY_PRICES[plan] || 0) * count).toFixed(2),
                };
                return obj;
            }, {}),
        },
        visitors: {
            total:       visitors.length,
            today:       visitorsToday,
            thisWeek:    visitorsWeek,
            thisMonth:   visitorsMonth,
            uniqueWeek:  uniqueIpsWeek,
            topCountries,
            topReferers,
            byDay: visitsByDay,
        },
        bugs: {
            open:   openBugs,
            closed: closedBugs,
            total:  bugReports.length,
        },
        reviews: {
            total:     reviews.length,
            avgRating: avgRating.toFixed(1),
        },
        funnel: {
            totalVisitors:      visitors.length,
            registeredUsers:    users.length,
            paidUsers,
            visitorToUserRate:  visitors.length > 0 ? ((users.length / visitors.length) * 100).toFixed(1) : '0.0',
            userToPaidRate:     users.length > 0    ? ((paidUsers / users.length) * 100).toFixed(1)       : '0.0',
            overallConversion:  visitors.length > 0 ? ((paidUsers / visitors.length) * 100).toFixed(2)    : '0.00',
            signupsByDay,
        },
        cachedAt: new Date().toISOString(),
    };

    dashboardCache = { data: dashboard, timestamp: now };
    res.status(200).json(dashboard);
});

// ═══════════════════════════════════════════════════════════════
// GET /api/data/admin/users   — paginated user list
// ═══════════════════════════════════════════════════════════════

const getAdminUsers = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied.');
    }

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const search = (req.query.search || '').toLowerCase();

    const allItems = await fullScan();

    let users = allItems
        .filter(item => {
            const text = item.text || '';
            return text.includes('Email:') && text.includes('Password:');
        })
        .map(item => {
            const text = item.text || '';
            return {
                id:        item.id,
                email:     parseField(text, 'Email'),
                nickname:  parseField(text, 'Nickname'),
                rank:      normalizePlanName(parseField(text, 'Rank') || 'Free'),
                stripeid:  parseField(text, 'stripeid'),
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            };
        });

    // Search filter
    if (search) {
        users = users.filter(u =>
            (u.email    || '').toLowerCase().includes(search) ||
            (u.nickname || '').toLowerCase().includes(search) ||
            (u.rank     || '').toLowerCase().includes(search) ||
            (u.id       || '').toLowerCase().includes(search)
        );
    }

    // Sort newest first
    users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Paginate
    const total = users.length;
    const start = (page - 1) * limit;
    const paginated = users.slice(start, start + limit);

    res.status(200).json({
        data: paginated,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/data/admin/data   — paginated raw data browser
// ═══════════════════════════════════════════════════════════════

const getAdminPaginatedData = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied.');
    }

    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const type   = req.query.type; // 'visitors' | 'users' | 'bugs' | 'reviews' | undefined

    const allItems = await fullScan();

    let filtered = allItems;
    if (type) {
        filtered = allItems.filter(item => categorise(item) === type);
    }

    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    res.status(200).json({
        data: paginated.map(item => ({
            id:        item.id,
            text:      item.text,
            files:     item.files ? item.files.map(f => f.filename).join(', ') : '',
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            type:      categorise(item),
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});

module.exports = { getAdminDashboard, getAdminUsers, getAdminPaginatedData };
