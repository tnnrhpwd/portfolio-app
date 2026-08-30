// seed-secrets.js — Seed the AWS Secrets Manager "all secrets" secret from
// backend/.env. Uses the @aws-sdk/client-secrets-manager already installed in
// backend/node_modules, so no AWS CLI / admin install is required.
//
// Values never leave this machine and are never printed — only key names are
// shown. AWS credentials are read from backend/.env.

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const {
    SecretsManagerClient,
    GetSecretValueCommand,
    PutSecretValueCommand,
    CreateSecretCommand,
} = require('@aws-sdk/client-secrets-manager');

const repoRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(repoRoot, 'backend', '.env');

if (!fs.existsSync(envPath)) {
    console.error(`Env file not found: ${envPath}`);
    process.exit(1);
}
dotenv.config({ path: envPath });

const SECRET_ID = process.env.SECRETS_MANAGER_SECRET_ID || 'portfolio-app/production';
const REGION = process.env.AWS_REGION || 'us-east-1';

// Keys to seed into the single source-of-truth secret: non-AWS secrets plus
// the app config that lives alongside them (region, S3, email, admin id). Only
// the AWS access key pair stays out of the secret — it's the bootstrap needed
// to reach Secrets Manager in the first place. Publishable keys stay out too.
const SECRET_KEYS = [
    // Secrets
    'JWT_SECRET',
    'DEEPSEEK_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'GITHUB_TOKEN',
    'STRIPE_KEY',
    'TEST_STRIPE_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SECRETS_ENCRYPTION_KEY',
    // App config
    'AWS_REGION',
    'AWS_S3_BUCKET',
    'AWS_S3_REGION',
    'AWS_CLOUDFRONT_DOMAIN',
    'USE_CLOUDFRONT',
    'FROM_EMAIL',
    'ADMIN_USER_ID',
];

function isResourceNotFound(err) {
    if (!err) return false;
    return (
        err.name === 'ResourceNotFoundException' ||
        err.Code === 'ResourceNotFoundException' ||
        err.code === 'ResourceNotFoundException' ||
        /can't find the specified secret/i.test(String(err.message || ''))
    );
}

async function main() {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing from backend/.env');
    }

    const client = new SecretsManagerClient({
        region: REGION,
        credentials: { accessKeyId, secretAccessKey },
    });

    // Read the existing secret (if any) so we merge instead of clobbering.
    let existing = {};
    let exists = false;
    try {
        const result = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
        if (result.SecretString) {
            const parsed = JSON.parse(result.SecretString);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                existing = parsed;
            }
        }
        exists = true;
    } catch (err) {
        if (!isResourceNotFound(err)) {
            // Exists but unreadable — fail loudly rather than overwrite it.
            throw err;
        }
    }

    const merged = { ...existing };
    const seeded = [];
    for (const key of SECRET_KEYS) {
        const value = process.env[key];
        if (!value) continue;
        merged[key] = value;
        seeded.push(key);
    }

    if (seeded.length === 0) {
        console.log(`No seedable secret keys found in ${envPath}. Nothing to do.`);
        return;
    }

    const secretString = JSON.stringify(merged);
    if (exists) {
        await client.send(new PutSecretValueCommand({ SecretId: SECRET_ID, SecretString: secretString }));
    } else {
        // PutSecretValue does not create a missing secret — CreateSecret does.
        await client.send(new CreateSecretCommand({ Name: SECRET_ID, SecretString: secretString }));
    }

    console.log(`Seeded ${seeded.length} key(s) into '${SECRET_ID}' (${REGION}):`);
    seeded.sort().forEach((k) => console.log(`  - ${k}`));

    // Validate: read it back and list key names only (never values).
    const verify = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    const names = Object.keys(JSON.parse(verify.SecretString)).sort();
    console.log('');
    console.log(`Validation OK — '${SECRET_ID}' now contains ${names.length} key(s):`);
    names.forEach((k) => console.log(`  - ${k}`));
}

main().catch((err) => {
    console.error(`seed-secrets failed: ${err.message}`);
    process.exit(1);
});
