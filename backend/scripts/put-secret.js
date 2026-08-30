// put-secret.js — Set/update one secret in the AWS Secrets Manager secret that
// hydrates the backend at boot (single source of truth for non-AWS secrets).
//
// Uses @aws-sdk/client-secrets-manager already installed in backend/node_modules,
// so no AWS CLI / admin install is required. AWS credentials come from backend/.env.
//
// Usage:
//   npm run secret:put -- -Name KEY -Value "value"
//   node backend/scripts/put-secret.js -Name KEY -Value "value" [-SecretId id] [-Region us-east-1]

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
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-Name') opts.name = args[++i];
        else if (a === '-Value') opts.value = args[++i];
        else if (a === '-SecretId') opts.secretId = args[++i];
        else if (a === '-Region') opts.region = args[++i];
    }
    return opts;
}

const { name, value, secretId, region } = parseArgs();

if (!name || value === undefined || value === '') {
    console.error('Usage: npm run secret:put -- -Name KEY -Value "value" [-SecretId portfolio-app/production] [-Region us-east-1]');
    process.exit(1);
}

const SECRET_ID = secretId || process.env.SECRETS_MANAGER_SECRET_ID || 'portfolio-app/production';
const REGION = region || process.env.AWS_REGION || 'us-east-1';

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
        throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not found (expected in backend/.env)');
    }

    const client = new SecretsManagerClient({
        region: REGION,
        credentials: { accessKeyId, secretAccessKey },
    });

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
        if (!isResourceNotFound(err)) throw err;
    }

    existing[name] = value;
    const secretString = JSON.stringify(existing);
    if (exists) {
        await client.send(new PutSecretValueCommand({ SecretId: SECRET_ID, SecretString: secretString }));
    } else {
        // PutSecretValue does not create a missing secret — CreateSecret does.
        await client.send(new CreateSecretCommand({ Name: SECRET_ID, SecretString: secretString }));
    }

    console.log(`Updated '${name}' in secret '${SECRET_ID}' (${REGION}).`);
    console.log('Redeploy (or restart) the backend to pick it up.');
}

main().catch((err) => {
    console.error(`put-secret failed: ${err.message}`);
    process.exit(1);
});
