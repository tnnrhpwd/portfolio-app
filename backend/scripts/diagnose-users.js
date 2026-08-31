// TEMP diagnostic — inspect each user account's password hash validity
// (a past bug overwrote hashes with "[redacted]", locking users out).
// Read-only; never prints hash values.
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({
    region: REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

function parseField(text, key) {
    const m = (text || '').match(new RegExp(`(?:^|\\|)${key}:([^|]*)`));
    return m ? m[1].trim() : '';
}

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

async function main() {
    const items = [];
    let lastKey;
    do {
        const result = await dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            ExclusiveStartKey: lastKey,
        }));
        items.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const users = items.filter((i) => (i.text || '').includes('Email:') && (i.text || '').includes('Password:'));
    console.log(`User accounts: ${users.length}\n`);
    for (const u of users) {
        const nickname = parseField(u.text, 'Nickname');
        const email = parseField(u.text, 'Email');
        const hash = parseField(u.text, 'Password');
        const state = hash === '[redacted]' ? 'REDACTED (broken)' : (BCRYPT.test(hash) ? 'valid bcrypt' : 'MALFORMED');
        console.log(`${nickname.padEnd(18)} ${email.padEnd(30)} id=${u.id}  password=${state}`);
    }
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
