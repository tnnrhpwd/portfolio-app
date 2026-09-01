/**
 * list-bedrock-models.js — diagnostic: list image-generation models available
 * to this account via the Bedrock control-plane API (ListFoundationModels).
 * Prints id / provider / lifecycle so we can pick a working modelId.
 *
 * Run: node scripts/list-bedrock-models.js [region]
 */
require('dotenv').config();
const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');

const region = process.argv[2] || process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';

async function list(reg) {
    const client = new BedrockClient({
        region: reg,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });

    const results = [];
    let nextToken;
    do {
        const cmd = new ListFoundationModelsCommand({
            byOutputModality: 'IMAGE',
            ...(nextToken ? { nextToken } : {}),
        });
        const res = await client.send(cmd);
        results.push(...(res.modelSummaries || []));
        nextToken = res.nextToken;
    } while (nextToken);

    console.log(`\n=== Image-output models in ${reg} (${results.length}) ===`);
    for (const m of results) {
        const status = m.modelLifecycle?.status || '?';
        console.log(
            `${status.padEnd(10)} | ${m.providerName.padEnd(12)} | ${m.modelId.padEnd(42)} | ${m.modelName}`
        );
    }
}

(async () => {
    try {
        await list(region);
    } catch (e) {
        console.error(`\nERROR listing models in ${region}: ${e.name}: ${e.message}`);
    }
})();
