/**
 * configure-s3-lifecycle.js — put the portfolio S3 bucket on a cost-aware
 * lifecycle so user files don't sit in S3 Standard forever.
 *
 * Why this exists
 * ---------------
 * Every uploaded file is billed at S3 Standard (~$0.023/GB-month, us-east-1)
 * for as long as it lives. A Pro plan gives each user 50 GB of storage, so a
 * handful of heavy users can hold real bytes indefinitely. Most of that data
 * is "write once, read rarely" — a cheaper class is a pure margin win, and the
 * transitions cost nothing (only Intelligent-Tiering charges a per-object fee,
 * which is a bad trade for many small files).
 *
 * Rules applied (see buildLifecycleRules):
 *   - users/  → STANDARD_IA after 30 days (~$0.0125/GB-mo)
 *             → GLACIER_IR  after 90 days (~$0.004/GB-mo, still millisecond access)
 *   - abort incomplete multipart uploads after 7 days (they accrue cost silently)
 *
 * DRY RUN by default. Pass --apply to actually write to S3.
 *
 *   node backend/scripts/configure-s3-lifecycle.js             # dry run (safe)
 *   node backend/scripts/configure-s3-lifecycle.js --apply     # apply
 *   node backend/scripts/configure-s3-lifecycle.js --size      # show bucket size + cost estimate
 *
 * Tunables (env): S3_IA_AFTER_DAYS (30), S3_GLACIER_IR_AFTER_DAYS (90),
 *                 S3_ABORT_MULTIPART_DAYS (7)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  S3Client,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { loadAllSecrets } = require('../utils/awsSecrets');
const { S3_USD_PER_GB_MONTH } = require('../constants/costs');

const apply = process.argv.includes('--apply');
const showSize = process.argv.includes('--size');

function envDays(name, fallback) {
  const raw = parseInt(process.env[name], 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Build the lifecycle rules. Exported so create-s3-bucket.js can apply the
 * same rules to a freshly created bucket.
 * @param {object} [opts]
 * @param {number} [opts.iaDays]         Days before → STANDARD_IA (min 30)
 * @param {number} [opts.glacierIrDays]  Days before → GLACIER_IR (min 90)
 * @param {number} [opts.abortDays]      Days before aborting incomplete multipart uploads
 * @returns {Array<object>} S3 LifecycleRules
 */
function buildLifecycleRules(opts = {}) {
  const iaDays = opts.iaDays ?? envDays('S3_IA_AFTER_DAYS', 30);
  const glacierIrDays = opts.glacierIrDays ?? envDays('S3_GLACIER_IR_AFTER_DAYS', 90);
  const abortDays = opts.abortDays ?? envDays('S3_ABORT_MULTIPART_DAYS', 7);

  // S3 enforces these minimums for the target classes and will reject the
  // config if `iaDays >= glacierIrDays`.
  if (iaDays < 30) throw new Error('iaDays must be >= 30 (Standard-IA minimum storage duration)');
  if (glacierIrDays < 90) throw new Error('glacierIrDays must be >= 90 (Glacier Instant Retrieval minimum)');
  if (iaDays >= glacierIrDays) throw new Error('iaDays must be less than glacierIrDays');

  return [
    {
      ID: 'users-age-to-cheaper-classes',
      Status: 'Enabled',
      Filter: { Prefix: 'users/' },
      Transitions: [
        { Days: iaDays, StorageClass: 'STANDARD_IA' },
        { Days: glacierIrDays, StorageClass: 'GLACIER_IR' },
      ],
    },
    {
      ID: 'abort-incomplete-multipart-uploads',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: abortDays },
    },
  ];
}

