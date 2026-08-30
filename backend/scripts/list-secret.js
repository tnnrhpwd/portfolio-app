// list-secret.js — Print the key names (never values) in the AWS Secrets
// Manager secret that hydrates the backend at boot.
//
// Usage:
//   npm run secret:list
//   node backend/scripts/list-secret.js [-SecretId portfolio-app/production] [-Region us-east-1]

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

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
        if (a === '-SecretId') opts.secretId = args[++i];
        else if (a === '-Region') opts.region = args[++i];
    }
    return opts;
}

const { secretId, region } = parseArgs();
const SECRET_ID = secretId || process.env.SECRETS_MANAGER_SECRET_ID || 'portfolio-app/production';
const REGION = region || process.env.AWS_REGION || 'us-east-1';

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

    const result = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    const parsed = JSON.parse(result.SecretString);
    const names = Object.keys(parsed).sort();

    console.log(`Secret '${SECRET_ID}' (${REGION}) — ${names.length} key(s):`);
    for (const name of names) {
        const value = parsed[name];
        const empty = value === null || value === undefined || value === '';
        console.log(`  - ${name}${empty ? '  (empty)' : ''}`);
    }
}

main().catch((err) => {
    console.error(`list-secret failed: ${err.message}`);
    process.exit(1);
});
