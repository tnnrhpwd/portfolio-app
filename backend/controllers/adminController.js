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
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { normalizePlanName, isPaidTier, PLAN_IDS, MONTHLY_PRICES } = require('../constants/pricing');
const { isSpecialUser, refreshUserDataCache } = require('../utils/apiUsageTracker');
const { createMemoryItem } = require('../services/memoryService');
const { runGoalAgent } = require('../services/goalAgentService');
const { logger } = require('../utils/logger');

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

/**
 * Fetch a single 'Simple' table record by its `id` partition key.
 *
 * The `Simple` table's primary key is composite (`id` + `createdAt` sort
 * key) for most item types (workspace/marketplace/csimple records, etc.), so
 * a plain GetCommand keyed on `id` alone throws a ValidationException — see
 * the same issue already handled via a Query fallback in
 * authMiddleware.getUserById and apiUsageTracker.getRawUserRecord. A
 * QueryCommand only needs the partition key, so it works regardless of
 * whether the sort key is present.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getRecordById(id) {
    const { Items } = await dynamodb.send(new QueryCommand({
        TableName: 'Simple',
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': id },
        Limit: 1,
    }));
    return (Items && Items[0]) || null;
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
    // MONTHLY_PRICES imported from pricing constants
    const estimatedMRR = Object.entries(byPlan).reduce((sum, [plan, count]) => {
        return sum + (MONTHLY_PRICES[plan] || 0) * count;
    }, 0);

    // ── Visitor stats ──
    // `checkIP` writes one access-log record per request, so the raw counts
    // below are hits/requests, NOT unique visitors. Unique visitors are
    // derived from distinct IPs in each window.
    const visitorsToday   = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= oneDayAgo).length;
    const visitorsWeek    = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= sevenDaysAgo).length;
    const visitorsMonth   = visitors.filter(v => v.createdAt && new Date(v.createdAt) >= thirtyDaysAgo).length;

    // Unique visitors (distinct IPs) per window
    const uniqueIpsInWindow = (cutoff) => new Set(
        visitors
            .filter(v => v.createdAt && new Date(v.createdAt) >= cutoff && v.ip)
            .map(v => v.ip)
    ).size;
    const uniqueIpsToday   = uniqueIpsInWindow(oneDayAgo);
    const uniqueIpsWeek    = uniqueIpsInWindow(sevenDaysAgo);
    const uniqueIpsMonth   = uniqueIpsInWindow(thirtyDaysAgo);
    const uniqueIpsTotal   = new Set(visitors.filter(v => v.ip).map(v => v.ip)).size;

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
            uniqueToday: uniqueIpsToday,
            uniqueWeek:  uniqueIpsWeek,
            uniqueMonth: uniqueIpsMonth,
            uniqueTotal: uniqueIpsTotal,
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
                special:   isSpecialUser(text),
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

// ═══════════════════════════════════════════════════════════════
// PUT /api/data/admin/users/:id/special
// Toggle (or explicitly set) a user's "Special" flag — grants unlimited
// API credits, same as the ADMIN_USER_ID account, without changing their
// underlying Free/Pro plan rank.
// ═══════════════════════════════════════════════════════════════

const updateUserSpecial = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied.');
    }

    const { id } = req.params;
    if (!id) {
        res.status(400);
        throw new Error('User id is required.');
    }

    const userItem = await getRecordById(id);
    if (!userItem) {
        res.status(404);
        throw new Error('User not found.');
    }

    const text = userItem.text || '';
    if (!text.includes('Email:') || !text.includes('Password:')) {
        res.status(400);
        throw new Error('Target record is not a user account.');
    }

    // Toggle unless the caller explicitly requested a boolean value
    const currentlySpecial = isSpecialUser(text);
    const nextSpecial = typeof req.body?.special === 'boolean' ? req.body.special : !currentlySpecial;

    let updatedText = text;
    if (text.includes('|Special:')) {
        updatedText = text.replace(/\|Special:[^|]*/, `|Special:${nextSpecial}`);
    } else if (nextSpecial) {
        updatedText = `${text}|Special:true`;
    }

    const updatedAt = new Date().toISOString();
    const updatedItem = { ...userItem, text: updatedText, updatedAt };

    await dynamodb.send(new PutCommand({ TableName: 'Simple', Item: updatedItem }));

    // Invalidate the API usage tracker's cached copy so the new Special
    // status takes effect on the user's very next request instead of
    // waiting out its cache window.
    refreshUserDataCache(id, updatedItem);

    // Invalidate the admin dashboard cache since it aggregates user records.
    dashboardCache = { data: null, timestamp: 0 };

    res.status(200).json({ id, special: nextSpecial });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/data/admin/email-status
// Confirms FROM_EMAIL is set and AWS SES is reachable and out of sandbox
// mode — without sending an email or exposing any credentials. Lets an
// admin diagnose "reset emails aren't arriving" reports directly through
// the app instead of needing AWS console access.
// ═══════════════════════════════════════════════════════════════

