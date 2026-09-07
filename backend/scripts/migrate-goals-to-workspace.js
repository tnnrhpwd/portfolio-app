/**
 * migrate-goals-to-workspace.js
 *
 * One-time (idempotent) migration: copy every legacy memory-store goal
 * (memoryService `type = 'goal'`) into the canonical workspace goal store
 * (workspaceGoals.js, `kind = 'goal'`).
 *
 * Mapping:
 *   data.title          → name
 *   data.description    → content (deadline appended as a line if present)
 *   data.status         → status  (completed → done; active/paused pass through)
 *   data.priority       → priority (high=90, medium=50, low=10)
 *   memory item `_id`   → sourceMemoryId
 *
 * Idempotent: if a workspace goal already has this sourceMemoryId, the goal is
 * updated in place (same slug) rather than duplicated.
 *
 * Usage:
 *   node scripts/migrate-goals-to-workspace.js           # dry run (no writes)
 *   node scripts/migrate-goals-to-workspace.js --apply   # write
 */

require('dotenv').config();
const { loadAllSecrets } = require('../utils/awsSecrets');

const APPLY = process.argv.includes('--apply');

function parseMemoryText(text) {
    const creatorMatch = text.match(/^Creator:([^|]+)/);
    const typeMatch = text.match(/\|Memory:([^|]+)\|/);
    if (!creatorMatch || !typeMatch) return null;
    const userId = creatorMatch[1];
    const type = typeMatch[1];
    const jsonStart = text.indexOf(`|Memory:${type}|`) + `|Memory:${type}|`.length;
    let payload;
    try {
        payload = JSON.parse(text.substring(jsonStart));
    } catch {
        payload = { text: text.substring(jsonStart) };
    }
    return { userId, type, payload };
}

function contentFor(data) {
    const description = typeof data.description === 'string' && data.description.trim()
        ? data.description.trim()
        : (typeof data.title === 'string' ? data.title : '');
    const deadline = data.deadline ? `\n\nDeadline: ${data.deadline}` : '';
    return `${description}${deadline}`.trim();
}

async function main() {
    console.log(`[migrate-goals] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    // Hydrate AWS_REGION (+ any other missing config) from Secrets Manager.
    const hydrate = await loadAllSecrets();
    console.log(`[migrate-goals] secrets: ${hydrate.source} (${hydrate.loaded} loaded), region=${process.env.AWS_REGION || 'us-east-1'}`);

    // Construct DynamoDB clients only AFTER hydration (workspaceGoals.js builds
    // its client at module load, so require it here too).
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const { listGoals, upsertGoal, normalizeGoalTitle } = require('../services/workspaceGoals');

    const client = new DynamoDBClient({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    const dynamodb = DynamoDBDocumentClient.from(client);
    const TABLE_NAME = 'Simple';

    const rows = [];
    let lastEvaluatedKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'contains(#text, :memGoal)',
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: { ':memGoal': '|Memory:goal|' },
            ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
        }));
        if (result.Items) rows.push(...result.Items);
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const memoryGoals = [];
    for (const row of rows) {
        const parsed = parseMemoryText(row.text || '');
        if (!parsed || parsed.type !== 'goal') continue;
        memoryGoals.push({
            _id: row.id,
            userId: parsed.userId,
            data: parsed.payload,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

    console.log(`\nFound ${memoryGoals.length} legacy memory goal(s).\n`);

    const byUser = {};
    for (const g of memoryGoals) {
        (byUser[g.userId] ||= []).push(g);
    }

    let created = 0;
    let updated = 0;
    let collapsed = 0;
    const errors = [];

    // Status preference when several memory goals share a title: the live
    // state wins, then newest-updated. This collapses the duplicate memory
    // goals (e.g. "Improve open class feeling…" saved 3×) into ONE canonical
    // workspace goal per title.
    const statusRank = { active: 0, paused: 1, blocked: 2, failed: 3, done: 4, completed: 4 };
    const rankStatus = (s) => (s in statusRank ? statusRank[s] : 1);

    for (const [userId, goals] of Object.entries(byUser)) {
        const existing = await listGoals(userId);
        const existingBySource = new Map(
            existing.filter(g => g.sourceMemoryId).map(g => [g.sourceMemoryId, g])
        );

        // Dedupe by normalized title, keeping the best (live > newest) item.
        const bestByTitle = new Map();
        for (const g of goals) {
            const title = typeof g.data.title === 'string' ? g.data.title : 'untitled-goal';
            const key = normalizeGoalTitle(title) || title.toLowerCase();
            const current = bestByTitle.get(key);
            const better = !current
                || rankStatus(g.data.status) < rankStatus(current.data.status)
                || (rankStatus(g.data.status) === rankStatus(current.data.status)
                    && new Date(g.updatedAt || g.createdAt || 0) > new Date(current.updatedAt || current.createdAt || 0));
            if (better) bestByTitle.set(key, g);
        }
        if (bestByTitle.size < goals.length) {
            collapsed += goals.length - bestByTitle.size;
        }

        console.log(`\n── user ${userId} — ${goals.length} memory goal(s), ${bestByTitle.size} unique after dedupe ──`);

        for (const g of bestByTitle.values()) {
            const title = typeof g.data.title === 'string' ? g.data.title : 'untitled-goal';
            const status = g.data.status === 'completed' ? 'done'
                : (['active', 'paused', 'blocked', 'done', 'failed'].includes(g.data.status) ? g.data.status : 'active');
            const existingGoal = existingBySource.get(g._id);
            const action = existingGoal ? 'update' : 'create';

            console.log(`  ${action === 'create' ? '+' : '~'} ${title} (${g.data.status || 'active'} → ${status}) [${g._id.slice(0, 8)}]`);

            if (APPLY) {
                try {
                    await upsertGoal(userId, {
                        name: title,
                        content: contentFor(g.data),
                        status,
                        priority: g.data.priority || 'medium',
                        sourceMemoryId: g._id,
                        createdBy: 'user',
                    });
                    if (action === 'create') created++; else updated++;
                } catch (err) {
                    errors.push({ title, err: err.message });
                    console.error(`    ! failed: ${err.message}`);
                }
            } else {
                if (action === 'create') created++; else updated++;
            }
        }
    }

    console.log(`\n──────────────────────────────────────────`);
    console.log(`Summary: ${created} create(s), ${updated} update(s), ${collapsed} duplicate(s) collapsed, ${errors.length} error(s).`);
    if (!APPLY) {
        console.log('Dry run complete — no data written. Re-run with --apply to write.');
    }
    if (errors.length) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('[migrate-goals] fatal:', err.message);
    process.exit(1);
});
