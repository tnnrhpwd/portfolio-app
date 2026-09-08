// marketplace-diagnose.js — read-only diagnostic for the marketplace data.
// Prints which `csimple_market_*` items exist in the "Simple" table and
// whether each one would pass the search endpoint's FilterExpression
// (begins_with(id) AND attribute_exists(marketId) AND attribute_exists(latestVersion)).
// Prints only item IDs + metadata — never steps or other content.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadAllSecrets } = require('../utils/awsSecrets');

const TABLE_NAME = 'Simple';
const PREFIX = 'csimple_market_';

async function main() {
    const hydrate = await loadAllSecrets();
    console.log(`Secrets: ${hydrate.source} (${hydrate.loaded} loaded)`);
    console.log(`Region: ${process.env.AWS_REGION || '(still unset)'}`);

    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

    const client = new DynamoDBClient({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    const dynamodb = DynamoDBDocumentClient.from(client);

    const { Items } = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(id, :prefix)',
        ExpressionAttributeValues: { ':prefix': PREFIX },
    }));

    const items = Items || [];
    console.log(`Items with id beginning "${PREFIX}": ${items.length}\n`);

    if (items.length === 0) {
        console.log('No marketplace items exist in this table at all.');
        console.log('→ The publish did NOT persist here (different AWS account/region, or the table was recreated).');
        return;
    }

    for (const it of items) {
        const hasMarketId = it.marketId !== undefined && it.marketId !== null;
        const hasLatestVersion = it.latestVersion !== undefined && it.latestVersion !== null;
        const passes = hasMarketId && hasLatestVersion;
        console.log(`- ${it.id}`);
        console.log(`    marketId=${hasMarketId ? 'yes' : 'NO'}  latestVersion=${hasLatestVersion ? 'yes' : 'NO'}  => ${passes ? 'APPEARS IN SEARCH' : 'FILTERED OUT'}`);
        if (hasLatestVersion) {
            console.log(`    name="${it.name}"  slug="${it.slug}"  v${it.latestVersion}  author=${it.authorUserId}`);
        }
    }
}

main().catch((err) => {
    console.error('Diagnostic failed:', err.message);
    process.exit(1);
});
