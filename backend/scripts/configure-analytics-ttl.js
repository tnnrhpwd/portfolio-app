/**
 * configure-analytics-ttl.js — enable DynamoDB TTL on the attribute the
 * per-request analytics rows carry, so the shared `Simple` table stops growing
 * without bound.
 *
 * Why this exists
 * ---------------
 * Two writers put one row in `Simple` per user action rather than per user
 * record: `checkIP()` (a visitor row for essentially every non-localhost
 * request) and the page-view beacon (a row per SPA route change). Those rows
 * have no useful life after the admin dashboard's 30-day window, but nothing
 * ever removed them, so the table — and every scan over it — grew forever.
 *
 * The writers stamp `expiresAt` (epoch seconds, see utils/analyticsRetention.js)
 * on each of those rows. DynamoDB only *acts* on it once the table has TTL
 * enabled for that attribute, which is what this script does.
 *
 * Safety
 * ------
 * - TTL deletes only items that carry the attribute. Users, workspace items,
 *   goals, tickets and every other durable row do not carry it and are never
 *   expired by this.
 * - Only one attribute can be TTL-enabled per table, so repointing an existing
 *   TTL at a different attribute needs a disable-then-enable cycle (~1 hour).
 *   This script says so and refuses, rather than erroring mid-flight.
 * - Dry run by default. Pass --apply to actually change the table.
 *
 *   node backend/scripts/configure-analytics-ttl.js           # dry run (safe)
 *   node backend/scripts/configure-analytics-ttl.js --apply   # apply
 *
 * Tunable (env): DYNAMODB_TABLE (Simple), ANALYTICS_RETENTION_DAYS (90).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    DynamoDBClient,
    DescribeTimeToLiveCommand,
    UpdateTimeToLiveCommand,
} = require('@aws-sdk/client-dynamodb');
const { loadAllSecrets } = require('../utils/awsSecrets');
const { TTL_ATTRIBUTE, retentionDays } = require('../utils/analyticsRetention');

const apply = process.argv.includes('--apply');
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'Simple';

/** The TTL specification to install. Exported for tests / other scripts. */
function buildTtlSpec(attribute = TTL_ATTRIBUTE) {
    return { AttributeName: attribute, Enabled: true };
}

/**
 * Decide what to do about the table's current TTL state.
 *
 * Split out from the I/O so the four cases below are testable: a wrong-but-
 * plausible action here (blindly re-enabling an in-flight change, or silently
 * clobbering another attribute) is the kind of mistake an ops script makes once
 * and costs an hour of throttled updates.
 *
 * @param {{TimeToLiveStatus?: string, AttributeName?: string}} description
 * @param {string} [attribute]
 * @returns {{ action: 'noop'|'pending'|'conflict'|'create', reason: string }}
 */
function planTtlChange(description = {}, attribute = TTL_ATTRIBUTE) {
    const status = description.TimeToLiveStatus;
    const current = description.AttributeName;

    if (status === 'ENABLED' && current === attribute) {
        return { action: 'noop', reason: `TTL is already enabled on "${attribute}".` };
    }

    if (status === 'ENABLED' && current && current !== attribute) {
        return {
            action: 'conflict',
            reason: `TTL is enabled on "${current}", not "${attribute}". DynamoDB allows one TTL `
                + 'attribute per table: disable the existing one first, wait for it to settle '
                + '(this can take ~1 hour), then re-run.',
        };
    }

    if (status === 'ENABLING' || status === 'DISABLING') {
        return {
            action: 'pending',
            reason: `A TTL change is already in progress (${status}). Wait for it to settle, then re-run.`,
        };
    }

    return {
        action: 'create',
        reason: `Enable TTL on "${attribute}" (rows expire ${retentionDays()} days after they are written).`,
    };
}

async function main() {
    // Same credential bootstrap server.js uses at boot.
    await loadAllSecrets();

    const client = new DynamoDBClient({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });

    console.log(`\n🕰️  DynamoDB TTL for analytics rows — table "${TABLE_NAME}"\n`);

    const described = await client.send(new DescribeTimeToLiveCommand({ TableName: TABLE_NAME }));
    const description = described.TimeToLiveDescription || {};
    const plan = planTtlChange(description);

    console.log(`   current: status=${description.TimeToLiveStatus || 'DISABLED'}`
        + ` attribute=${description.AttributeName || '—'}`);
    console.log(`   desired: attribute=${TTL_ATTRIBUTE} retention=${retentionDays()} days`);
    console.log(`\n   ${plan.reason}\n`);

    if (plan.action === 'noop') {
        console.log('✅ Nothing to do.\n');
        return;
    }

    if (plan.action !== 'create') {
        console.log('⚠️  Nothing changed — resolve the above and re-run.\n');
        process.exitCode = 1;
        return;
    }

    if (!apply) {
        console.log('🔎 DRY RUN — no changes made. Re-run with --apply to enable TTL.\n');
        return;
    }

    await client.send(new UpdateTimeToLiveCommand({
        TableName: TABLE_NAME,
        TimeToLiveSpecification: buildTtlSpec(),
    }));

    console.log('✅ TTL enablement requested (status will read ENABLING until DynamoDB settles it).');
    console.log('   Expired rows are swept in the background, typically within 48 hours of');
    console.log('   their expiresAt time — reads must never assume a row is already gone.\n');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Failed to configure TTL:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildTtlSpec, planTtlChange, TABLE_NAME };
