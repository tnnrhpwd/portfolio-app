/**
 * CSimple Workspace Controller
 *
 * Implements an "AI workspace" inspired by the OpenClaw memory-OS pattern.
 * Provides a small filesystem-like abstraction backed by DynamoDB so that
 * a signed-in user's custom files (core identity, agent state, knowledge,
 * notes, skills, daily logs, decisions, project state) follow them across
 * devices and are loaded into the server-side LLM context for every Net:
 * chat call.
 *
 * Data model (DynamoDB table "Simple"):
 *   id        = `csimple_ws_${userId}_${kind}_${slug}`
 *   createdAt = CSIMPLE_CREATED_AT sentinel (composite key)
 *   attrs     : kind, slug, name, content, agent?, stage?, tags[],
 *               sizeBytes, version, createdAtReal, updatedAt, deletedAt?
 *
 * Security:
 *   - All routes JWT-protected upstream via `protect` middleware
 *   - Strict allow-lists on kind, stage; strict regex on slug + agent
 *   - Per-file size caps + total bytes returned in list responses
 *   - Concurrency control via If-Match-style `expectedUpdatedAt`
 *   - Soft delete via `deletedAt`; list endpoints exclude tombstoned items
 *   - All mutations audited into the user's own `log` kind (best effort)
 */

require('dotenv').config();
const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    DeleteCommand,
    ScanCommand,
    UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
// §10.2 P0: fold marketplace downloads/installs/creations counters into
// /telemetry/summary. Lazily required (not at module scope) so a circular
// require between the two controllers can never occur, and so unit tests
// for this file that don't touch the marketplace path don't need to mock
// marketplaceController.js's DynamoDB client at all.
function getMarketplaceController() { return require('./marketplaceController'); }

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

// ─── Allow-lists & validation ────────────────────────────────────────────────

const ALLOWED_KINDS = new Set([
    'core',       // SOUL/USER/MEMORY/AGENTS/TOOLS canonical identity files
    'agent',      // per-agent working-context
    'knowledge',  // staged knowledge workflow (inbox/ideas/active/proveout/completed/library)
    'notebook',   // freeform notes
    'skill',      // operating procedures invoked with @slug in chat
    'log',        // daily logs (append-friendly)
    'decision',   // decisions register
    'project',    // active-project state
    'goal',       // agent goal: { status, priority, successCriteria, ... } (see GOAL_STATUSES)
    'action',     // append-only execution log of automation tool calls
]);

// Allowed goal lifecycle states.
const GOAL_STATUSES = new Set(['active', 'paused', 'blocked', 'done', 'failed']);
// Highest first when picking the next goal to run.
const GOAL_STATUS_RUNNABLE = new Set(['active']);

const ALLOWED_KNOWLEDGE_STAGES = new Set([
    'inbox', 'ideas', 'active', 'proveout', 'completed', 'library',
]);

// Lowercase slug — letters/digits/underscore/hyphen. 1-100 chars.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
// Agent identifier — same pattern as slug. Optional.
const AGENT_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/;
// Tag — lowercase alphanum + hyphen, 1-32 chars.
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// Per-kind single-file size cap (UTF-8 bytes).
const KIND_SIZE_CAP_BYTES = {
    core:      32 * 1024,
    agent:     32 * 1024,
    knowledge: 64 * 1024,
    notebook:  64 * 1024,
    skill:     32 * 1024,
    log:       64 * 1024,
    decision:  32 * 1024,
    project:   32 * 1024,
    goal:      16 * 1024,
    action:    256 * 1024, // append-only ring buffer
};

// Hard cap on an `action` item's text — older entries trimmed when exceeded.
const ACTION_RING_BUFFER_BYTES = 200 * 1024;

