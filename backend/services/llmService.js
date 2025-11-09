const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const { 
    initializeLLMClients, 
    checkApiUsage, 
    createCompletion, 
    trackCompletion 
} = require('../utils/llmProviders.js');

let openaiClient; // OpenAI client for backwards compatibility

/**
 * Initialize OpenAI client
 */
async function initializeOpenAI() {
    try {
        const openai = await import('openai');
        openaiClient = new openai.OpenAI({ apiKey: process.env.OPENAI_KEY });
        console.log('OpenAI initialized successfully');
    } catch (error) {
        console.error('Error initializing OpenAI:', error);
        throw error;
    }
}

/**
 * Parse compression request data
 * @param {Object} req - Express request object
 * @returns {Object} Parsed data
 */
function parseCompressionRequest(req) {
    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON);

    const updateId = req.body.updateId;
    console.log('Update ID:', updateId);

    const itemID = parsedJSON._id;
    const contextInput = parsedJSON.text;
    console.log('Context input:', contextInput);

    // Get LLM provider and model from request (with defaults)
    const provider = req.body.provider || 'openai';
    const model = req.body.model || (provider === 'xai' ? 'grok-4-fast-reasoning' : 'o1-mini');
    
    console.log(`Using ${provider} with model ${model}`);

    if (typeof contextInput !== 'string') {
        const error = new Error('Data input invalid');
        error.statusCode = 400;
        throw error;
    }

    const netIndex = contextInput.includes('Net:') ? contextInput.indexOf('Net:') : 0;
    const userInput = netIndex > 0 ? contextInput.substring(netIndex + 4) : contextInput;

    console.log('User input:', userInput);

    return { updateId, itemID, contextInput, provider, model, userInput };
}

/**
 * Check if user can make API call
 * @param {string} userId - User ID
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {string} userInput - User input
 * @returns {Object} Usage check result
 */
async function validateApiUsage(userId, provider, model, userInput) {
    console.log('🔍 Starting API validation check...');
    const startValidation = Date.now();
    
    const usageCheck = await checkApiUsage(userId, provider, model, userInput);

    console.log(`✅ API validation completed in ${Date.now() - startValidation}ms`);

    if (!usageCheck.canMake) {
        console.log(`${provider.toUpperCase()} API call blocked:`, usageCheck.reason);
        const error = new Error('API usage limit reached');
        error.statusCode = 402;
        error.details = {
            error: 'API usage limit reached',
            reason: usageCheck.reason,
            currentUsage: usageCheck.currentUsage,
            limit: usageCheck.limit,
            requiresUpgrade: true,
            provider: provider,
            model: model
        };
        throw error;
    }

    return usageCheck;
}

/**
 * Call LLM API to compress data
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {string} userInput - User input
 * @returns {Object} LLM response
 */
async function callLLMApi(provider, model, userInput) {
    await initializeLLMClients();
    
    console.log(`🤖 Starting ${provider.toUpperCase()} API call...`);
    const startLLM = Date.now();
    
    const response = await createCompletion(provider, model, [
        { role: 'user', content: userInput }
    ], {
        maxTokens: 1000,
        temperature: 0.7
    });
    
    console.log(`🤖 ${provider.toUpperCase()} API call completed in ${Date.now() - startLLM}ms`);
    console.log('LLM response:', JSON.stringify(response));
    
    return response;
}

/**
 * Track API usage after successful call
 * @param {string} userId - User ID
 * @param {string} provider - LLM provider
 * @param {string} model - Model name
 * @param {Object} response - LLM response
 * @param {string} userInput - User input
 */
async function trackApiUsageAfterCall(userId, provider, model, response, userInput) {
    console.log('📊 Starting usage tracking...');
    const startTracking = Date.now();
    
    const usageResult = await trackCompletion(userId, provider, model, response, userInput);

    console.log(`📊 Usage tracking completed in ${Date.now() - startTracking}ms`);

    if (!usageResult.success) {
        console.log('Usage tracking failed:', usageResult.error);
        // Continue anyway - don't fail the request for usage tracking issues
    }
}

/**
 * Save compressed data to DynamoDB
 * @param {Object} dynamodb - DynamoDB client
 * @param {string} userId - User ID
 * @param {string} userInput - User input
 * @param {string} compressedData - Compressed data
 * @param {string} updateId - Optional update ID for existing chat
 * @returns {Object} Result object with status and data
 */
async function saveCompressedData(dynamodb, userId, userInput, compressedData, updateId = null) {
    console.log('💾 Starting data saving...');
    const startSaving = Date.now();
    
    const newData = `Creator:${userId}|Net:${userInput}\n${compressedData}`;
    console.log('Saving data with format:', newData.substring(0, 100) + '...');

    if (updateId) {
        // Update existing item in DynamoDB
        console.log('Updating existing chat with ID:', updateId);
        const updateParams = {
            TableName: 'Simple',
            Key: { id: updateId },
            UpdateExpression: 'SET #text = :text, updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: {
                ':text': newData,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'UPDATED_NEW'
        };

        try {
            const result = await dynamodb.send(new UpdateCommand(updateParams));
            console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
            console.log('Successfully updated existing chat');
            return { status: 200, data: { data: [compressedData] } };
        } catch (dbError) {
            console.error('Error updating DynamoDB:', dbError);
            const error = new Error('Failed to update data');
            error.statusCode = 500;
            throw error;
        }
    } else {
        // Create new item in DynamoDB
        console.log('Creating new chat entry');
        const newItemParams = {
            TableName: 'Simple',
            Item: {
                id: crypto.randomBytes(16).toString("hex"),
                text: newData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        try {
            await dynamodb.send(new PutCommand(newItemParams));
            console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
            console.log('Successfully created new chat');
            return { status: 201, data: { data: [compressedData] } };
        } catch (dbError) {
            console.error('Error saving to DynamoDB:', dbError);
            const error = new Error('Failed to save data');
            error.statusCode = 500;
            throw error;
        }
    }
}

/**
 * Process compression request - orchestrates the entire compression flow
 * @param {Object} req - Express request object
 * @param {Object} dynamodb - DynamoDB client
 * @returns {Object} Result with status and data
 */
async function processCompressionRequest(req, dynamodb) {
    const startValidation = Date.now();
    
    // Parse request
    const { updateId, userInput, provider, model } = parseCompressionRequest(req);
    
    // Validate API usage
    await validateApiUsage(req.user.id, provider, model, userInput);
    
    // Call LLM API
    const response = await callLLMApi(provider, model, userInput);
    
    // Track API usage
    await trackApiUsageAfterCall(req.user.id, provider, model, response, userInput);
    
    // Check if response has content
    if (response.choices[0].message.content && response.choices[0].message.content.length > 0) {
        const compressedData = response.choices[0].message.content;
        
        // Save to DynamoDB
        const result = await saveCompressedData(dynamodb, req.user.id, userInput, compressedData, updateId);
        
        console.log(`💾 Total operation completed in ${Date.now() - startValidation}ms`);
        return result;
    } else {
        console.log(`💾 Total operation completed in ${Date.now() - startValidation}ms`);
        const error = new Error('No compressed data found in the OpenAI response');
        error.statusCode = 500;
        throw error;
    }
}

module.exports = {
    initializeOpenAI,
    parseCompressionRequest,
    validateApiUsage,
    callLLMApi,
    trackApiUsageAfterCall,
    saveCompressedData,
    processCompressionRequest
};
