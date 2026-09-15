// llmProviders.js - Unified LLM Provider Interface
require('dotenv').config();
const { trackApiUsage, canMakeApiCall } = require('./apiUsageTracker.js');
const { logger } = require('./logger');

// Available LLM providers and their models
const PROVIDERS = {
    deepseek: {
        name: 'DeepSeek',
        models: {
            'deepseek-chat': { name: 'DeepSeek-V3 (Chat)', contextWindow: 64000 },
            'deepseek-reasoner': { name: 'DeepSeek-R1 (Reasoner)', contextWindow: 64000 }
        },
        // Read lazily (not captured at module load): server.js loads the key
        // from AWS Secrets Manager before routes require this module, but other
        // entry points (tests, scripts, tools) may require it first. A getter
        // always reflects the current env, so the key is never stale.
        get apiKey() { return process.env.DEEPSEEK_API_KEY; },
        client: null,
        baseURL: 'https://api.deepseek.com'
    },
    bedrock: {
        name: 'AWS Bedrock',
        // Cross-region inference profile ID for Claude Haiku 4.5 (verified against
        // docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html).
        // NOT Claude 3.5 Haiku — that model's Bedrock EOL has already passed.
        models: {
            'us.anthropic.claude-haiku-4-5-20251001-v1:0': { name: 'Claude Haiku 4.5', contextWindow: 200000 },
        },
        // Bedrock authenticates via AWS SigV4 credentials — either a dedicated,
        // least-privilege AWS_BEDROCK_ACCESS_KEY_ID/AWS_BEDROCK_SECRET_ACCESS_KEY
        // pair, or (fallback) the same AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY used
        // for DynamoDB in accessData.js — not a bearer apiKey string. This flag
        // just marks the provider "configured" for
        // getAvailableProviders()/validateProviderModel(); see
        // services/bedrockService.js#isBedrockConfigured() for the real check.
        apiKey: !!((process.env.AWS_BEDROCK_ACCESS_KEY_ID && process.env.AWS_BEDROCK_SECRET_ACCESS_KEY) ||
            (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)),
        client: null,
        region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
    }
};

// Initialize LLM clients
async function initializeLLMClients() {
    try {
        // Initialize DeepSeek using the OpenAI SDK (DeepSeek exposes an
        // OpenAI-compatible API at https://api.deepseek.com).
        if (PROVIDERS.deepseek.apiKey && !PROVIDERS.deepseek.client) {
            const openai = await import('openai');
            PROVIDERS.deepseek.client = new openai.OpenAI({
                apiKey: PROVIDERS.deepseek.apiKey,
                baseURL: PROVIDERS.deepseek.baseURL
            });
            logger.debug('✅ DeepSeek client initialized with OpenAI SDK (DeepSeek compatible)');
        }

        return true;
    } catch (error) {
        logger.error('Error initializing LLM clients:', error);
        throw error;
    }
}

// Get available providers and models (with rate info)
// Model tier requirements: which minimum tier is needed for each model.
// Models not listed here are available to all tiers (Free+). Empty today — the
// cloud models are all available to Free and Pro alike (each tier's *usage* is
// instead capped by MEMBERSHIP_LIMITS in apiUsageTracker.js, since every cloud
// provider here is a metered, server-paid one).
const MODEL_TIER_REQUIREMENTS = {};

/** The metering table, lazily (it imports DynamoDB/Stripe at load). */
function apiCosts() {
    try {
        return require('./apiUsageTracker.js').API_COSTS;
    } catch {
        return null;
    }
}

/**
 * Real cost of one model, USD per 1M tokens, from the metering table.
 *
 * Input and output are ADDED rather than compared one at a time: a model that is
 * cheaper on input can be the dearer one to actually run, and a plain ordering
 * has to put that somewhere. Unknown/uncatalogued models rank last
 * (`Infinity`) — an unpriceable model must never win a "cheapest" comparison.
 */
function modelCostPer1M(providerKey, modelId) {
    const table = apiCosts();
    const cost = table?.[providerKey]?.[modelId] || table?.[providerKey]?.default;
    if (!cost || typeof cost.input !== 'number') return Number.POSITIVE_INFINITY;
    return cost.input + (typeof cost.output === 'number' ? cost.output : 0);
}

/** Providers the server actually holds credentials for. */
function configuredProviderKeys() {
    return Object.keys(PROVIDERS).filter((key) => PROVIDERS[key].apiKey);
}