// Canonical "core" slugs and starter templates exposed for the client.
const CORE_TEMPLATES = {
    soul:    '# SOUL\nAssistant personality, tone, and boundaries.\n\n- Tone:\n- Voice:\n- Hard limits:\n',
    user:    '# USER\nStable facts and preferences about the human.\n\n- Name:\n- Pronouns:\n- Location:\n- Preferences:\n',
    memory:  '# MEMORY\nCompact high-priority memory that should always be visible.\n\n- \n',
    agents:  '# AGENTS\nRouting rules — when to invoke which agent.\n\n- default: general-purpose chat\n',
    tools:   '# TOOLS\nLocal environment notes and capabilities.\n\n- \n',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function itemId(userId, kind, slug) {
    return `csimple_ws_${userId}_${kind}_${slug}`;
}

function userPrefix(userId, kind) {
    return kind
        ? `csimple_ws_${userId}_${kind}_`
        : `csimple_ws_${userId}_`;
}

function badRequest(res, msg) {
    res.status(400);
    throw new Error(msg);
}

function unauthorized(res) {
    res.status(401);
    throw new Error('User not found');
}

function validateKind(res, kind) {
    if (!kind || !ALLOWED_KINDS.has(kind)) {
        badRequest(res, `Invalid kind. Allowed: ${[...ALLOWED_KINDS].join(', ')}`);
    }
}

function validateSlug(res, slug) {
    if (!slug || !SLUG_RE.test(slug)) {
        badRequest(res, 'Invalid slug. Use lowercase letters, digits, underscore, hyphen (1-100 chars, must start with letter/digit).');
    }
}

function validateOptionalAgent(res, agent) {
    if (agent != null && agent !== '' && !AGENT_RE.test(agent)) {
        badRequest(res, 'Invalid agent. Lowercase letters/digits/underscore/hyphen, 1-50 chars.');
    }
}

function validateKnowledgeStage(res, kind, stage) {
    if (kind !== 'knowledge') return;
    if (!stage || !ALLOWED_KNOWLEDGE_STAGES.has(stage)) {
        badRequest(res, `kind=knowledge requires stage ∈ ${[...ALLOWED_KNOWLEDGE_STAGES].join(', ')}`);
    }
}

function validateTags(res, tags) {
    if (tags == null) return [];
    if (!Array.isArray(tags)) badRequest(res, 'tags must be an array');
    if (tags.length > 20) badRequest(res, 'tags: max 20');
    for (const t of tags) {
        if (typeof t !== 'string' || !TAG_RE.test(t)) {
            badRequest(res, `Invalid tag "${t}". Lowercase alphanum + hyphen, 1-32 chars.`);
        }
    }
    return tags;
}

function clampName(name, fallback) {
    const s = typeof name === 'string' ? name.trim() : '';
    if (!s) return fallback;
    return s.slice(0, 120);
}

/**
 * Best-effort audit log — appends a one-line entry to today's `log` item.
 * Never throws (audit must never block the primary write).
 */
async function auditLog(userId, action, details) {
    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const slug = today.replace(/-/g, '');                // YYYYMMDD (slug-safe)
        const id = itemId(userId, 'log', slug);
        const line = `[${new Date().toISOString()}] ${action} ${JSON.stringify(details)}\n`;

        // Upsert via UpdateCommand — append to text, init if absent.
        await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id, createdAt: CSIMPLE_CREATED_AT },
            UpdateExpression: 'SET #t = if_not_exists(#t, :empty) + :line, ' +
                              '#k = :k, #s = :s, #n = :n, ' +
                              '#u = :now, #cR = if_not_exists(#cR, :now), ' +
                              '#v = if_not_exists(#v, :zero) + :one',
            ExpressionAttributeNames: {
                '#t': 'text', '#k': 'kind', '#s': 'slug', '#n': 'name',
                '#u': 'updatedAt', '#cR': 'createdAtReal', '#v': 'version',
            },
            ExpressionAttributeValues: {
                ':empty': '',
                ':line': line,
                ':k': 'log',
                ':s': slug,
                ':n': today,
                ':now': new Date().toISOString(),
                ':zero': 0,
                ':one': 1,
            },
        }));
    } catch (e) {
        // Audit failure must not surface. Log to server console only.
        console.warn('[workspace] audit failed:', e.message);
    }
}

function toListEntry(item) {
    return {
        kind: item.kind,
        slug: item.slug,
        name: item.name,
        agent: item.agent || null,
        stage: item.stage || null,
        tags: item.tags || [],
        sizeBytes: item.sizeBytes || 0,
        version: item.version || 1,
        updatedAt: item.updatedAt || item.createdAtReal || null,
        // Goal-specific surface (null for non-goals; cheap to include):
        status: item.status || null,
        priority: typeof item.priority === 'number' ? item.priority : null,
        parentGoalId: item.parentGoalId || null,
    };
}

