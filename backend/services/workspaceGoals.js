/**
 * workspaceGoals.js — the single canonical goal store.
 *
 * Goals are stored as workspace items of `kind = 'goal'` in the "Simple"
 * DynamoDB table (the same shape written by workspaceController.js). This is
 * the agent-native goal schema (status/priority/successCriteria/constraints/
 * maxSteps/autoAbandon/sourceMemoryId) that the addon agent loop and
 * GoalManager already read and write.
 *
 * The legacy parallel goal store was the memory service's `type = 'goal'`
 * items (see memoryService.js). Those have been migrated into the workspace
 * store by scripts/migrate-goals-to-workspace.js, which sets `sourceMemoryId`
 * to the original memory item id so nothing is lost.
 *
 * Constants are intentionally mirrored from workspaceController.js so this
 * service can be used by netTools.js and standalone scripts without pulling
 * in the whole Express controller.
 */

require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'Simple';
const CSIMPLE_CREATED_AT = '2000-01-01T00:00:00.000Z';
const GOAL_KIND = 'goal';
const GOAL_STATUSES = new Set(['active', 'paused', 'blocked', 'done', 'failed']);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;

// ── Helpers ─────────────────────────────────────────────────────────────────

function itemId(userId, slug) {
    return `csimple_ws_${userId}_${GOAL_KIND}_${slug}`;
}

function userPrefix(userId) {
    return `csimple_ws_${userId}_${GOAL_KIND}_`;
}

/** Case/whitespace-insensitive title key used for dedupe. */
function normalizeGoalTitle(title) {
    return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Derive a workspace-safe slug (lowercase letters/digits/_/-, starts alnum). */
function slugifyGoal(title) {
    let slug = String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
    if (!/^[a-z0-9]/.test(slug)) {
        slug = `goal-${slug}`.slice(0, 100);
    }
    if (!SLUG_RE.test(slug)) {
        slug = `goal-${Date.now().toString(36)}`;
    }
    return slug;
}

/** Map a legacy priority label (high/medium/low) to the 0-100 numeric scale. */
function priorityFromLabel(label) {
    const l = String(label || 'medium').toLowerCase();
    if (l === 'high' || l === 'critical' || l === 'urgent') return 90;
    if (l === 'low' || l === 'minor') return 10;
    return 50;
}

/** Normalize a caller-provided status into one of the canonical goal states. */
function normalizeStatus(status) {
    if (status === 'completed') return 'done'; // legacy memory-store value
    return GOAL_STATUSES.has(status) ? status : 'active';
}

function clampName(name, fallback) {
    const s = typeof name === 'string' ? name.trim() : '';
    if (!s) return fallback;
    return s.slice(0, 120);
}

function toListEntry(item) {
    return {
        kind: item.kind || GOAL_KIND,
        slug: item.slug,
        name: item.name,
        agent: item.agent || null,
        stage: item.stage || null,
        tags: item.tags || [],
        version: item.version || 1,
        updatedAt: item.updatedAt || item.createdAtReal || null,
        status: item.status || 'active',
        priority: typeof item.priority === 'number' ? item.priority : 50,
        parentGoalId: item.parentGoalId || null,
        sourceMemoryId: item.sourceMemoryId || null,
        maxSteps: typeof item.maxSteps === 'number' ? item.maxSteps : null,
        autoAbandon: !!item.autoAbandon,
        content: item.text || '',
        successCriteria: item.successCriteria || null,
        constraints: item.constraints || null,
        createdBy: item.createdBy || 'user',
        agent: item.agent || null,
        // Dream-board fields (see workspaceController.ALLOWED_KINDS → goal).
        // Carried here so a goal read through this service keeps its tile.
        vision: item.vision || null,
        cover: item.cover || null,
        targetDate: item.targetDate || null,
    };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * List every goal for a user (paginated scan over the workspace goal prefix),
 * newest updated first.
 */
async function listGoals(userId) {
    const rows = [];
    let lastEvaluatedKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'begins_with(id, :prefix) AND attribute_not_exists(deletedAt)',
            ExpressionAttributeValues: { ':prefix': userPrefix(userId) },
            ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
        }));
        if (result.Items) rows.push(...result.Items);
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const entries = rows.map(toListEntry);
    entries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return entries;
}

/** Find a goal by its sourceMemoryId (the legacy memory item id), if any. */
async function getGoalBySourceMemoryId(userId, sourceMemoryId) {
    if (!sourceMemoryId) return null;
    const goals = await listGoals(userId);
    return goals.find(g => g.sourceMemoryId === sourceMemoryId) || null;
}

/** Find a goal by slug. Returns the raw DynamoDB row (or null). */
async function getGoalRowBySlug(userId, slug) {
    const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId(userId, slug), createdAt: CSIMPLE_CREATED_AT },
    }));
    if (!Item || Item.deletedAt) return null;
    return Item;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Create or update a goal in the workspace store.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} opts.name            display title (clamped to 120 chars)
 * @param {string} [opts.content]       freeform body (text)
 * @param {string} [opts.status]        active|paused|blocked|done|failed (also accepts 'completed' → 'done')
 * @param {number|string} [opts.priority] 0-100 number or high/medium/low label
 * @param {string} [opts.successCriteria]
 * @param {string} [opts.constraints]
 * @param {string} [opts.sourceMemoryId] legacy memory item id (links back to the migrated source)
 * @param {string} [opts.createdBy]     'user' | 'agent'
 * @param {string[]} [opts.tags]
 * @returns {object} the written entry (toListEntry shape)
 */
