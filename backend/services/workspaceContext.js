/**
 * Workspace Context Assembler
 *
 * Builds the workspace portion of the LLM system prompt from a user's
 * cloud-stored AI workspace files. Priority order + byte budget keeps the
 * context predictable and within token limits.
 *
 * Layers (in order, each capped):
 *   1. Core identity (SOUL → USER → MEMORY → AGENTS → TOOLS)
 *   2. Active project state (project/active if present)
 *   3. Active-agent working context (agent/<activeAgent>-working-context, or
 *      any item with kind=agent + agent=<activeAgent>)
 *   4. Most recent daily log tail (last 30 lines)
 *   5. Recent decisions (last 5)
 *   6. Skills referenced in the user's message via @slug
 *
 * Total cap: WORKSPACE_MAX_BYTES (12 KB by default). When a layer would
 * push us over, we drop it and emit a "[…truncated]" marker.
 */

const { GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = 'Simple';
const CSIMPLE_CREATED_AT = '2000-01-01T00:00:00.000Z';

const WORKSPACE_MAX_BYTES = 12 * 1024;
const CORE_SLUGS = ['soul', 'user', 'memory', 'agents', 'tools'];
const LOG_TAIL_LINES = 30;
const DECISIONS_KEEP = 5;
const SKILL_MENTION_RE = /@([a-z0-9][a-z0-9_-]{0,99})/gi;

function itemId(userId, kind, slug) {
    return `csimple_ws_${userId}_${kind}_${slug}`;
}
function userPrefix(userId, kind) {
    return `csimple_ws_${userId}_${kind}_`;
}

async function fetchOne(dynamodb, userId, kind, slug) {
    try {
        const { Item } = await dynamodb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { id: itemId(userId, kind, slug), createdAt: CSIMPLE_CREATED_AT },
        }));
        if (!Item || Item.deletedAt) return null;
        return Item;
    } catch {
        return null;
    }
}

async function fetchAllOfKind(dynamodb, userId, kind) {
    try {
        const { Items } = await dynamodb.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'begins_with(id, :prefix) AND attribute_not_exists(deletedAt)',
            ExpressionAttributeValues: { ':prefix': userPrefix(userId, kind) },
        }));
        return Items || [];
    } catch {
        return [];
    }
}

function bytes(s) { return Buffer.byteLength(s || '', 'utf-8'); }

function pushSection(state, title, body) {
    const block = `\n\n--- ${title} ---\n${(body || '').trim()}\n--- END ${title} ---\n`;
    const size = bytes(block);
    if (state.used + size > WORKSPACE_MAX_BYTES) {
        if (!state.truncated) {
            state.truncated = true;
            state.parts.push(`\n[WORKSPACE truncated — ${title} and later sections omitted to stay under ${WORKSPACE_MAX_BYTES} bytes]\n`);
        }
        return false;
    }
    state.parts.push(block);
    state.used += size;
    state.sections.push(title);
    return true;
}

/**
 * Build the workspace context.
 * @returns {{ workspaceContext: string, sections: string[], bytes: number, truncated: boolean }}
 */