function toFullEntry(item) {
    return {
        ...toListEntry(item),
        content: item.text || '',
        ...(item.kind === 'goal' ? {
            successCriteria: item.successCriteria || null,
            constraints: item.constraints || null,
            createdBy: item.createdBy || 'user',
        } : {}),
    };
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

// @desc    List workspace items (optional filters: kind, agent, stage, tag, q)
// @route   GET /api/data/csimple/workspace
// @access  Private
const listWorkspace = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { kind, agent, stage, tag, q } = req.query;
    if (kind) validateKind(res, kind);

    const prefix = userPrefix(req.user.id, kind);

    const { Items } = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix) AND attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':prefix': prefix },
    }));

    let entries = (Items || []).map(toListEntry);

    if (agent) entries = entries.filter(e => e.agent === agent);
    if (stage) entries = entries.filter(e => e.stage === stage);
    if (tag)   entries = entries.filter(e => (e.tags || []).includes(tag));
    if (q) {
        const needle = String(q).toLowerCase();
        entries = entries.filter(e =>
            (e.name || '').toLowerCase().includes(needle) ||
            (e.slug || '').toLowerCase().includes(needle));
    }

    entries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.status(200).json({ entries, count: entries.length });
});

// @desc    Read one workspace item
// @route   GET /api/data/csimple/workspace/:kind/:slug
// @access  Private
const getWorkspaceItem = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { kind, slug } = req.params;
    validateKind(res, kind);
    validateSlug(res, slug);

    const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId(req.user.id, kind, slug), createdAt: CSIMPLE_CREATED_AT },
    }));

    if (!Item || Item.deletedAt) {
        res.status(404);
        throw new Error('Workspace item not found');
    }

    res.status(200).json(toFullEntry(Item));
});

// @desc    Create or update a workspace item
// @route   PUT /api/data/csimple/workspace/:kind/:slug
// @access  Private
const upsertWorkspaceItem = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { kind, slug } = req.params;
    const { name, content, agent, stage, tags, expectedUpdatedAt } = req.body || {};

    validateKind(res, kind);
    validateSlug(res, slug);
    validateOptionalAgent(res, agent);
    validateKnowledgeStage(res, kind, stage);
    const safeTags = validateTags(res, tags);

    // ---- Goal-specific fields ----
    const goalStatus    = req.body?.status;
    const goalPriority  = req.body?.priority;
    const goalParent    = req.body?.parentGoalId;
    const goalSuccess   = req.body?.successCriteria;
    const goalConstraints = req.body?.constraints;
    const goalCreatedBy = req.body?.createdBy;
    if (kind === 'goal') {
        if (goalStatus != null && !GOAL_STATUSES.has(goalStatus)) {
            badRequest(res, `Invalid goal status. Allowed: ${[...GOAL_STATUSES].join(', ')}`);
        }
        if (goalPriority != null && (typeof goalPriority !== 'number' || goalPriority < 0 || goalPriority > 100)) {
            badRequest(res, 'goal priority must be a number 0-100');
        }
        if (goalCreatedBy != null && !['user', 'agent'].includes(goalCreatedBy)) {
            badRequest(res, "createdBy must be 'user' or 'agent'");
        }
        if (goalParent != null && typeof goalParent !== 'string') {
            badRequest(res, 'parentGoalId must be a string');
        }
    }

    if (typeof content !== 'string') badRequest(res, 'content must be a string');
    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    const cap = KIND_SIZE_CAP_BYTES[kind];
    if (sizeBytes > cap) {
        res.status(413);
        throw new Error(`Content too large for kind=${kind} (max ${cap} bytes, got ${sizeBytes})`);
    }

    const id = itemId(req.user.id, kind, slug);

    // Fetch current for concurrency check + version increment.
    const { Item: existing } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id, createdAt: CSIMPLE_CREATED_AT },
    }));

    if (existing && expectedUpdatedAt && existing.updatedAt && existing.updatedAt !== expectedUpdatedAt) {
        res.status(409);
        throw new Error('Conflict: item was modified by another client. Refresh and retry.');
    }

    const now = new Date().toISOString();
    const nextVersion = (existing?.version || 0) + 1;
    const displayName = clampName(name, slug);

    const Item = {
        id,
        createdAt: CSIMPLE_CREATED_AT,
        kind,
        slug,
        name: displayName,
        text: content,
        sizeBytes,
        version: nextVersion,
        createdAtReal: existing?.createdAtReal || now,
        updatedAt: now,
        ...(agent ? { agent } : {}),
        ...(stage ? { stage } : {}),
        ...(safeTags.length ? { tags: safeTags } : {}),
        // Goal fields persisted only when kind=goal
        ...(kind === 'goal' ? {
            status:        goalStatus    || existing?.status        || 'active',
            priority:      goalPriority  ?? existing?.priority      ?? 50,
            ...(goalParent      ? { parentGoalId: goalParent }      : (existing?.parentGoalId   ? { parentGoalId: existing.parentGoalId }   : {})),
            ...(goalSuccess     ? { successCriteria: goalSuccess }  : (existing?.successCriteria? { successCriteria: existing.successCriteria }: {})),
            ...(goalConstraints ? { constraints: goalConstraints }  : (existing?.constraints    ? { constraints: existing.constraints }     : {})),
            createdBy:     existing?.createdBy || goalCreatedBy || 'user',
        } : {}),
    };

    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item }));

    // Skip auditing audit-log writes themselves to prevent recursion.
    if (kind !== 'log') {
        auditLog(req.user.id, existing ? 'update' : 'create', { kind, slug, version: nextVersion });
    }

    res.status(200).json(toFullEntry(Item));
});

