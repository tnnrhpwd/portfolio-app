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

// Secret id for the single "all secrets" JSON object hydrated at boot.
// Overridable via SECRETS_MANAGER_SECRET_ID.
const DEFAULT_ALL_SECRET_ID = 'portfolio-app/production';

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
 * Fetch the raw SecretString for a secret id, with no interpretation.
 * Returns null when no AWS credentials are configured (local dev / CI), so
 * callers can fall back to process.env.
 *
 * @param {string} secretId
 * @returns {Promise<string|null>}
 */
async function fetchRawSecretString(secretId) {
    const client = getSecretsManagerClient();
    if (!client) return null;

    const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    return result.SecretString || null;
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
    const raw = await fetchRawSecretString(secretId);
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

/**
 * Hydrate process.env from the single source-of-truth secret (default:
 * `portfolio-app/production`), which must be a JSON object whose keys are
 * env-var names. Existing env vars (e.g. a local `.env` in dev, or the AWS
 * bootstrap credentials on Render) are never overwritten — the Secrets Manager
 * value only fills gaps. This makes Secrets Manager the authority in
 * production while keeping local dev free of any AWS dependency beyond the
 * credentials already present in `.env`.
 *
 * @returns {Promise<{secretId: string, loaded: number, source: string}>}
 */
async function loadAllSecrets() {
    const secretId = process.env.SECRETS_MANAGER_SECRET_ID || DEFAULT_ALL_SECRET_ID;

    try {
        const raw = await fetchRawSecretString(secretId);
        if (!raw) {
            return { secretId, loaded: 0, source: 'unavailable' };
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            logger.warn(
                `[awsSecrets] ${secretId} is not valid JSON; expected an object of env vars.`
            );
            return { secretId, loaded: 0, source: 'invalid-json' };
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            logger.warn(
                `[awsSecrets] ${secretId} must be a JSON object of env vars; skipped.`
            );
            return { secretId, loaded: 0, source: 'not-an-object' };
        }

        let loaded = 0;
        for (const [key, value] of Object.entries(parsed)) {
            if (value === null || value === undefined || value === '') continue;
            if (process.env[key] === undefined || process.env[key] === '') {
                process.env[key] = String(value);
                loaded += 1;
            }
        }

        if (loaded > 0) {
            logger.info(`[awsSecrets] Hydrated ${loaded} env var(s) from ${secretId}`);
        }
        return { secretId, loaded, source: 'secrets-manager' };
    } catch (error) {
        logger.warn(
            `[awsSecrets] Could not load secrets from ${secretId}: ${error.message}`
        );
        return { secretId, loaded: 0, source: 'error' };
    }
}

module.exports = {
    DEFAULT_SECRET_ID,
    DEFAULT_ALL_SECRET_ID,
    fetchRawSecretString,
    fetchSecretString,
    loadDeepSeekKey,
    loadAllSecrets,
};