async function buildWorkspaceContext({ dynamodb, userId, activeAgent = null, message = '' }) {
    const state = { parts: [], used: 0, sections: [], truncated: false };

    // 1. CORE identity files — fetched in canonical order
    const coreItems = await Promise.all(
        CORE_SLUGS.map(slug => fetchOne(dynamodb, userId, 'core', slug))
    );
    const coreParts = [];
    for (let i = 0; i < CORE_SLUGS.length; i++) {
        const it = coreItems[i];
        if (it?.text?.trim()) {
            coreParts.push(`### ${CORE_SLUGS[i].toUpperCase()}\n${it.text.trim()}`);
        }
    }
    if (coreParts.length) {
        pushSection(state, 'WORKSPACE CORE', coreParts.join('\n\n'));
    }

    // 2. Active project state
    const proj = await fetchOne(dynamodb, userId, 'project', 'active');
    if (proj?.text?.trim()) {
        pushSection(state, 'ACTIVE PROJECT', proj.text.trim());
    }

    // 2b. Active goals (sorted by priority desc) — the agent loop's worklist
    const goals = await fetchAllOfKind(dynamodb, userId, 'goal');
    if (goals.length) {
        const active = goals.filter(g => (g.status || 'active') === 'active');
        active.sort((a, b) => {
            const pa = typeof a.priority === 'number' ? a.priority : 50;
            const pb = typeof b.priority === 'number' ? b.priority : 50;
            if (pb !== pa) return pb - pa;
            return (a.updatedAt || '').localeCompare(b.updatedAt || '');
        });
        if (active.length) {
            const body = active.slice(0, 5).map(g => {
                const parts = [`### ${g.name || g.slug} [priority=${g.priority ?? 50}]`];
                if (g.successCriteria) parts.push(`Success: ${g.successCriteria}`);
                if (g.constraints)     parts.push(`Constraints: ${g.constraints}`);
                if (g.parentGoalId)    parts.push(`Parent: ${g.parentGoalId}`);
                if (g.text && g.text.trim()) parts.push(g.text.trim());
                return parts.join('\n');
            }).join('\n\n');
            pushSection(state, 'ACTIVE GOALS', body);
        }
    }

    // 2c. Recent automation actions (last ~20 from today's action log)
    const actions = await fetchAllOfKind(dynamodb, userId, 'action');
    if (actions.length) {
        actions.sort((a, b) => (b.slug || '').localeCompare(a.slug || ''));
        const latest = actions[0];
        if (latest?.text) {
            const lines = String(latest.text).split('\n').filter(Boolean);
            const tail = lines.slice(-20).map(l => {
                try {
                    const r = JSON.parse(l);
                    const args = r.args ? JSON.stringify(r.args).slice(0, 80) : '';
                    const res = r.result ? String(r.result).slice(0, 80) : '';
                    return `[${(r.ts || '').slice(11,19)}] ${r.tool}${args ? ' ' + args : ''}${res ? ' → ' + res : ''}${r.exitCode != null ? ' (exit=' + r.exitCode + ')' : ''}`;
                } catch { return l.slice(0, 160); }
            }).join('\n');
            pushSection(state, 'RECENT ACTIONS', tail);
        }
    }

    // 3. Active-agent working context
    if (activeAgent) {
        // Try canonical slug `<agent>-working-context` first, then any agent item with agent=<activeAgent>
        let agentItem = await fetchOne(dynamodb, userId, 'agent', `${activeAgent}-working-context`);
        if (!agentItem) {
            const agentItems = await fetchAllOfKind(dynamodb, userId, 'agent');
            agentItem = agentItems.find(it => it.agent === activeAgent || it.slug === activeAgent) || null;
        }
        if (agentItem?.text?.trim()) {
            pushSection(state, `AGENT (${activeAgent})`, agentItem.text.trim());
        }
    }

    // 4. Most recent daily log tail
    const logs = await fetchAllOfKind(dynamodb, userId, 'log');
    if (logs.length) {
        logs.sort((a, b) => (b.slug || '').localeCompare(a.slug || ''));
        const latest = logs[0];
        if (latest?.text) {
            const lines = String(latest.text).split('\n').filter(Boolean);
            const tail = lines.slice(-LOG_TAIL_LINES).join('\n');
            pushSection(state, `RECENT LOG (${latest.name || latest.slug})`, tail);
        }
    }

    // 5. Recent decisions
    const decisions = await fetchAllOfKind(dynamodb, userId, 'decision');
    if (decisions.length) {
        decisions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        const recent = decisions.slice(0, DECISIONS_KEEP);
        const body = recent
            .map(d => `### ${d.name || d.slug}\n${(d.text || '').trim()}`)
            .join('\n\n');
        pushSection(state, 'RECENT DECISIONS', body);
    }

    // 6. Skills mentioned via @slug in the user's message
    if (message && typeof message === 'string') {
        const mentioned = new Set();
        let m;
        SKILL_MENTION_RE.lastIndex = 0;
        while ((m = SKILL_MENTION_RE.exec(message)) !== null) {
            mentioned.add(m[1].toLowerCase());
        }
        if (mentioned.size > 0) {
            const skillItems = await Promise.all(
                [...mentioned].map(slug => fetchOne(dynamodb, userId, 'skill', slug))
            );
            const present = skillItems.filter(it => it && it.text?.trim());
            if (present.length) {
                const body = present
                    .map(it => `### @${it.slug}\n${it.text.trim()}`)
                    .join('\n\n');
                pushSection(state, 'INVOKED SKILLS', body);
            }
        }
    }

    return {
        workspaceContext: state.parts.join(''),
        sections: state.sections,
        bytes: state.used,
        truncated: state.truncated,
    };
}

module.exports = {
    buildWorkspaceContext,
    WORKSPACE_MAX_BYTES,
    CORE_SLUGS,
};
