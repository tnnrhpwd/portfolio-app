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
]);

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
};

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
    };
}

function toFullEntry(item) {
    return {
        ...toListEntry(item),
        content: item.text || '',
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
    });
});

module.exports = {
    listWorkspace,
    getWorkspaceItem,
    upsertWorkspaceItem,
    deleteWorkspaceItem,
    appendLog,
    getWorkspaceContextPreview,
    getWorkspaceTemplates,
    // Exported for use by llmService when assembling system prompts:
    _internal: {
        ALLOWED_KINDS,
        ALLOWED_KNOWLEDGE_STAGES,
        CSIMPLE_CREATED_AT,
        TABLE_NAME,
        itemId,
        userPrefix,
    },
};