/**
 * The model that answers when the caller names none, and the model every picker
 * pre-selects for a user who has not chosen one: **the cheapest cloud model the
 * server is configured to serve**.
 *
 * This is deliberately computed rather than hardcoded. "Default" used to mean
 * "Bedrock's Claude Haiku 4.5" by virtue of it being the only model the app had,
 * so adding a cheaper provider (DeepSeek) left every user who never touched the
 * picker on the dearer one — including a caller that named no model at all.
 * Ranking lives here, next to the catalogue, so the model the UI defaults to and
 * the model a nameless request bills against cannot disagree.
 *
 * Ties break on provider key then model id, so a deployment always resolves to
 * the same model. With nothing configured it reports the always-on provider's
 * model, which is what the adapter will attempt (and fail loudly on) anyway.
 *
 * @returns {{ provider: string, model: string }}
 */
function getDefaultModel() {
    const candidates = [];
    for (const providerKey of configuredProviderKeys()) {
        for (const modelId of Object.keys(PROVIDERS[providerKey].models)) {
            candidates.push({
                provider: providerKey,
                model: modelId,
                cost: modelCostPer1M(providerKey, modelId),
            });
        }
    }
    if (candidates.length === 0) {
        return { provider: 'bedrock', model: Object.keys(PROVIDERS.bedrock.models)[0] };
    }
    candidates.sort((a, b) =>
        (a.cost - b.cost) ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model));
    return { provider: candidates[0].provider, model: candidates[0].model };
}

function getAvailableProviders() {
    const API_COSTS = apiCosts();
    const { provider: defaultProvider, model: defaultModel } = getDefaultModel();

    const availableProviders = {};

    for (const [providerKey, provider] of Object.entries(PROVIDERS)) {
        if (provider.apiKey) {
            const modelsWithRates = {};
            for (const [modelId, modelInfo] of Object.entries(provider.models)) {
                const cost = API_COSTS?.[providerKey]?.[modelId];
                const ratePer1M = cost ? `$${(cost.input * 1000000).toFixed(2)}/1M` : null;
                modelsWithRates[modelId] = {
                    ...modelInfo,
                    rate: ratePer1M,
                    // Numeric per-1M rates alongside the display string, so a
                    // client can compare costs without parsing "$0.27/1M".
                    inputRate: typeof cost?.input === 'number' ? cost.input * 1000000 : null,
                    outputRate: typeof cost?.output === 'number' ? cost.output * 1000000 : null,
                    requiredTier: MODEL_TIER_REQUIREMENTS[modelId] || 'free',
                    // Exactly one model carries this: see getDefaultModel().
                    isDefault: providerKey === defaultProvider && modelId === defaultModel,
                };
            }
            availableProviders[providerKey] = {
                name: provider.name,
                models: modelsWithRates
            };
        }
    }

    return availableProviders;
}