/** Paginate ListObjectsV2, returning { bytes, objects, truncated }. */
async function measureBucket(s3Client, bucket) {
  let bytes = 0;
  let objects = 0;
  let token;
  let pages = 0;
  const MAX_PAGES = 200; // 200k objects — enough for a sanity estimate, bounded runtime
  do {
    const res = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents || []) {
      bytes += obj.Size || 0;
      objects += 1;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    pages += 1;
  } while (token && pages < MAX_PAGES);
  return { bytes, objects, truncated: Boolean(token) };
}

const gb = (bytes) => bytes / (1024 ** 3);
const usd = (bytes, cls) => `$${(gb(bytes) * S3_USD_PER_GB_MONTH[cls]).toFixed(2)}`;

async function main() {
  // Hydrate AWS credentials/config from Secrets Manager if not already in env —
  // the same bootstrap path server.js uses at boot.
  await loadAllSecrets();

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_S3_REGION || process.env.AWS_REGION;

  if (!bucket) {
    console.error('❌ AWS_S3_BUCKET is not set (check backend/.env or Secrets Manager).');
    process.exit(1);
  }

  const s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const rules = buildLifecycleRules();

  console.log(apply ? '▶ APPLY MODE — writing lifecycle configuration' : '🔍 DRY RUN — no changes will be written');
  console.log(`   Bucket: ${bucket}  (${region})\n`);

  // ── Show the existing configuration, if any ──
  try {
    const current = await s3Client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    const ids = (current.Rules || []).map((r) => r.ID || '(no id)');
    console.log(`📋 Existing lifecycle rules: ${ids.length ? ids.join(', ') : 'none'}\n`);
  } catch (err) {
    if (err.name === 'NoSuchLifecycleConfiguration' || err.$metadata?.httpStatusCode === 404) {
      console.log('📋 Existing lifecycle rules: none\n');
    } else {
      console.log(`⚠️  Could not read existing lifecycle config: ${err.message}\n`);
    }
  }

  console.log('🧭 Rules to apply:');
  for (const rule of rules) {
    if (rule.Transitions) {
      const t = rule.Transitions
        .map((x) => `${x.Days}d → ${x.StorageClass}`)
        .join(', ');
      console.log(`   • ${rule.ID}  (${rule.Filter.Prefix || '*'})  ${t}`);
    } else {
      console.log(`   • ${rule.ID}  (${rule.Filter.Prefix || '*'})  abort after ${rule.AbortIncompleteMultipartUpload.DaysAfterInitiation}d`);
    }
  }
  console.log('');

  // ── Optional: bucket size + projected monthly storage cost ──
  if (showSize) {
    try {
      const { bytes, objects, truncated } = await measureBucket(s3Client, bucket);
      console.log('📦 Bucket size:');
      console.log(`   ${objects.toLocaleString()}${truncated ? '+' : ''} objects, ${gb(bytes).toFixed(2)} GB`);
      console.log(`   at S3 Standard    ($${S3_USD_PER_GB_MONTH.STANDARD}/GB):  ${usd(bytes, 'STANDARD')}/mo`);
      console.log(`   at Standard-IA    ($${S3_USD_PER_GB_MONTH.STANDARD_IA}/GB): ${usd(bytes, 'STANDARD_IA')}/mo`);
      console.log(`   at Glacier IR     ($${S3_USD_PER_GB_MONTH.GLACIER_IR}/GB):  ${usd(bytes, 'GLACIER_IR')}/mo`);
      console.log('   (list prices for the storage line item only — excludes requests, egress, and CloudFront)\n');
    } catch (err) {
      console.log(`⚠️  Could not measure bucket size: ${err.message}\n`);
    }
  }

  if (!apply) {
    console.log('ℹ️  Dry run — re-run with --apply to write these rules.');
    return;
  }

  await s3Client.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: { Rules: rules },
  }));

  console.log('✅ Lifecycle configuration applied.');
  console.log('   Objects already older than the thresholds transition on the next S3 lifecycle evaluation (usually within 24–48h, and transitions are free).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { buildLifecycleRules, measureBucket, S3_USD_PER_GB_MONTH };
