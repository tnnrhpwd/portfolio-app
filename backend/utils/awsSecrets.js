// awsSecrets.js - Load secrets from AWS Secrets Manager at startup.
//
// The DeepSeek API key is stored in AWS Secrets Manager so it lives in the
// same AWS environment as the rest of this app's infrastructure (DynamoDB,
// S3, SES, Bedrock). The Render-hosted backend reaches AWS with the same
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY credentials it already uses, so it
// can fetch the secret on boot.
//
// The lookup is strictly a fallback: if DEEPSEEK_API_KEY is already set in the
// environment (local `.env`, Render env var, etc.), no AWS call is made. This
// keeps local development and CI free of any AWS dependency.

const { logger } = require('./logger');

// Secret id in AWS Secrets Manager. Overridable via DEEPSEEK_API_KEY_SECRET_ID.
const DEFAULT_SECRET_ID = 'portfolio-app/deepseek';

let secretsManagerClient = null;

function getSecretsManagerClient() {
    if (secretsManagerClient) return secretsManagerClient;

    // Never attempt AWS when credentials aren't present — Secrets Manager
    // would just 403, and local dev / CI don't need it.
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return null;
    }

    try {
        // Lazy-required so `npm install` isn't required in environments that
        // only use the plain DEEPSEEK_API_KEY env var.
        const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
        secretsManagerClient = new SecretsManagerClient({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
    } catch (error) {
        logger.warn(
            '[awsSecrets] @aws-sdk/client-secrets-manager is not installed; ' +
            'skipping Secrets Manager lookup. Install it or set DEEPSEEK_API_KEY directly.'
        );
        return null;
    }

    return secretsManagerClient;
}

/**
 * Fetch a secret string from AWS Secrets Manager.
 * Accepts either a plain-string secret or a JSON object secret whose value is
 * under `DEEPSEEK_API_KEY`, `deepseek_api_key`, or `key`.
 *
 * @param {string} secretId
 * @returns {Promise<string|null>}
 */
async function fetchSecretString(secretId) {
    const client = getSecretsManagerClient();
    if (!client) return null;

    const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

    const raw = result.SecretString;
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed.DEEPSEEK_API_KEY || parsed.deepseek_api_key || parsed.key || null;
        }
        return raw;
    } catch {
        // Not JSON — treat as a plain secret string.
        return raw;
    }
}

/**
 * Ensure process.env.DEEPSEEK_API_KEY is populated, using AWS Secrets Manager
 * as a fallback when the env var isn't already set.
 *
 * @returns {Promise<string|null>} The resolved key, or null when unavailable.
 */
async function loadDeepSeekKey() {
    if (process.env.DEEPSEEK_API_KEY) {
        return process.env.DEEPSEEK_API_KEY;
    }

    const secretId = process.env.DEEPSEEK_API_KEY_SECRET_ID || DEFAULT_SECRET_ID;

    try {
        const value = await fetchSecretString(secretId);
        if (value) {
            process.env.DEEPSEEK_API_KEY = value;
            logger.debug(`[awsSecrets] Loaded DeepSeek key from Secrets Manager (${secretId})`);
        }
        return value || null;
    } catch (error) {
        logger.warn(
            `[awsSecrets] Could not load DeepSeek key from Secrets Manager (${secretId}): ${error.message}`
        );
        return null;
    }
}

module.exports = {
    DEFAULT_SECRET_ID,
    fetchSecretString,
    loadDeepSeekKey,
};