// Validate provider and model combination
function validateProviderModel(provider, model) {
    if (!PROVIDERS[provider]) {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    if (!PROVIDERS[provider].models[model]) {
        throw new Error(`Unsupported model: ${model} for provider: ${provider}`);
    }
    
    // Every provider requires a server-level credential. There is no
    // per-user-key (BYOK) path.
    if (!PROVIDERS[provider].apiKey) {
        throw new Error(`API key not configured for provider: ${provider}`);
    }
    
    return true;
}

/**
 * Create a completion via AWS Bedrock (Claude Haiku 4.5).
 *
 * Bedrock is NOT an OpenAI-compatible HTTP API and does not take a per-user
 * bearer apiKey — it authenticates with AWS SigV4 credentials (see
 * services/bedrockService.js#resolveBedrockCredentials for the dedicated vs.
 * shared credential resolution). All shape translation (OpenAI
 * messages/tools <-> Bedrock Converse) lives in services/bedrockService.js;
 * this is a thin, dedicated entry point so call sites don't have to reach
 * into that module directly.
 *
 * @param {Array} messages - OpenAI-style messages (system/user/assistant/tool)
 * @param {Object} [options] - { maxTokens, temperature, tools, tool_choice }
 * @returns {Promise<Object>} OpenAI chat.completions.create()-shaped response
 */
async function createBedrockChatCompletion(messages, options = {}) {
    const { createBedrockCompletion } = require('../services/bedrockService');
    return createBedrockCompletion(messages, options);
}

// Check if user can make API call
async function checkApiUsage(userId, provider, model, inputText, estimatedOutput = 200) {
    try {
        const inputTokens = Math.ceil(inputText.length / 4); // Rough estimate
        
        const canMakeCall = await canMakeApiCall(userId, provider, {
            model: model,
            inputTokens: inputTokens,
            outputTokens: estimatedOutput
        });

        return canMakeCall;
    } catch (error) {
        logger.error('Error checking API usage:', error);
        return { canMake: false, reason: 'Usage check failed' };
    }
}

// Universal LLM completion function
async function createCompletion(provider, model, messages, options = {}) {
    try {
        // Validate inputs
        validateProviderModel(provider, model);
        
        // Ensure client is initialized
        if (!PROVIDERS[provider].client) {
            await initializeLLMClients();
        }
        
        const client = PROVIDERS[provider].client;
        
        if (!client) {
            throw new Error(`Client not available for provider: ${provider}`);
        }

        // Prepare completion parameters
        const completionParams = {
            model: model,
            messages: messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || options.max_tokens || 1000,
            stream: false
        };

        // Pass through function-calling params when provided (OpenAI-compatible
        // providers: deepseek supports tools + tool_choice).
        if (options.tools) completionParams.tools = options.tools;
        if (options.tool_choice) completionParams.tool_choice = options.tool_choice;

        // Provider-specific adjustments
        if (provider === 'deepseek') {
            // deepseek-reasoner does not accept temperature/top_p/penalty
            // params — strip them so the request isn't rejected.
            if (model === 'deepseek-reasoner') {
                delete completionParams.temperature;
            }
        }

        // Make the API call
        logger.debug(`🤖 Making ${provider.toUpperCase()} API call with model: ${model}`);
        
        const startTime = Date.now();
        
        const response = await client.chat.completions.create(completionParams);
        
        logger.debug(`🤖 ${provider.toUpperCase()} API call completed in ${Date.now() - startTime}ms`);
        
        return response;
        
    } catch (error) {
        logger.error(`Error in ${provider} completion:`, {
            message: error.message,
            code: error.code,
            status: error.status,
            errno: error.errno,
            syscall: error.syscall,
            address: error.address,
            port: error.port,
            stack: error.stack
        });
        
        // Add specific handling for network errors
        if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.message.includes('socket hang up')) {
            logger.error('Network connectivity issue detected with the LLM API');
            logger.error('Verify network connection and firewall settings');
        }
        
        throw error;
    }
}

// Track API usage after completion
async function trackCompletion(userId, provider, model, response, inputText) {
    try {
        const inputTokens = response.usage?.prompt_tokens || Math.ceil(inputText.length / 4);
        const outputTokens = response.usage?.completion_tokens || 
                           Math.ceil(response.choices[0].message.content.length / 4);
        
        const usageResult = await trackApiUsage(userId, provider, {
            inputTokens: inputTokens,
            outputTokens: outputTokens
        }, model);

        logger.debug(`📊 ${provider.toUpperCase()} usage tracked: $${usageResult.cost?.toFixed(4)}, Total: $${usageResult.totalUsage?.toFixed(4)}`);
        
        return usageResult;
    } catch (error) {
        logger.error('Error tracking API usage:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Stream a completion for OpenAI-compatible providers (deepseek).
 *
 * Mirrors services/bedrockService.js#streamBedrockCompletion's contract: an
 * async generator that yields `{ text }` for each token delta and, when the
 * stream ends, returns `{ usage }` as the generator's final value (read via
 * `next.value` once `next.done` is true).
 *
 * @param {string} provider - provider key (deepseek)
 * @param {string} model - model id
 * @param {Array} messages - OpenAI-style messages
 * @param {Object} [options] - { maxTokens, temperature }
 * @returns {AsyncGenerator<{text:string}, {usage:Object|null}>}
 */
async function* streamCompletion(provider, model, messages, options = {}) {
    await initializeLLMClients();

    const client = PROVIDERS[provider]?.client;
    if (!client) {
        throw new Error(`Client not available for provider: ${provider}`);
    }

    const params = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || options.max_tokens || 1000,
        stream: true,
    };

    if (provider === 'deepseek' && model === 'deepseek-reasoner') {
        delete params.temperature;
    }

    const stream = await client.chat.completions.create(params);
    let usage = null;

    for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) {
            yield { text: delta };
        }
        if (chunk?.usage) {
            usage = {
                prompt_tokens: chunk.usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens,
            };
        }
    }

    return { usage };
}

module.exports = {
    PROVIDERS,
    MODEL_TIER_REQUIREMENTS,
    initializeLLMClients,
    getAvailableProviders,
    getDefaultModel,
    validateProviderModel,
    checkApiUsage,
    createCompletion,
    streamCompletion,
    createBedrockChatCompletion,
    trackCompletion,
};