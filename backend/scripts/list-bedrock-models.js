/**
 * list-bedrock-models.js — diagnostic: list foundation models available to this
 * account via the Bedrock control-plane API (ListFoundationModels), with an
 * optional output-modality filter and provider/name substring filter.
 *
 * Run:  node scripts/list-bedrock-models.js [region] [modality] [filter]
 *   region   — AWS region (default: AWS_BEDROCK_REGION || AWS_REGION || us-east-1)
 *   modality — IMAGE (default) | TEXT | EMBEDDING | AUDIO | VIDEO | ALL
 *   filter   — case-insensitive substring match on providerName or modelId/name
 *
 * Examples:
 *   node scripts/list-bedrock-models.js us-west-2
 *   node scripts/list-bedrock-models.js us-east-1 AUDIO camb
 *   node scripts/list-bedrock-models.js us-west-2 ALL mars
 */
require('dotenv').config();
const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');

const region = process.argv[2] || process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
const modality = (process.argv[3] || 'IMAGE').toUpperCase();
const filter = (process.argv[4] || '').toLowerCase();

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
        const params = {};
        if (modality !== 'ALL') params.byOutputModality = modality;
        if (nextToken) params.nextToken = nextToken;
        const cmd = new ListFoundationModelsCommand(params);
        const res = await client.send(cmd);
        results.push(...(res.modelSummaries || []));
        nextToken = res.nextToken;
    } while (nextToken);

    const title = modality === 'ALL'
        ? `All models in ${reg}`
        : `${modality}-output models in ${reg}`;
    console.log(`\n=== ${title} (${results.length}) ===`);
    for (const m of results) {
        if (filter) {
            const hay = `${m.providerName || ''} ${m.modelId || ''} ${m.modelName || ''}`.toLowerCase();
            if (!hay.includes(filter)) continue;
        }
        const status = m.modelLifecycle?.status || '?';
        console.log(
            `${status.padEnd(10)} | ${(m.providerName || '').padEnd(16)} | ${(m.modelId || '').padEnd(48)} | ${m.modelName || ''}`
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