// @desc    Soft-delete a workspace item
// @route   DELETE /api/data/csimple/workspace/:kind/:slug
// @access  Private
const deleteWorkspaceItem = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { kind, slug } = req.params;
    const hard = req.query.hard === '1';
    validateKind(res, kind);
    validateSlug(res, slug);

    const id = itemId(req.user.id, kind, slug);

    if (hard) {
        await dynamodb.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { id, createdAt: CSIMPLE_CREATED_AT },
        }));
    } else {
        await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id, createdAt: CSIMPLE_CREATED_AT },
            UpdateExpression: 'SET deletedAt = :now',
            ExpressionAttributeValues: { ':now': new Date().toISOString() },
        }));
    }

    if (kind !== 'log') auditLog(req.user.id, hard ? 'purge' : 'delete', { kind, slug });
    res.status(200).json({ success: true, kind, slug, hard });
});

// @desc    Append a line to today's daily log (auto-creates the log file).
// @route   POST /api/data/csimple/workspace/log/append
// @access  Private
const appendLog = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
        badRequest(res, 'text is required');
    }
    if (text.length > 4096) badRequest(res, 'log line too long (max 4096 chars)');

    const today = new Date().toISOString().slice(0, 10);
    const slug = today.replace(/-/g, '');
    const id = itemId(req.user.id, 'log', slug);
    const line = `[${new Date().toISOString()}] ${text.trim()}\n`;
    const now = new Date().toISOString();

    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id, createdAt: CSIMPLE_CREATED_AT },
        UpdateExpression: 'SET #t = if_not_exists(#t, :empty) + :line, ' +
                          '#k = :k, #s = :s, #n = :n, ' +
                          '#u = :now, #cR = if_not_exists(#cR, :now), ' +
                          '#v = if_not_exists(#v, :zero) + :one',
        ExpressionAttributeNames: {
            '#t': 'text', '#k': 'kind', '#s': 'slug', '#n': 'name',
            '#u': 'updatedAt', '#cR': 'createdAtReal', '#v': 'version',
        },
        ExpressionAttributeValues: {
            ':empty': '',
            ':line': line,
            ':k': 'log',
            ':s': slug,
            ':n': today,
            ':now': now,
            ':zero': 0,
            ':one': 1,
        },
    }));

    res.status(200).json({ success: true, slug, name: today, updatedAt: now });
});

// @desc    Get the assembled workspace context that the LLM will see.
//          Useful for debugging from the UI.
// @route   GET /api/data/csimple/workspace/context?agent=
// @access  Private
const getWorkspaceContextPreview = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { agent, message } = req.query;
    validateOptionalAgent(res, agent);
    const { buildWorkspaceContext } = require('../services/workspaceContext');
    const out = await buildWorkspaceContext({
        dynamodb,
        userId: req.user.id,
        activeAgent: agent || null,
        message: typeof message === 'string' ? message : '',
    });
    res.status(200).json(out);
});

// @desc    Expose the canonical "core" template starter content so the UI
//          can pre-fill the editor when the user clicks "Create SOUL.md".
// @route   GET /api/data/csimple/workspace/templates
// @access  Private
const getWorkspaceTemplates = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    res.status(200).json({
        core: CORE_TEMPLATES,
        kinds: [...ALLOWED_KINDS],
        knowledgeStages: [...ALLOWED_KNOWLEDGE_STAGES],
        sizeCaps: KIND_SIZE_CAP_BYTES,
        goalStatuses: [...GOAL_STATUSES],
    });
});

