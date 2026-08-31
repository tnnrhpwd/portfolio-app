// TEMP diagnostic — dump the girlfriend user record's exact text (password
// masked) and the exact characters of its Email field, plus a paginated scan
// for the email substring. Read-only.
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({
    region: REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const GF_ID = 'a62cb9e0457373327df9ece9be31dd05';

async function fullScan(filter) {
    const items = [];
    let lastKey;
    do {
        const params = { TableName: 'Simple', ExclusiveStartKey: lastKey };
        if (filter) Object.assign(params, filter);
        const r = await dynamodb.send(new ScanCommand(params));
        items.push(...(r.Items || []));
        lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

function charCodes(s) {
    return Array.from(s || '').map((c) => `${c}(${c.codePointAt(0)})`).join(' ');
}

async function main() {
    // 1. Direct query for the girlfriend record (by partition key).
    const q = await dynamodb.send(new QueryCommand({
        TableName: 'Simple',
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': GF_ID },
    }));
    console.log('Direct query items:', (q.Items || []).length);
    for (const it of q.Items || []) {
        const text = it.text || '';
        console.log('--- record text (masked) ---');
        console.log(text.replace(/\|Password:[^|]*/i, '|Password:***'));
        const m = text.match(/Email:([^|]*)/i);
        console.log('Email field value:', JSON.stringify(m ? m[1] : null));
        console.log('Email field char codes:', charCodes(m ? m[1] : ''));
    }

    // 2. Paginated scan using loginUser's exact filter for the email.
    const loginFilter = {
        FilterExpression: 'contains(#text, :emailValue)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':emailValue': 'Email:dakotaprince37@gmail.com' },
    };
    const matches = await fullScan(loginFilter);
    console.log('\nPaginated login-filter matches:', matches.length);
    for (const it of matches) {
        console.log(`  id=${it.id} text=${(it.text || '').replace(/\|Password:[^|]*/i, '|Password:***').slice(0, 120)}`);
    }

    // 3. Paginated scan for raw email substring anywhere.
    const rawFilter = {
        FilterExpression: 'contains(#text, :raw)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':raw': 'dakotaprince37@gmail.com' },
    };
    const raw = await fullScan(rawFilter);
    console.log('\nPaginated raw-substring matches:', raw.length);
    for (const it of raw) {
        console.log(`  id=${it.id} text=${(it.text || '').replace(/\|Password:[^|]*/i, '|Password:***').slice(0, 120)}`);
    }
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
