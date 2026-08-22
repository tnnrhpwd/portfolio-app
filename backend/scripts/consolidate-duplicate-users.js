// Consolidate Duplicate User Accounts Script
//
// Finds 'Simple' table user records (Email:...|Password:...) that share the
// same email address (case-insensitive), keeps the most recently CREATED
// account as canonical (its id + password become the single surviving
// login), reassigns any data owned by the duplicate account(s) — anything
// with a `Creator:<oldId>` tag (chat/memory history, bug reports, uploads,
// etc. — see services/dataService.js, memoryService.js, llmService.js) —
// over to the canonical account's id, then deletes the duplicate account
// row(s).
//
// This exists because registerUser previously had no duplicate-email/
// nickname check, so a double-submit or retry could silently create a
// second row for the same person. Once that happens, loginUser's own Scan
// finds >1 match and hard-fails every login attempt for that email with
// "Multiple accounts found. Please contact support." — there is no
// self-service recovery, this script (or the same-shaped admin flow) is the
// only fix. See postData.js's registerUser for the corresponding prevention
// fix (duplicate check before insert).
//
// Usage:
//   node scripts/consolidate-duplicate-users.js            # dry run (default) — reports only, no writes
//   node scripts/consolidate-duplicate-users.js --execute  # actually reassigns data + deletes duplicates
//
// Must be run from an environment with .env AWS credentials for the target
// table (backend/.env — AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'Simple';
const EXECUTE = process.argv.includes('--execute');

/** Extract a `Key:value` field from a pipe-delimited text blob. */
function parseField(text, key) {
    const re = new RegExp(`(?:^|\\|)${key}:([^|]*)`);
    const m = text.match(re);
    return m ? m[1].trim() : '';
}

function isUserRecord(text) {
    return text.includes('Email:') && text.includes('Password:');
}

/** Full paginated scan of the Simple table (matches adminController.fullScan). */
async function fullScan() {
    const items = [];
    let lastKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: TABLE_NAME,
            ExclusiveStartKey: lastKey,
        }));
        items.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

async function main() {
    console.log(EXECUTE ? '=== EXECUTE MODE (will write/delete) ===' : '=== DRY RUN (no writes will be made; pass --execute to apply) ===');

    const allItems = await fullScan();
    const userItems = allItems.filter((item) => isUserRecord(item.text || ''));
    console.log(`Scanned ${allItems.length} total records, ${userItems.length} are user accounts.`);

    // Group user accounts by normalized (lowercased) email.
    const groups = new Map();
    for (const item of userItems) {
        const email = parseField(item.text, 'Email').toLowerCase();
        if (!email) continue;
        if (!groups.has(email)) groups.set(email, []);
        groups.get(email).push(item);
    }

    const dupGroups = [...groups.entries()].filter(([, items]) => items.length > 1);
    if (dupGroups.length === 0) {
        console.log('No duplicate accounts found. Nothing to do.');
        return;
    }

    console.log(`Found ${dupGroups.length} duplicate email group(s).\n`);

    let totalDeleted = 0;
    let totalReassigned = 0;

    for (const [email, items] of dupGroups) {
        // Canonical = most recently created account — its id/password survive.
        const sorted = [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        const canonical = sorted[0];
        const duplicates = sorted.slice(1);

        console.log(`Email: ${email}`);
        console.log(`  KEEP    id=${canonical.id} createdAt=${canonical.createdAt} nickname=${parseField(canonical.text, 'Nickname')}`);

        for (const dup of duplicates) {
            console.log(`  REMOVE  id=${dup.id} createdAt=${dup.createdAt} nickname=${parseField(dup.text, 'Nickname')}`);

            // Reassign any data owned by the duplicate account to the canonical id.
            const ownedItems = allItems.filter((item) => item.id !== dup.id && (item.text || '').includes(`Creator:${dup.id}`));
            if (ownedItems.length > 0) {
                console.log(`          reassigning ${ownedItems.length} owned record(s) -> ${canonical.id}`);
            }
            for (const owned of ownedItems) {
                totalReassigned++;
                if (EXECUTE) {
                    const newText = owned.text.split(`Creator:${dup.id}`).join(`Creator:${canonical.id}`);
                    await dynamodb.send(new PutCommand({
                        TableName: TABLE_NAME,
                        Item: { ...owned, text: newText, updatedAt: new Date().toISOString() },
                    }));
                }
            }

            totalDeleted++;
            if (EXECUTE) {
                await dynamodb.send(new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: { id: dup.id, createdAt: dup.createdAt },
                }));
            }
        }
        console.log('');
    }

    console.log(
        `${EXECUTE ? 'Deleted' : '[DRY RUN] Would delete'} ${totalDeleted} duplicate account(s) and ` +
        `${EXECUTE ? 'reassigned' : '[DRY RUN] would reassign'} ${totalReassigned} owned record(s).`
    );
    if (!EXECUTE) {
        console.log('Re-run with --execute to apply these changes.');
    }
}

main().catch((err) => {
    console.error('Consolidation script failed:', err);
    process.exit(1);
});