// @desc    Return the highest-priority runnable goal for the calling user.
//          Used by the addon's agent loop to pick up work across devices.
// @route   GET /api/data/csimple/workspace/goals/next
// @access  Private
const getNextGoal = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { Items } = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix) AND attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':prefix': userPrefix(req.user.id, 'goal') },
    }));
    const runnable = (Items || []).filter(it => GOAL_STATUS_RUNNABLE.has(it.status || 'active'));
    // Highest priority first; tie-break on oldest updatedAt (fairness).
    runnable.sort((a, b) => {
        const pa = typeof a.priority === 'number' ? a.priority : 50;
        const pb = typeof b.priority === 'number' ? b.priority : 50;
        if (pb !== pa) return pb - pa;
        return (a.updatedAt || '').localeCompare(b.updatedAt || '');
    });
    if (!runnable.length) {
        return res.status(200).json({ goal: null });
    }
    res.status(200).json({ goal: toFullEntry(runnable[0]) });
});

// @desc    Append a single action record to the user's rolling action log.
//          Slug = YYYYMMDD; text is a ring buffer of JSON-line action records.
// @route   POST /api/data/csimple/workspace/action/append
// @access  Private
const appendAction = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const { tool, args, result, exitCode, durationMs, screenshotKey, approvedBy, goalSlug } = req.body || {};
    if (typeof tool !== 'string' || !tool.trim()) badRequest(res, 'tool is required');

    const today = new Date().toISOString().slice(0, 10);
    const slug = today.replace(/-/g, '');
    const id = itemId(req.user.id, 'action', slug);
    const now = new Date().toISOString();

    // Compact JSON-line record. Truncate huge fields defensively.
    function compact(v, max = 2048) {
        try {
            const s = typeof v === 'string' ? v : JSON.stringify(v);
            if (!s) return s;
            return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
        } catch { return '[unserializable]'; }
    }
    const record = {
        ts: now,
        tool: tool.slice(0, 64),
        args: typeof args === 'undefined' ? null : JSON.parse(compact(args, 1024)),
        result: typeof result === 'undefined' ? null : compact(result, 2048),
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        durationMs: typeof durationMs === 'number' ? durationMs : null,
        ...(screenshotKey ? { screenshotKey: String(screenshotKey).slice(0, 256) } : {}),
        ...(approvedBy ? { approvedBy: String(approvedBy).slice(0, 64) } : {}),
        ...(goalSlug ? { goalSlug: String(goalSlug).slice(0, 100) } : {}),
    };
    const line = JSON.stringify(record) + '\n';

    // Append; size cap is enforced after read (DynamoDB has no native string-trim).
    const { Item: existing } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id, createdAt: CSIMPLE_CREATED_AT },
    }));
    let newText = (existing?.text || '') + line;
    if (Buffer.byteLength(newText, 'utf-8') > ACTION_RING_BUFFER_BYTES) {
        // Drop oldest lines until we fit.
        const lines = newText.split('\n');
        while (lines.length > 1 && Buffer.byteLength(lines.join('\n'), 'utf-8') > ACTION_RING_BUFFER_BYTES) {
            lines.shift();
        }
        newText = lines.join('\n');
    }
    const sizeBytes = Buffer.byteLength(newText, 'utf-8');
    const nextVersion = (existing?.version || 0) + 1;

    await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            id,
            createdAt: CSIMPLE_CREATED_AT,
            kind: 'action',
            slug,
            name: today,
            text: newText,
            sizeBytes,
            version: nextVersion,
            createdAtReal: existing?.createdAtReal || now,
            updatedAt: now,
        },
    }));

    res.status(200).json({ success: true, slug, sizeBytes, version: nextVersion });
});