const getEmailStatus = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied.');
    }

    const { getEmailServiceStatus } = require('../services/emailService');
    const status = await getEmailServiceStatus();
    res.status(200).json(status);
});

// ═══════════════════════════════════════════════════════════════
// POST /api/data/admin/email-test
// Runs the exact same sendEmail()+passwordResetTemplate() code path that
// forgotPassword() uses (real AWS SES call, real template rendering) and
// returns the raw success/error result directly in the response. Unlike
// forgotPassword(), which always returns a generic "sent" message to avoid
// account-enumeration, this is admin-only and surfaces the real exception
// message/stack so a delivery failure can be diagnosed without needing
// Render's log dashboard.
// Body: { to: "someone@example.com" } — defaults to FROM_EMAIL if omitted.
// ═══════════════════════════════════════════════════════════════

const testEmailSend = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied.');
    }

    const to = req.body?.to || process.env.FROM_EMAIL;
    if (!to) {
        res.status(400);
        throw new Error('No recipient provided and FROM_EMAIL is not configured.');
    }

    const { sendEmail } = require('../services/emailService');
    // Use the real getIPLocationInfo(req) — same call forgotPassword() makes —
    // instead of a hardcoded mock, so this test exercises the exact same
    // live IP-geolocation path (ipinfo() call, its failure modes, etc.).
    const { getIPLocationInfo } = require('../utils/passwordReset');
    const requestInfo = await getIPLocationInfo(req);

    try {
        const result = await sendEmail(to, 'passwordReset', {
            resetLink: 'https://example.com/reset-password?token=diagnostic-test',
            userNickname: 'Diagnostic Test',
            requestInfo
        });
        res.status(200).json({ success: true, to, requestInfo, result });
    } catch (error) {
        res.status(200).json({
            success: false,
            to,
            requestInfo,
            error: error.message || String(error),
            stack: error.stack || null
        });
    }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/data/admin/agent-fix
// Enlist the Goal Agent to autonomously fix an open bug report. It
// inspects the repo, makes a minimal fix with write_repo_file (commits
// to the default branch), and delivers a summary. The run is persisted
// as a goal memory item owned by the admin, so its progress can be
// polled with GET /api/data/goal-agent/status/:goalId.
// Body: { bugId, instruction? }
// ═══════════════════════════════════════════════════════════════

const enlistAgentForBug = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    const bugId = req.body?.bugId;
    const instruction = String(req.body?.instruction || '').trim().slice(0, 500);
    if (!bugId) {
        res.status(400);
        throw new Error('bugId is required.');
    }

    const item = await getRecordById(bugId);
    if (!item) {
        res.status(404);
        throw new Error('Bug report not found.');
    }
    const text = item.text || '';
    if (!(text.includes('Bug:') && text.includes('Status:') && text.includes('Creator:'))) {
        res.status(400);
        throw new Error('Target record is not a bug report.');
    }

    const title       = parseField(text, 'Bug') || 'Untitled Bug Report';
    const severity    = parseField(text, 'Severity') || 'medium';
    const description = parseField(text, 'Description');
    const steps       = parseField(text, 'Steps');
    const expected    = parseField(text, 'Expected');
    const actual      = parseField(text, 'Actual');

    const descriptionParts = [
        'The admin enlisted an autonomous agent to fix this bug report on sthopwood.com.',
        '',
        `Bug title: ${title}`,
        `Severity: ${severity}`,
    ];
    if (description) descriptionParts.push(`Description: ${description}`);
    if (steps)       descriptionParts.push(`Steps to reproduce: ${steps}`);
    if (expected)    descriptionParts.push(`Expected behavior: ${expected}`);
    if (actual)      descriptionParts.push(`Actual behavior: ${actual}`);
    if (instruction) descriptionParts.push(`Admin instruction: ${instruction}`);
    descriptionParts.push(
        '',
        'Inspect the repository code, find the root cause, and make a minimal, correct fix with write_repo_file. Then call deliver_result with a summary of what you changed.',
    );

    // Create the fix goal (owned by the admin) so the run reuses the whole
    // Goal Agent pipeline — tool schemas, progress persistence, and the
    // existing /goal-agent/status polling endpoint.
    const goal = await createMemoryItem(req.user.id, 'goal', {
        title: `Fix bug: ${title}`.slice(0, 200),
        description: descriptionParts.join('\n').slice(0, 4000),
        priority: severity === 'high' ? 'high' : 'medium',
        status: 'active',
    });

    // Fire-and-forget: progress persists to the goal item as the run proceeds.
    runGoalAgent({ userId: req.user.id, goalId: goal._id, goal, user: req.user })
        .catch((err) => logger.error('[adminAgent] run error:', err.message));

    res.status(202).json({
        success: true,
        message: 'Agent enlisted — it will fix the bug and commit the change.',
        goalId: goal._id,
    });
});


module.exports = { getAdminDashboard, getAdminUsers, getAdminPaginatedData, updateUserSpecial, getEmailStatus, testEmailSend, enlistAgentForBug };
