// llmProviders.js - Unified LLM Provider Interface
require('dotenv').config();
const { trackApiUsage, canMakeApiCall } = require('./apiUsageTracker.js');

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
            console.log('✅ OpenAI client initialized');
        }

        // Initialize XAI using OpenAI SDK as per official XAI documentation
        if (PROVIDERS.xai.apiKey && !PROVIDERS.xai.client) {
            const openai = await import('openai');
            PROVIDERS.xai.client = new openai.OpenAI({ 
                apiKey: PROVIDERS.xai.apiKey,
                baseURL: PROVIDERS.xai.baseURL,
                timeout: 360000 // 6 minutes timeout for reasoning models as per XAI docs
            });
            console.log('✅ XAI client initialized with OpenAI SDK (XAI compatible)');
        }

        return true;
    } catch (error) {
        console.error('Error initializing LLM clients:', error);
        throw error;
    }
}

// Get available providers and models
function getAvailableProviders() {
    const availableProviders = {};
    
    for (const [providerKey, provider] of Object.entries(PROVIDERS)) {
        if (provider.apiKey) {
            availableProviders[providerKey] = {
                name: provider.name,
                models: provider.models
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
    
    if (!PROVIDERS[provider].apiKey) {
        throw new Error(`API key not configured for provider: ${provider}`);
    }
    
    return true;
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
        console.error('Error checking API usage:', error);
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
        }

        // Make the API call
        console.log(`🤖 Making ${provider.toUpperCase()} API call with model: ${model}`);
        
        // Additional debug for XAI (without printing full image data)
        if (provider === 'xai') {
            console.log('XAI Debug - Base URL:', PROVIDERS.xai.baseURL);
            console.log('XAI Debug - API Key length:', PROVIDERS.xai.apiKey?.length || 0);
            console.log('XAI Debug - Client timeout:', PROVIDERS.xai.client?.timeout);
            
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
            
            console.log('XAI Debug - Completion params:', debugParams);
        }
        
        const startTime = Date.now();
        
        const response = await client.chat.completions.create(completionParams);
        
        console.log(`🤖 ${provider.toUpperCase()} API call completed in ${Date.now() - startTime}ms`);
        
        // Debug response structure
        if (provider === 'xai') {
            console.log('=== XAI Unified Provider Response Debug ===');
            console.log('- Has choices:', !!response.choices);
            console.log('- Choices length:', response.choices?.length);
            console.log('- Has message content:', !!response.choices?.[0]?.message?.content);
            console.log('- Content length:', response.choices?.[0]?.message?.content?.length || 0);
            console.log('FULL XAI RESPONSE CONTENT:');
            console.log('---START XAI RESPONSE---');
            console.log(response.choices?.[0]?.message?.content || 'NO CONTENT IN RESPONSE');
            console.log('---END XAI RESPONSE---');
            console.log('=== End XAI Unified Provider Debug ===');
        }
        
        return response;
        
    } catch (error) {
        console.error(`Error in ${provider} completion:`, {
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
            console.error('Network connectivity issue detected with XAI API');
            console.error('Verify network connection and firewall settings');
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

        console.log(`📊 ${provider.toUpperCase()} usage tracked: $${usageResult.cost?.toFixed(4)}, Total: $${usageResult.totalUsage?.toFixed(4)}`);
        
        return usageResult;
    } catch (error) {
        console.error('Error tracking API usage:', error);
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

module.exports = {
    PROVIDERS,
    initializeLLMClients,
    getAvailableProviders,
    validateProviderModel,
    checkApiUsage,
    createCompletion,
    trackCompletion,
    testXAIConnection
};