// @desc    Aggregate per-tool execution telemetry from the user's `action`
//          ring-buffer items. Cheap server-side rollup of recent activity
//          so the web UI can show "what your agent has been doing".
// @route   GET /api/data/csimple/workspace/telemetry/summary
// @access  Private
// @query   days  - look back window in days (default 7, max 30)
//          tool  - optional filter to a single tool name
const getTelemetrySummary = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    const toolFilter = typeof req.query.tool === 'string' ? req.query.tool.trim() : '';

    // Build the list of action slugs (YYYYMMDD) for the look-back window.
    const today = new Date();
    const slugs = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(today.getTime() - i * 86_400_000);
        slugs.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }

    // Fetch each daily ring buffer in parallel.
    const items = await Promise.all(slugs.map(async (slug) => {
        try {
            const { Item } = await dynamodb.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { id: itemId(req.user.id, 'action', slug), createdAt: CSIMPLE_CREATED_AT },
            }));
            return Item;
        } catch { return null; }
    }));

    // Aggregate per-tool counts, latency percentiles, and error counts.
    const byTool = new Map();
    let totalRecords = 0;
    let parseErrors = 0;
    for (const item of items) {
        if (!item || !item.text || item.deletedAt) continue;
        const lines = String(item.text).split('\n');
        for (const ln of lines) {
            const trimmed = ln.trim();
            if (!trimmed) continue;
            let rec;
            try { rec = JSON.parse(trimmed); } catch { parseErrors++; continue; }
            if (!rec || typeof rec.tool !== 'string') continue;
            if (toolFilter && rec.tool !== toolFilter) continue;
            totalRecords++;
            let agg = byTool.get(rec.tool);
            if (!agg) {
                agg = {
                    tool: rec.tool, count: 0, ok: 0, fail: 0,
                    latencies: [], approvedBy: {}, errors: [],
                };
                byTool.set(rec.tool, agg);
            }
            agg.count++;
            const ok = rec.exitCode === 0 || rec.exitCode == null;
            if (ok) agg.ok++; else agg.fail++;
            if (typeof rec.durationMs === 'number' && rec.durationMs >= 0) {
                agg.latencies.push(rec.durationMs);
            }
            if (rec.approvedBy) {
                agg.approvedBy[rec.approvedBy] = (agg.approvedBy[rec.approvedBy] || 0) + 1;
            }
            if (!ok && rec.result) {
                // Keep only the top-N most recent error snippets per tool.
                if (agg.errors.length < 5) agg.errors.push(String(rec.result).slice(0, 200));
            }
        }
    }

    function pct(arr, p) {
        if (!arr.length) return null;
        const sorted = arr.slice().sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return sorted[idx];
    }

    const tools = Array.from(byTool.values()).map(a => ({
        tool: a.tool,
        count: a.count,
        ok: a.ok,
        fail: a.fail,
        successRate: a.count ? +(a.ok / a.count).toFixed(3) : null,
        latencyMs: {
            p50: pct(a.latencies, 50),
            p95: pct(a.latencies, 95),
            max: a.latencies.length ? Math.max(...a.latencies) : null,
        },
        approvedBy: a.approvedBy,
        recentErrors: a.errors,
    })).sort((x, y) => y.count - x.count);

    // §10.2 P0: surface this author's marketplace downloads/installs/
    // creations alongside per-tool action telemetry, so the web UI has one
    // endpoint for "what your agent has been doing" instead of two. Best
    // effort: a marketplace lookup failure must never break the (already
    // computed) action telemetry response.
    let marketplace = null;
    try {
        const { getAuthorMarketplaceTotals } = getMarketplaceController();
        marketplace = await getAuthorMarketplaceTotals(req.user.id);
    } catch {
        marketplace = null;
    }

    res.status(200).json({
        windowDays: days,
        toolFilter: toolFilter || null,
        totalRecords,
        parseErrors,
        tools,
        marketplace,
    });
});

