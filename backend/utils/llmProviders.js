// llmProviders.js - Unified LLM Provider Interface
require('dotenv').config();
const { trackApiUsage, canMakeApiCall } = require('./apiUsageTracker.js');
const { logger } = require('./logger');

// Available LLM providers and their models
const PROVIDERS = {
    openai: {
        name: 'OpenAI',
        models: {
            'gpt-4o': { name: 'GPT-4o', contextWindow: 128000 },
            'gpt-4o-mini': { name: 'GPT-4o Mini', contextWindow: 128000 },
            'gpt-4': { name: 'GPT-4', contextWindow: 8192 },
            'gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', contextWindow: 16385 },
            'o1-preview': { name: 'o1-preview', contextWindow: 32768 },
            'o1-mini': { name: 'o1-mini', contextWindow: 65536 }
        },
        apiKey: process.env.OPENAI_KEY,
        client: null
    },
    xai: {
        name: 'XAI',
        models: {
            'grok-4': { name: 'Grok 4', contextWindow: 65536 },
            'grok-4-fast-reasoning': { name: 'Grok 4 Fast Reasoning', contextWindow: 65536 }
        },
        apiKey: process.env.XAI_API_KEY || process.env.XAI_KEY, // Try both environment variable names
        client: null,
        baseURL: 'https://api.x.ai/v1'
    },
    deepseek: {
        name: 'DeepSeek',
        models: {
            'deepseek-chat': { name: 'DeepSeek-V3 (Chat)', contextWindow: 64000 },
            'deepseek-reasoner': { name: 'DeepSeek-R1 (Reasoner)', contextWindow: 64000 }
        },
        apiKey: process.env.DEEPSEEK_API_KEY,
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
        // Initialize OpenAI
        if (PROVIDERS.openai.apiKey && !PROVIDERS.openai.client) {
            const openai = await import('openai');
            PROVIDERS.openai.client = new openai.OpenAI({ 
                apiKey: PROVIDERS.openai.apiKey 
            });
            logger.debug('✅ OpenAI client initialized');
        }

        // Initialize XAI using OpenAI SDK as per official XAI documentation
        if (PROVIDERS.xai.apiKey && !PROVIDERS.xai.client) {
            const openai = await import('openai');
            PROVIDERS.xai.client = new openai.OpenAI({ 
                apiKey: PROVIDERS.xai.apiKey,
                baseURL: PROVIDERS.xai.baseURL,
                timeout: 360000 // 6 minutes timeout for reasoning models as per XAI docs
            });
            logger.debug('✅ XAI client initialized with OpenAI SDK (XAI compatible)');
        }

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
// Models not listed here are available to all tiers (Free+). Empty today —
// Bedrock's single Claude Haiku 4.5 model is available to Free and Pro alike
// (each tier's *usage* is instead capped by MEMBERSHIP_LIMITS in
// apiUsageTracker.js, since Bedrock is a metered, server-paid provider).
const MODEL_TIER_REQUIREMENTS = {};

function getAvailableProviders() {
    // Import API_COSTS lazily to avoid circular deps
    let API_COSTS;
    try {
        API_COSTS = require('./apiUsageTracker.js').API_COSTS;
    } catch { API_COSTS = null; }

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
                    requiredTier: MODEL_TIER_REQUIREMENTS[modelId] || 'free',
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

        // Provider-specific adjustments
        if (provider === 'openai') {
            // For o1 models, use max_completion_tokens instead of max_tokens
            if (model.startsWith('o1-')) {
                completionParams.max_completion_tokens = completionParams.max_tokens;
                delete completionParams.max_tokens;
                delete completionParams.temperature; // o1 models don't support temperature
            }
        } else if (provider === 'deepseek') {
            // deepseek-reasoner does not accept temperature/top_p/penalty
            // params — strip them so the request isn't rejected.
            if (model === 'deepseek-reasoner') {
                delete completionParams.temperature;
            }
        }

        // Make the API call
        logger.debug(`🤖 Making ${provider.toUpperCase()} API call with model: ${model}`);
        
        // Additional debug for XAI (without printing full image data)
        if (provider === 'xai') {
            logger.debug('XAI Debug - Base URL:', PROVIDERS.xai.baseURL);
            logger.debug('XAI Debug - API Key length:', PROVIDERS.xai.apiKey?.length || 0);
            logger.debug('XAI Debug - Client timeout:', PROVIDERS.xai.client?.timeout);
            
            // Log completion params without full image data
            const debugParams = {
                model: completionParams.model,
                messagesCount: completionParams.messages?.length || 0,
                temperature: completionParams.temperature,
                max_tokens: completionParams.max_tokens
            };
            
            // Check message content types without printing full content
            if (completionParams.messages) {
                debugParams.messageTypes = completionParams.messages.map((m, i) => {
                    if (Array.isArray(m.content)) {
                        return `Message ${i}: [${m.content.map(c => c.type).join(', ')}]`;
                    }
                    return `Message ${i}: text`;
                });
            }
            
            logger.debug('XAI Debug - Completion params:', debugParams);
        }
        
        const startTime = Date.now();
        
        const response = await client.chat.completions.create(completionParams);
        
        logger.debug(`🤖 ${provider.toUpperCase()} API call completed in ${Date.now() - startTime}ms`);
        
        // Debug response structure
        if (provider === 'xai') {
            logger.debug('=== XAI Unified Provider Response Debug ===');
            logger.debug('- Has choices:', !!response.choices);
            logger.debug('- Choices length:', response.choices?.length);
            logger.debug('- Has message content:', !!response.choices?.[0]?.message?.content);
            logger.debug('- Content length:', response.choices?.[0]?.message?.content?.length || 0);
            logger.debug('FULL XAI RESPONSE CONTENT:');
            logger.debug('---START XAI RESPONSE---');
            logger.debug(response.choices?.[0]?.message?.content || 'NO CONTENT IN RESPONSE');
            logger.debug('---END XAI RESPONSE---');
            logger.debug('=== End XAI Unified Provider Debug ===');
        }
        
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
            logger.error('Network connectivity issue detected with XAI API');
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

// Test XAI connectivity
async function testXAIConnection() {
    try {
        if (!PROVIDERS.xai.apiKey) {
            return { success: false, error: 'XAI API key not configured' };
        }
        
        await initializeLLMClients();
        
        const testResponse = await PROVIDERS.xai.client.chat.completions.create({
            model: 'grok-4',
            messages: [{ role: 'user', content: 'Test connection. Reply with "OK".' }],
            max_tokens: 10
        });
        
        return { 
            success: true, 
            response: testResponse.choices[0]?.message?.content,
            usage: testResponse.usage 
        };
    } catch (error) {
        return { 
            success: false, 
            error: error.message,
            code: error.code,
            type: error.constructor.name
        };
    }
}

/**
 * Stream a completion for OpenAI-compatible providers (openai/xai/deepseek).
 *
 * Mirrors services/bedrockService.js#streamBedrockCompletion's contract: an
 * async generator that yields `{ text }` for each token delta and, when the
 * stream ends, returns `{ usage }` as the generator's final value (read via
 * `next.value` once `next.done` is true).
 *
 * @param {string} provider - provider key (openai/xai/deepseek)
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

    if (provider === 'openai' && model.startsWith('o1-')) {
        params.max_completion_tokens = params.max_tokens;
        delete params.max_tokens;
        delete params.temperature;
    } else if (provider === 'deepseek' && model === 'deepseek-reasoner') {
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
    validateProviderModel,
    checkApiUsage,
    createCompletion,
    streamCompletion,
    createBedrockChatCompletion,
    trackCompletion,
    testXAIConnection,
};