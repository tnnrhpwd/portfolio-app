/**
 * archive-legacy-goals.js
 *
 * Reversible soft-delete for the legacy memory-store goals that were migrated
 * into the workspace store by scripts/migrate-goals-to-workspace.js. Nothing
 * reads memory `type='goal'` anymore — /plans, the /simple dashboard, the AI
 * chat tools, and the goal agent all use the workspace `kind='goal'` store.
 *
 * Instead of deleting rows, this rewrites the type marker in each row's `text`
 * from `|Memory:goal|` → `|Memory:goal-archived|`. That makes the item drop out
 * of every goal read path (`getMemoryItems(userId, 'goal')`, `getGoalsSummary`,
 * the /plans Goals tab) while keeping the original data + payload intact and
 * trivially restorable by flipping the marker back.
 *
 * Usage:
 *   node scripts/archive-legacy-goals.js           # dry run (no writes)
 *   node scripts/archive-legacy-goals.js --apply   # rewrite the markers
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

async function main() {
    console.log(`[archive-legacy-goals] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    const hydrate = await loadAllSecrets();
    console.log(`[archive-legacy-goals] secrets: ${hydrate.source} (${hydrate.loaded} loaded), region=${process.env.AWS_REGION || 'us-east-1'}`);

    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

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

    const goals = [];
    for (const row of rows) {
        const parsed = parseMemoryText(row.text || '');
        if (!parsed || parsed.type !== 'goal') continue;
        goals.push({
            _id: row.id,
            userId: parsed.userId,
            data: parsed.payload,
            createdAt: row.createdAt,
            text: row.text,
        });
    }

    console.log(`\nFound ${goals.length} legacy memory goal(s).\n`);

    let archived = 0;
    const errors = [];

    for (const g of goals) {
        const title = typeof g.data.title === 'string' ? g.data.title : 'untitled-goal';
        console.log(`  ${APPLY ? 'archived' : 'would archive'} [${g._id.slice(0, 8)}] "${title}" (user ${g.userId})`);

        if (APPLY) {
            try {
                const newText = g.text.replace('|Memory:goal|', '|Memory:goal-archived|');
                await dynamodb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { id: g._id, createdAt: g.createdAt },
                    UpdateExpression: 'SET #text = :t, updatedAt = :now',
                    ExpressionAttributeNames: { '#text': 'text' },
                    ExpressionAttributeValues: { ':t': newText, ':now': new Date().toISOString() },
                }));
                archived++;
            } catch (err) {
                errors.push({ title, err: err.message });
                console.error(`    ! failed: ${err.message}`);
            }
        } else {
            archived++;
        }
    }

    console.log(`\n──────────────────────────────────────────`);
    console.log(`Summary: ${archived} archived, ${errors.length} error(s).`);
    if (!APPLY) {
        console.log('Dry run complete — no data written. Re-run with --apply to archive.');
        console.log('To restore later, flip |Memory:goal-archived| back to |Memory:goal|.');
    }
    if (errors.length) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('[archive-legacy-goals] fatal:', err.message);
    process.exit(1);
});