// @desc    Compile an English macro description into executable skill steps.
//          Mirrors the addon's nl-compiler.js but runs on the portfolio backend,
//          so it works even when the addon's automation layer fails to mount.
// @route   POST /api/data/csimple/compile-natural
// @access  Private
const compileMacroNatural = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);

    const { description, context } = req.body || {};
    if (!description || typeof description !== 'string' || !description.trim()) {
        badRequest(res, 'description is required');
    }
    if (description.length > 2000) badRequest(res, 'description too long (max 2000 chars)');

    // Use the same token-fetching function as the chat endpoint
    // (handles encryption correctly via secretCrypto)
    const { getUserGithubToken } = require('../services/llmService');
    const githubToken = await getUserGithubToken(dynamodb, req.user.id);

    if (!githubToken) {
        res.status(422);
        throw new Error('No GitHub PAT found. In CSimple → Settings → Advanced, paste your GitHub Personal Access Token and save, then try again.');
    }

    // NL compiler schema documentation (mirrors nl-compiler.js exactly)
    const STEP_SCHEMA = `
Valid step types:
  {"type":"key_tap","keys":["w"],"repeat":1}
  {"type":"key_hold","keys":["w"],"duration_ms":500}
  {"type":"type_text","text":"Hello world"}
  {"type":"wait_ms","ms":1000}
  {"type":"click_at","x":960,"y":540}
  {"type":"click_visual","target":"the Submit button"}
  {"type":"open_app","name":"notepad.exe"}
  {"type":"shell_run","command":"dir C:\\\\Users"}
  {"type":"uia_invoke","name":"OK","controlType":"Button"}
  {"type":"skill_run","slug":"my-skill"}
  {"type":"loop_until_key","key":"Escape","body":[...steps...]}
  {"type":"loop_n_times","times":5,"body":[...steps...]}
  {"type":"screenshot_check","condition":"Is the dialog closed?"}
  {"type":"speak","text":"Done!"}
  {"type":"goal_done"}

Rules:
- For "until I press X" → use loop_until_key with the correct key name
- For "repeat N times" → use loop_n_times
- Prefer click_visual or uia_invoke over click_at for named UI elements
- For opening apps → use open_app, not shell_run
- Do NOT use shell_run for destructive operations (rm, del, format, shutdown, etc.)
- Max 30 steps total, no nested loops
`;

    const prompt = [
        'Convert the following natural language macro description into a JSON step array for Windows automation.',
        'Return ONLY a JSON object: {"steps": [...]}',
        '',
        STEP_SCHEMA,
        context ? `Context about the user\'s environment: ${context.slice(0, 500)}` : '',
        '',
        `Macro description: ${description.trim()}`,
        '',
        'Reply with ONLY valid JSON. No prose. No markdown fences.',
    ].filter(Boolean).join('\n');

    // Call GitHub Models using the same pattern as llmService
    let steps;
    try {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({
            baseURL: 'https://models.github.ai/inference',
            apiKey: githubToken,
        });
        const response = await client.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a Windows macro compiler. Output only valid JSON.' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 2048,
        });
        const text = response?.choices?.[0]?.message?.content || '';
        // Extract JSON from the response
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON found in LLM response');
        const parsed = JSON.parse(match[0]);
        steps = parsed.steps || parsed;
        if (!Array.isArray(steps)) throw new Error('LLM did not return a steps array');
        if (steps.length === 0) throw new Error('Compiled macro has no steps');
        if (steps.length > 30) steps = steps.slice(0, 30);
    } catch (e) {
        if (e.status === 401 || e.message?.includes('401')) {
            res.status(422);
            throw new Error('GitHub token is invalid or expired. Update your PAT in CSimple → Settings → Advanced, then try again.');
        }
        if (e.status === 403 || e.message?.includes('403')) {
            res.status(422);
            throw new Error('GitHub token lacks GitHub Models access. Visit github.com/marketplace/models, accept the terms, then try again.');
        }
        res.status(500);
        throw new Error('Macro compilation failed. Check that your GitHub PAT is valid and try again.');
    }

    res.status(200).json({
        ok: true,
        steps,
        meta: {
            description: description.trim().slice(0, 200),
            stepCount: steps.length,
            compiledAt: new Date().toISOString(),
            via: 'backend',
        },
    });
});

// Same destructive-operation deny-list used by compileMacroNatural's prompt rules,
// re-checked here on the returned steps since edited macros may carry over
// legacy {tool,args} shell_run steps that the prompt alone can't guarantee against.
const FORBIDDEN_SHELL_SNIPPETS = ['rm ', 'del ', 'format ', 'rmdir', 'rd ', 'shutdown', 'reboot', 'taskkill', 'net user', 'reg delete'];

function scanForForbiddenCommands(value, path = 'steps') {
    if (Array.isArray(value)) {
        value.forEach((v, i) => scanForForbiddenCommands(v, `${path}[${i}]`));
        return;
    }
    if (!value || typeof value !== 'object') return;
    const cmd = value.command;
    if (typeof cmd === 'string') {
        const lower = cmd.toLowerCase();
        if (FORBIDDEN_SHELL_SNIPPETS.some(f => lower.includes(f))) {
            throw new Error(`${path}: command contains a forbidden/destructive operation`);
        }
    }
    for (const k of Object.keys(value)) {
        if (k === 'command') continue;
        scanForForbiddenCommands(value[k], `${path}.${k}`);
    }
}