async function upsertGoal(userId, opts = {}) {
    const name = clampName(opts.name, 'untitled-goal');
    const slug = slugifyGoal(name);

    // Prefer updating the goal that already links to this source memory item
    // so repeated migrations are idempotent and keep the canonical slug.
    const existingBySource = await getGoalBySourceMemoryId(userId, opts.sourceMemoryId);
    const existing = existingBySource
        ? await getGoalRowBySlug(userId, existingBySource.slug)
        : await getGoalRowBySlug(userId, slug);

    const canonicalSlug = existing?.slug || slug;
    const id = itemId(userId, canonicalSlug);
    const now = new Date().toISOString();
    const nextVersion = (existing?.version || 0) + 1;

    const status = normalizeStatus(opts.status != null ? opts.status : existing?.status);
    const priority = typeof opts.priority === 'number'
        ? Math.max(0, Math.min(100, Math.round(opts.priority)))
        : (opts.priority != null ? priorityFromLabel(opts.priority) : (existing?.priority ?? 50));

    const Item = {
        id,
        createdAt: CSIMPLE_CREATED_AT,
        kind: GOAL_KIND,
        slug: canonicalSlug,
        name: clampName(opts.name != null ? opts.name : existing?.name, canonicalSlug),
        text: opts.content != null ? String(opts.content) : (existing?.text || ''),
        sizeBytes: Buffer.byteLength(opts.content != null ? String(opts.content) : (existing?.text || ''), 'utf-8'),
        version: nextVersion,
        createdAtReal: existing?.createdAtReal || now,
        updatedAt: now,
        status,
        priority,
        createdBy: existing?.createdBy || (opts.createdBy === 'agent' ? 'agent' : 'user'),
        ...(opts.sourceMemoryId
            ? { sourceMemoryId: String(opts.sourceMemoryId).slice(0, 200) }
            : (existing?.sourceMemoryId ? { sourceMemoryId: existing.sourceMemoryId } : {})),
        ...(opts.successCriteria != null
            ? { successCriteria: String(opts.successCriteria) }
            : (existing?.successCriteria ? { successCriteria: existing.successCriteria } : {})),
        ...(opts.constraints != null
            ? { constraints: String(opts.constraints) }
            : (existing?.constraints ? { constraints: existing.constraints } : {})),
        ...(opts.parentGoalId
            ? { parentGoalId: opts.parentGoalId }
            : (existing?.parentGoalId ? { parentGoalId: existing.parentGoalId } : {})),
        ...(opts.maxSteps != null
            ? { maxSteps: opts.maxSteps }
            : (existing?.maxSteps != null ? { maxSteps: existing.maxSteps } : {})),
        ...(opts.autoAbandon != null
            ? { autoAbandon: !!opts.autoAbandon }
            : (existing?.autoAbandon != null ? { autoAbandon: existing.autoAbandon } : {})),
        // Dream-board fields. This write is a whole-item Put, so anything not
        // carried forward here is dropped — the agent's `save_goal` path would
        // otherwise wipe a cover the user had chosen on /plans.
        ...(opts.vision != null
            ? (opts.vision ? { vision: String(opts.vision).slice(0, 280) } : {})
            : (existing?.vision ? { vision: existing.vision } : {})),
        ...(opts.cover != null
            ? (opts.cover ? { cover: String(opts.cover).slice(0, 600) } : {})
            : (existing?.cover ? { cover: existing.cover } : {})),
        ...(opts.targetDate != null
            ? (opts.targetDate ? { targetDate: String(opts.targetDate).slice(0, 10) } : {})
            : (existing?.targetDate ? { targetDate: existing.targetDate } : {})),
        ...(Array.isArray(opts.tags) && opts.tags.length ? { tags: opts.tags.slice(0, 20) } : {}),
        ...(existing?.agent ? { agent: existing.agent } : {}),
    };

    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item }));
    return toListEntry(Item);
}

/**
 * Write (or replace) the agent run-state JSON on a goal without touching any
 * other field. Used by goalAgentService to persist live run progress. Throws
 * on DynamoDB errors so callers can decide whether to surface or swallow.
 */
async function setGoalAgent(userId, slug, agentState) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId(userId, slug), createdAt: CSIMPLE_CREATED_AT },
        UpdateExpression: 'SET #a = :a, #u = :u',
        ExpressionAttributeNames: { '#a': 'agent', '#u': 'updatedAt' },
        ExpressionAttributeValues: {
            ':a': agentState,
            ':u': new Date().toISOString(),
        },
    }));
}

/**
 * Read one goal by slug. Returns a full entry (content + agent included) or
 * null when the goal does not exist or was soft-deleted.
 */
async function getGoalBySlug(userId, slug) {
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId(userId, slug), createdAt: CSIMPLE_CREATED_AT },
    }));
    if (!Item || Item.deletedAt) return null;
    return toListEntry(Item);
}

module.exports = {
    TABLE_NAME,
    CSIMPLE_CREATED_AT,
    GOAL_STATUSES,
    normalizeGoalTitle,
    slugifyGoal,
    priorityFromLabel,
    normalizeStatus,
    listGoals,
    getGoalBySourceMemoryId,
    getGoalBySlug,
    setGoalAgent,
    upsertGoal,
};
