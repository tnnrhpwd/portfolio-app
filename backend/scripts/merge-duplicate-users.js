/**
 * Merge Duplicate User Accounts — recover from the redacted-password bug.
 *
 * A password-write bug (now fixed) overwrote some users' real bcrypt hash
 * with the literal string "[redacted]", permanently locking them out. Those
 * users then registered a brand-new account to get back in — leaving two
 * rows for the same email: the ORIGINAL (correct createdAt/nickname/email/
 * stripeid/etc., but a broken password) and a NEW one (working password,
 * but a later createdAt).
 *
 * This script merges each duplicate group:
 *   - Keeps the OLDEST salvageable account (preserves the original createdAt
 *     and all other metadata) — this is the "old created-on stuff".
 *   - Replaces its `Password:` field with the NEWEST account's valid hash —
 *     the "new password they made".
 *   - Reassigns any data tagged `Creator:<oldOtherId>` to the kept id.
 *   - Deletes the duplicate account(s).
 *
 * If the oldest account is too corrupted to salvage (missing Email or
 * Nickname), the newest account is kept as-is instead and the older
 * account(s) are merged into it.
 *
 * Usage:
 *   node scripts/merge-duplicate-users.js            # dry run (default) — reports only, no writes
 *   node scripts/merge-duplicate-users.js --execute  # actually merge + delete
 *
 * Must be run from an environment with .env AWS credentials for the target
 * table (backend/.env — AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const path = require('path');
// Load backend/.env regardless of the shell's current working directory.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
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

/** Extract the password hash from a user's text blob. */
function getPassword(text) {
    return parseField(text, 'Password');
}

/** Mask the password hash in a text blob for safe logging. */
function maskText(text) {
    return (text || '').replace(/\|Password:[^|]*/, '|Password:***MASKED***');
}

/** True if a hash looks like a real bcrypt hash (not "[redacted]" or junk). */
function isValidBcrypt(hash) {
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash || '');
}

function isUserRecord(text) {
    return text.includes('Email:') && text.includes('Password:');
}

/** A user record is salvageable if we can still read its Email and Nickname. */
function isSalvageable(text) {
    return Boolean(parseField(text, 'Email')) && Boolean(parseField(text, 'Nickname'));
}

/** Full paginated scan of the Simple table. */
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
    console.log(EXECUTE ? '=== EXECUTE MODE (will write/delete) ===' : '=== DRY RUN (no writes; pass --execute to apply) ===');

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

    // ── Safety backup (execute mode only): snapshot every record that will
    //    be modified or deleted BEFORE any write, so the operation can be
    //    undone by hand if anything goes wrong. ──
    if (EXECUTE) {
        const fs = require('fs');
        const duplicateIds = [];
        const affectedUserRecords = [];
        for (const [, items] of dupGroups) {
            for (const i of items) { duplicateIds.push(i.id); affectedUserRecords.push(i); }
        }
        const affectedOwnedItems = allItems.filter((it) =>
            duplicateIds.some((id) => (it.text || '').includes(`Creator:${id}`))
        );
        const backup = {
            savedAt: new Date().toISOString(),
            duplicateIds,
            userRecords: affectedUserRecords,
            ownedItems: affectedOwnedItems,
        };
        const backupFile = path.join(__dirname, '..', 'logs', `merge-backup-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(backupFile), { recursive: true });
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
        console.log(`Backup written to ${backupFile}\n`);
    }

    let totalDeleted = 0;
    let totalReassigned = 0;

    for (const [email, items] of dupGroups) {
        // Oldest first.
        const sorted = [...items].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];

        // Keeper = oldest salvageable account; fall back to newest if none.
        const salvageable = sorted.filter((i) => isSalvageable(i.text || ''));
        const keeper = salvageable.length > 0 ? salvageable[0] : newest;

        // "New password" = newest valid bcrypt hash in the group (newest first).
        let newPassword = null;
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = getPassword(sorted[i].text || '');
            if (isValidBcrypt(p)) { newPassword = p; break; }
        }

        const others = sorted.filter((i) => i.id !== keeper.id);

        console.log(`Email: ${email}`);
        console.log(`  KEEP    id=${keeper.id} createdAt=${keeper.createdAt} nickname=${parseField(keeper.text, 'Nickname')} password=${isValidBcrypt(getPassword(keeper.text)) ? 'valid' : 'CORRUPTED'}`);
        for (const o of others) {
            console.log(`  REMOVE  id=${o.id} createdAt=${o.createdAt} nickname=${parseField(o.text, 'Nickname')} password=${isValidBcrypt(getPassword(o.text)) ? 'valid' : 'CORRUPTED'}`);
        }

        if (keeper.id === newest.id && others.length > 0) {
            console.log('  NOTE: oldest account was not salvageable — keeping newest account instead.');
        }

        // Always adopt the NEWEST account's valid password — the one the user
        // created to get back in — while preserving the keeper's createdAt and
        // all other metadata ("old created-on stuff").
        let mergedText = keeper.text || '';
        if (newPassword) {
            mergedText = mergedText.replace(/\|Password:[^|]*/, `|Password:${newPassword}`);
            console.log('  PASSWORD: adopting the newest account\'s valid hash (the current password)');
        } else {
            console.log('  PASSWORD: no valid bcrypt hash found anywhere in the group — leaving keeper unchanged');
        }

        if (!EXECUTE) {
            console.log(`  KEEP text   : ${maskText(keeper.text)}`);
            for (const o of others) {
                console.log(`  REMOVE text : ${maskText(o.text)}`);
            }
        }

        // Persist the keeper's merged text FIRST — so a mid-run failure can
        // never leave the user without a working password.
        if (EXECUTE && mergedText !== keeper.text) {
            await dynamodb.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: { ...keeper, text: mergedText, updatedAt: new Date().toISOString() },
            }));
        } else if (mergedText !== keeper.text) {
            console.log('  [DRY RUN] Would update keeper text with the new password');
        }

        // Reassign data owned by the other account(s) to the keeper id.
        for (const o of others) {
            const ownedItems = allItems.filter(
                (item) => item.id !== o.id && item.id !== keeper.id && (item.text || '').includes(`Creator:${o.id}`)
            );
            if (ownedItems.length > 0) {
                console.log(`          reassigning ${ownedItems.length} owned record(s) from ${o.id} -> ${keeper.id}`);
            }
            for (const owned of ownedItems) {
                totalReassigned++;
                if (EXECUTE) {
                    const newText = owned.text.split(`Creator:${o.id}`).join(`Creator:${keeper.id}`);
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
                    Key: { id: o.id, createdAt: o.createdAt },
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
    console.error('Merge script failed:', err);
    process.exit(1);
});