// @desc    Modify an EXISTING macro's steps using a natural-language
//          instruction (e.g. "press z after the shift click"). Mirrors the
//          addon's nl-compiler.js editSteps(), runs on the portfolio backend
//          as a fallback for users without the addon's automation layer.
// @route   POST /api/data/csimple/edit-natural
// @access  Private
const editMacroNatural = asyncHandler(async (req, res) => {
    if (!req.user) unauthorized(res);

    const { steps, instruction, context } = req.body || {};
    if (!Array.isArray(steps) || steps.length === 0) {
        badRequest(res, 'steps must be a non-empty array');
    }
    if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
        badRequest(res, 'instruction is required');
    }
    if (instruction.length > 1000) badRequest(res, 'instruction too long (max 1000 chars)');

    const { getUserGithubToken } = require('../services/llmService');
    const githubToken = await getUserGithubToken(dynamodb, req.user.id);

    if (!githubToken) {
        res.status(422);
        throw new Error('No GitHub PAT found. In CSimple → Settings → Advanced, paste your GitHub Personal Access Token and save, then try again.');
    }

    const STEP_SCHEMA = `
Valid step types:
  {"type":"key_tap","keys":["w"],"repeat":1}
  {"type":"key_hold","keys":["w"],"duration_ms":500}
  {"type":"type_text","text":"Hello world"}
  {"type":"wait_ms","ms":1000}
  {"type":"click_at","x":960,"y":540}
  {"type":"click_visual","target":"the Submit button"}
  {"type":"open_app","name":"notepad.exe"}
  {"type":"shell_run","command":"dir C:\\\\Users"}
  {"type":"uia_invoke","name":"OK","controlType":"Button"}
  {"type":"skill_run","slug":"my-skill"}
  {"type":"loop_until_key","key":"Escape","body":[...steps...]}
  {"type":"loop_n_times","times":5,"body":[...steps...]}
  {"type":"screenshot_check","condition":"Is the dialog closed?"}
  {"type":"speak","text":"Done!"}
  {"type":"goal_done"}
`;

    const stepsJson = JSON.stringify(steps).slice(0, 12000);
    const prompt = [
        'You are editing an EXISTING Windows automation macro (a JSON array of steps).',
        'The user will describe a change in plain English. Apply ONLY that change and',
        'return the FULL resulting step array — keep every unrelated step exactly as-is',
        '(same field names, same values, same schema/shape). Do not reformat or "clean up"',
        'steps that were not part of the requested change.',
        '',
        'Current steps (JSON array):',
        stepsJson,
        '',
        'Reference — step schema (existing steps may use this shape, OR the legacy recorded',
        'shape `{"tool":"...","args":{...}}` — if a step already uses the legacy shape, keep',
        'using it unless adding a brand-new step, in which case prefer the shape below):',
        STEP_SCHEMA,
        context ? `Context about the user's environment: ${context.slice(0, 500)}` : '',
        '',
        `Requested change: ${instruction.trim()}`,
        '',
        'Return ONLY a JSON object: {"steps": [...]}',
        'Reply with ONLY valid JSON. No prose. No markdown fences.',
    ].filter(Boolean).join('\n');

    let newSteps;
    try {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({
            baseURL: 'https://models.github.ai/inference',
            apiKey: githubToken,
        });
        const response = await client.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a Windows macro editor. Output only valid JSON.' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 2048,
        });
        const text = response?.choices?.[0]?.message?.content || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON found in LLM response');
        const parsed = JSON.parse(match[0]);
        newSteps = parsed.steps || parsed;
        if (!Array.isArray(newSteps)) throw new Error('LLM did not return a steps array');
        if (newSteps.length === 0) throw new Error('Edited macro has no steps');
        if (newSteps.length > 30) newSteps = newSteps.slice(0, 30);
        newSteps.forEach((s, i) => {
            if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`step[${i}] must be an object`);
            if (!s.type && !s.tool) throw new Error(`step[${i}] must have a "type" or "tool" field`);
        });
        scanForForbiddenCommands(newSteps);
    } catch (e) {
        if (e.status === 401 || e.message?.includes('401')) {
            res.status(422);
            throw new Error('GitHub token is invalid or expired. Update your PAT in CSimple → Settings → Advanced, then try again.');
        }
        if (e.status === 403 || e.message?.includes('403')) {
            res.status(422);
            throw new Error('GitHub token lacks GitHub Models access. Visit github.com/marketplace/models, accept the terms, then try again.');
        }
        res.status(422);
        throw new Error(`Macro edit failed: ${e.message}`);
    }

    res.status(200).json({
        ok: true,
        steps: newSteps,
        meta: {
            instruction: instruction.trim().slice(0, 200),
            stepCount: newSteps.length,
            previousStepCount: steps.length,
            editedAt: new Date().toISOString(),
            via: 'backend',
        },
    });
});

module.exports = {
    listWorkspace,
    getWorkspaceItem,
    upsertWorkspaceItem,
    deleteWorkspaceItem,
    appendLog,
    appendAction,
    getNextGoal,
    getTelemetrySummary,
    getWorkspaceContextPreview,
    getWorkspaceTemplates,
    compileMacroNatural,
    editMacroNatural,
    // Exported for use by llmService when assembling system prompts:
    _internal: {
        ALLOWED_KINDS,
        ALLOWED_KNOWLEDGE_STAGES,
        GOAL_STATUSES,
        CSIMPLE_CREATED_AT,
        TABLE_NAME,
        itemId,
        userPrefix,
    },
};
