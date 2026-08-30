require('dotenv').config();
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const { trackApiUsage, canMakeApiCall } = require('../utils/apiUsageTracker.js');
const { checkIP } = require('../utils/accessData.js');
const { logger } = require('../utils/logger');
const { createBedrockCompletion, BEDROCK_MODEL_ID } = require('../services/bedrockService');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

/**
 * Generate a single random English word of an exact length via Bedrock
 * (Claude Haiku 4.5). Retries a few times if the model returns a word of the
 * wrong length, since the game needs an exact-length secret word.
 */
async function generateRandomWord(wordLength) {
    const messages = [
        { role: 'system', content: 'You are a word generator for a Wordle-style game. Respond with exactly one random English word, lowercase, with no punctuation, no spaces, and no explanation.' },
        { role: 'user', content: `Generate one random English word that is exactly ${wordLength} letters long.` },
    ];

    let lastResponse = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        lastResponse = await createBedrockCompletion(messages, { maxTokens: 24, temperature: 1.2 });
        const raw = lastResponse?.choices?.[0]?.message?.content || '';
        const word = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
        if (word.length === wordLength) {
            return { word, response: lastResponse };
        }
        logger.debug(`LLM random word length mismatch (got "${word}", length ${word.length}, wanted ${wordLength}), retrying`);
    }

    const fallbackRaw = lastResponse?.choices?.[0]?.message?.content || '';
    return { word: fallbackRaw.trim().toLowerCase().replace(/[^a-z]/g, ''), response: lastResponse };
}

/**
 * Generate a short, clear, family-friendly dictionary-style definition for a
 * word via Bedrock (Claude Haiku 4.5).
 */
async function generateDefinition(word) {
    const response = await createBedrockCompletion([
        { role: 'system', content: 'You are a dictionary. Write one short, clear, family-friendly definition of the word provided. Respond with ONLY the definition text — no numbering, no quotes, no extra commentary.' },
        { role: 'user', content: word },
    ], { maxTokens: 120, temperature: 0.3 });

    const raw = response?.choices?.[0]?.message?.content || '';
    return { definition: raw.replace(/\s+/g, ' ').trim(), response };
}

const { getUserUsageStats } = require('../utils/apiUsageTracker.js');
const { getStripe, liveStripe: stripe } = require('../utils/stripeInstance.js');
const { createCustomer } = require('./postHashData.js');

// @desc    Get Data
// @route   GET /api/data
// @access  Private
const getHashData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
    } catch (error) {
        logger.debug('Error in checkIP:', error);
        // Continue anyway - don't fail the request for IP checking
    }
    
    logger.debug('getHashData called');
    logger.debug('req.user:', req.user);
    logger.debug('req.query:', req.query);
    
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    // Handle bug reports filtering
    if (req.query.filterType === 'bug_reports') {
        logger.debug('Filtering bug reports for user:', req.user.id);
        
        try {
            const params = {
                TableName: 'Simple',
                FilterExpression: 'contains(#text, :creatorId) AND contains(#text, :bugPrefix)',
                ExpressionAttributeNames: {
                    '#text': 'text'
                },
                ExpressionAttributeValues: {
                    ':creatorId': `Creator:${req.user.id}`,
                    ':bugPrefix': 'Bug:'
                }
            };

            logger.debug('DynamoDB scan params for bug reports:', JSON.stringify(params, null, 2));
            const result = await dynamodb.send(new ScanCommand(params));
            
            logger.debug(`Found ${result.Items.length} bug reports for user`);
            
            // Process the results to extract bug report information
            const processedReports = result.Items.map(item => {
                const text = item.text || '';
                const bugData = {};
                
                // Parse the pipe-delimited data
                const parts = text.split('|');
                parts.forEach(part => {
                    const [key, ...valueParts] = part.split(':');
                    if (key && valueParts.length > 0) {
                        bugData[key.toLowerCase()] = valueParts.join(':');
                    }
                });
                
                return {
                    id: item.id,
                    title: bugData.bug || 'Untitled Bug Report',
                    severity: bugData.severity || 'medium',
                    description: bugData.description || '',
                    steps: bugData.steps || '',
                    expected: bugData.expected || '',
                    actual: bugData.actual || '',
                    browser: bugData.browser || '',
                    device: bugData.device || '',
                    status: bugData.status || 'Open',
                    creator: bugData.creator || '',
                    resolution: bugData.resolution || '',
                    resolvedBy: bugData.resolvedby || '',
                    resolvedAt: bugData.resolvedat || '',
                    timestamp: bugData.timestamp || item.createdAt,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                };
            });
            
            logger.debug('Processed bug reports:', processedReports.length);
            return res.status(200).json({ data: processedReports });
            
        } catch (error) {
            logger.error('Error fetching bug reports:', error);
            res.status(500);
            throw new Error('Failed to fetch bug reports');
        }
    }

    // Original logic for other requests
    if (!req.query || !req.query.data) {
        res.status(400);
        throw new Error('Invalid request query parameter');
    }

    let data;
    let dataSearchString;
    try {
        // Try to parse as JSON first
        data = JSON.parse(req.query.data);
        logger.debug('Parsed query data as JSON:', data);
        dataSearchString = data.text;
    } catch (error) {
        // If JSON parsing fails, treat as plain string
        logger.debug('Query data is not JSON, treating as plain string:', req.query.data);
        dataSearchString = req.query.data;
    }

    if (!dataSearchString) {
        res.status(400);
        throw new Error('Invalid request query parameter - no search string found');
    }

    try {
        // Use the search string as provided by the client (case-sensitive)
        logger.debug('dataSearchString:', dataSearchString);
        
        // Use the user ID with its original casing
        const userSearchString = `Creator:${req.user.id}`; 
        logger.debug('userSearchString:', userSearchString);
        var randomWord = "";

        if (dataSearchString.startsWith("getword:")) { // Check if dataSearchString is "getword"
            const wordLength = parseInt(dataSearchString.substring(8), 10); // returns 5 before a user modifies it to other custom numbers

            if (!Number.isInteger(wordLength) || wordLength < 3 || wordLength > 15) {
                res.status(400);
                throw new Error('Invalid word length');
            }

            // Check if user can make an LLM (Bedrock) word call
            const canMakeCall = await canMakeApiCall(req.user.id, 'bedrock', {
                model: BEDROCK_MODEL_ID,
                inputTokens: 90,
                outputTokens: 30,
            });
            if (!canMakeCall.canMake) {
                logger.debug('LLM Word call blocked:', canMakeCall.reason);
                return res.status(402).json({ 
                    error: 'API usage limit reached', 
                    reason: canMakeCall.reason,
                    currentUsage: canMakeCall.currentUsage,
                    limit: canMakeCall.limit,
                    requiresUpgrade: true
                });
            }

            const { word: generatedWord, response } = await generateRandomWord(wordLength);
            if (!generatedWord) {
                throw new Error('Failed to generate a random word from the LLM.');
            }
            randomWord = generatedWord;

            // Track API usage
            const usage = response?.usage || {};
            const usageResult = await trackApiUsage(req.user.id, 'bedrock', {
                inputTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
            }, BEDROCK_MODEL_ID);
            if (usageResult.success) {
                logger.debug(`LLM Word usage tracked: $${usageResult.cost.toFixed(4)}, Total: $${usageResult.totalUsage.toFixed(4)}`);
            }

            res.status(200).json({ word: randomWord }); // Return the random word

        } else if (dataSearchString.startsWith("getdef:")) { // Handle "getdef:" request
            const word = dataSearchString.substring(7); // Extract the word from dataSearchString

            if (!word) {
                res.status(400);
                throw new Error('Invalid request query parameter - no word found');
            }

            // Check if user can make an LLM (Bedrock) definition call
            const canMakeCall = await canMakeApiCall(req.user.id, 'bedrock', {
                model: BEDROCK_MODEL_ID,
                inputTokens: 120,
                outputTokens: 120,
            });
            if (!canMakeCall.canMake) {
                logger.debug('LLM Definition call blocked:', canMakeCall.reason);
                return res.status(402).json({ 
                    error: 'API usage limit reached', 
                    reason: canMakeCall.reason,
                    currentUsage: canMakeCall.currentUsage,
                    limit: canMakeCall.limit,
                    requiresUpgrade: true
                });
            }

            const { definition, response } = await generateDefinition(word);

            // Track API usage
            const usage = response?.usage || {};
            const usageResult = await trackApiUsage(req.user.id, 'bedrock', {
                inputTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
            }, BEDROCK_MODEL_ID);
            if (usageResult.success) {
                logger.debug(`LLM Definition usage tracked: $${usageResult.cost.toFixed(4)}, Total: $${usageResult.totalUsage.toFixed(4)}`);
            }

            const finalDefinition = definition && definition.length > 0
                ? definition
                : 'Definition not available.';

            res.status(200).json({ worddef: finalDefinition }); // Return the definition

        } else { // Handle database search requests
            try {
                logger.debug('dataSearchString:', dataSearchString);
                // Check if the search string looks like a direct ID (32 hex characters)
                const isDirectId = /^[a-f0-9]{32}$/i.test(dataSearchString);
                logger.debug('isDirectId:', isDirectId);
                
                if (isDirectId) {
                    logger.debug('Searching for direct ID:', dataSearchString);
                    // Use scan with filter like auth middleware does
                    const params = {
                        TableName: 'Simple',
                        FilterExpression: "id = :searchId",
                        ExpressionAttributeValues: {
                            ":searchId": dataSearchString
                        }
                    };

                    logger.debug('DynamoDB scan params:', params);
                    const result = await dynamodb.send(new ScanCommand(params));
                    logger.debug('DynamoDB scan result:', JSON.stringify(result).substring(0, 100) + '...');

                    if (result.Items && result.Items.length > 0) {
                        const item = result.Items[0]; // Take the first match
                        // Check if this item belongs to the current user
                        const itemText = item.text || '';
                        const userSearchString = `Creator:${req.user.id}`;
                        logger.debug('Checking if item belongs to user:', userSearchString);
                        logger.debug('Item text:', itemText.length > 100 ? itemText.substring(0, 100) + '...' : itemText);
                        
                        // Check if item belongs to user OR is public
                        const isUserItem = itemText.includes(userSearchString);
                        const isPublicItem = itemText.includes('Public:true');
                        
                        if (isUserItem || isPublicItem) {
                            logger.debug(isUserItem ? 'Item belongs to user' : 'Item is public, returning data');
                            res.status(200).json({
                                data: [{
                                    data: item.text, // Return the text content as the data field
                                    ActionGroup: item.ActionGroup,
                                    files: item.files,
                                    updatedAt: item.updatedAt,
                                    createdAt: item.createdAt,
                                    __v: null,
                                    _id: item.id,
                                }]
                            });
                        } else {
                            // Item exists but doesn't belong to this user and isn't public
                            logger.debug('Item does not belong to user and is not public');
                            res.status(200).json({ data: [] }); // Return empty array instead of 403
                        }
                    } else {
                        // Item not found
                        logger.debug('Item not found');
                        res.status(200).json({ data: [] });
                    }
                } else {
                    // Search for data containing the search string (original behavior)
                    logger.debug('Searching for text containing:', dataSearchString);
                    // Construct filter expressions for DynamoDB
                    let filterExpressions = [];
                    let expressionAttributeValues = {};
                    let expressionAttributeNames = {};

                    // Add filter for user ID
                    filterExpressions.push('contains(#text, :userId)');
                    expressionAttributeValues[':userId'] = `Creator:${req.user.id}`; // Uses original case user ID
                    expressionAttributeNames['#text'] = 'text';

                    // Add filter for search string
                    filterExpressions.push('contains(#text, :searchString)');
                    expressionAttributeValues[':searchString'] = dataSearchString; // Uses original case search string

                    const params = {
                        TableName: 'Simple',
                        FilterExpression: filterExpressions.join(' AND '),
                        ExpressionAttributeValues: expressionAttributeValues,
                        ExpressionAttributeNames: expressionAttributeNames
                    };

                    logger.debug('DynamoDB scan params:', JSON.stringify(params, null, 2));
                    
                    // First, let's also do a broader search to see if you have ANY data for this user
                    const broadParams = {
                        TableName: 'Simple',
                        FilterExpression: 'contains(#text, :userId)',
                        ExpressionAttributeValues: {
                            ':userId': `Creator:${req.user.id}`
                        },
                        ExpressionAttributeNames: {
                            '#text': 'text'
                        }
                    };
                    
                    logger.debug('Checking for ANY user data...');
                    const broadResult = await dynamodb.send(new ScanCommand(broadParams));
                    logger.debug('Total items for this user:', broadResult.Items ? broadResult.Items.length : 0);
                    
                    if (broadResult.Items && broadResult.Items.length > 0) {
                        logger.debug('Sample user data items:');
                        broadResult.Items.slice(0, 3).forEach((item, index) => {
                            logger.debug(`Item ${index + 1}:`, item.text ? item.text.substring(0, 150) + '...' : 'no text');
                        });
                        
                        // Check if any contain "Net:" at all
                        const netItems = broadResult.Items.filter(item => item.text && item.text.includes('Net:'));
                        logger.debug('Items containing "Net:":', netItems.length);
                        if (netItems.length > 0) {
                            logger.debug('First Net item:', netItems[0].text.substring(0, 200) + '...');
                        }
                    }
                    
                    const result = await dynamodb.send(new ScanCommand(params));
                    logger.debug('DynamoDB scan completed');
                    logger.debug('Items found:', result.Items ? result.Items.length : 0);
                    
                    if (result.Items && result.Items.length > 0) {
                        logger.debug('First item preview:', result.Items[0].text ? result.Items[0].text.substring(0, 100) + '...' : 'no text');
                    }

                    const responseData = {
                        data: result.Items.map(item => ({
                            data: item.text, // Return the text content as the data field
                            ActionGroup: item.ActionGroup,
                            files: item.files,
                            updatedAt: item.updatedAt,
                            createdAt: item.createdAt,
                            __v: null, // Not applicable for DynamoDB
                            _id: item.id,
                        }))
                    };
                    
                    logger.debug('Sending response with', responseData.data.length, 'items');
                    res.status(200).json(responseData);
                }
            } catch (error) {
                logger.error("Error fetching data from DynamoDB:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        }
    } catch (error) {
        logger.error('Error fetching data:', error);
        res.status(500).json({
            error: req.query.data,
            input: req.query.data,
            output: randomWord,
            errorMessage: error.message
        });
    }
});

// GET: Fetch previous payment methods
const getPaymentMethods = asyncHandler(async (req, res, next) => {
    try {
        logger.debug('getPaymentMethods called with fromPutHashData:', (req.fromPutHashData ? 'true' : 'false'));
        
        if (!req.user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (!req.user.text.includes("|stripeid:")) {
            try {
                // Create a new customer if the customer ID is not found
                const customer = await createCustomer({
                    body: {
                        email: req.user.text.substring(req.user.text.indexOf('Email:') + 6,
                            req.user.text.indexOf('.com|') + 4),
                        name: req.user.text.substring(req.user.text.indexOf('Nickname:') + 9,
                            req.user.text.indexOf('|Email:')),
                    }
                }, res);

                // Update user data with the new customer ID
                req.user.text += `|stripeid:${customer.id}`;
                logger.debug(`|stripeid:${customer.id}`);
                await req.user.save();

                req.paymentMethods = [];
                if (req.fromPostHashData) {
                    return next();
                } else {
                    res.status(200).json({ message: 'Customer created and updated successfully', customer });
                    return;
                }
            } catch (error) {
                logger.error('Customer creation failed:', error);
                res.status(500).json({ error: 'Customer creation failed' });
                return;
            }
        }

        // logger.debug('req.user.text:', req.user.text);

        const customerId = req.user.text.substring(req.user.text.indexOf('|stripeid:') + 10,
            req.user.text.indexOf('|stripeid:') + 28);
        logger.debug('Customer ID:', customerId);
        
        // Validate that the customer ID exists in Stripe before attempting to fetch payment methods
        let validatedCustomer;
        const s = getStripe(req.user.id);
        try {
            validatedCustomer = await s.customers.retrieve(customerId);
            logger.debug('Customer ID validated successfully for payment methods retrieval');
        } catch (stripeError) {
            logger.error(`Invalid Stripe customer ID ${customerId}:`, stripeError.message);
            
            // Fallback: Search by email and update customer ID
            try {
                logger.debug('Attempting to recover by searching for customer by email...');
                
                // Extract email and name from user data
                const userData = req.user.text;
                const emailMatch = userData.match(/Email:([^|]*)/);
                const nameMatch = userData.match(/Nickname:([^|]*)/);
                
                if (!emailMatch || !emailMatch[1]) {
                    throw new Error('Could not extract email from user data');
                }
                
                const email = emailMatch[1].trim();
                const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
                
                logger.debug('Extracted email:', email, 'name:', name);
                
                // Search for existing customer by email
                const existingCustomers = await s.customers.list({
                    email: email,
                    limit: 1
                });
                
                if (existingCustomers.data.length > 0) {
                    // Found existing customer
                    validatedCustomer = existingCustomers.data[0];
                    logger.debug('Found existing Stripe customer by email:', validatedCustomer.id);
                } else {
                    // Create new customer
                    validatedCustomer = await s.customers.create({ email, name });
                    logger.debug('Created new Stripe customer:', validatedCustomer.id);
                }
                
                // Update user data with correct customer ID
                const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${validatedCustomer.id}`);
                logger.debug('Updating user data with correct customer ID:', validatedCustomer.id);
                
                // Update in DynamoDB
                const putParams = {
                    TableName: 'Simple',
                    Item: {
                        ...req.user,
                        text: updatedUserData,
                        updatedAt: new Date().toISOString()
                    }
                };
                
                await dynamodb.send(new PutCommand(putParams));
                logger.debug('User data updated with correct Stripe customer ID');
                
            } catch (recoveryError) {
                logger.error('Failed to recover customer ID:', recoveryError.message);
                res.status(500).json({ 
                    error: 'Failed to validate or recover customer ID',
                    details: recoveryError.message
                });
                return;
            }
        }
        
        // Define all payment method types we want to fetch
        const paymentMethodTypes = ['card', 'link', 'cashapp', 'venmo'];
        let allPaymentMethods = [];
        
        // Use the validated customer ID for fetching payment methods
        const finalCustomerId = validatedCustomer.id;
        logger.debug('Using customer ID for payment methods:', finalCustomerId);
        
        // Fetch each payment method type
        for (const type of paymentMethodTypes) {
            try {
                logger.debug(`Fetching ${type} payment methods for customer: ${finalCustomerId}`);
                const methodsResponse = await s.paymentMethods.list({
                    customer: finalCustomerId,
                    limit: 10,
                    type: type,
                });
                
                if (methodsResponse.data && methodsResponse.data.length > 0) {
                    logger.debug(`Found ${methodsResponse.data.length} ${type} payment methods`);
                    allPaymentMethods = [...allPaymentMethods, ...methodsResponse.data];
                }
            } catch (typeError) {
                logger.error(`Error fetching ${type} payment methods:`, typeError.message);
                // Continue with other types even if one fails
            }
        }
        
        logger.debug('Total payment methods found:', allPaymentMethods.length);
        req.paymentMethods = allPaymentMethods;
        
        if (req.fromPutHashData) {
            logger.debug('Returning next from GetHashData.GetPaymentMethods with payment methods count:', allPaymentMethods.length);
            return next();
        } else {
            logger.debug('Returning payment methods from GetHashData.GetPaymentMethods ...');
            logger.debug('Payment methods:', allPaymentMethods);
            res.status(200).json(allPaymentMethods);
        }
    } catch (error) {
        logger.error('Error fetching payment methods:', error);
        if (req.fromPostHashData || req.fromPutHashData) {
            return next(error);
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const getAllData = async (req, res) => {
    try {
        logger.debug('getAllData called. req.body:', req.body, 'req.user:', req.user);
        // Check if the user is an admin
        if (req.user && req.user.id === process.env.ADMIN_USER_ID) {
            // logger.debug('Fetching all data from DynamoDB...');

            // A single Scan page is capped at ~1MB by DynamoDB, so once the table
            // grows past that the results were silently truncated (older/newer
            // items — including bug reports — would just disappear from the
            // admin dashboard). Page through with ExclusiveStartKey until the
            // scan reports no more LastEvaluatedKey.
            let items = [];
            let lastEvaluatedKey;
            do {
                const params = {
                    TableName: 'Simple',
                    ExclusiveStartKey: lastEvaluatedKey,
                };
                const result = await dynamodb.send(new ScanCommand(params));
                items = items.concat(result.Items || []);
                lastEvaluatedKey = result.LastEvaluatedKey;
            } while (lastEvaluatedKey);

            res.status(200).json(items.map(item => ({
                id: item.id,
                text: item.text,
                files: item.files ? item.files.map(f => f.filename).join(', ') : "",
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            })));
        } else {
            logger.error("Error: User is not an admin.");
            res.status(403).json({ message: 'Access denied. Admins only.' });
        }
    } catch (error) {
        logger.error("Error fetching all data from DynamoDB:", error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get user API usage data
// @route   GET /api/data/usage
// @access  Private
const getUserUsageData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
    } catch (error) {
        logger.debug('Error in checkIP:', error);
        // Continue anyway - don't fail the request for IP checking
    }

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    try {
        const usageStats = await getUserUsageStats(req.user.id);
        res.status(200).json(usageStats);
    } catch (error) {
        logger.error("Error fetching user usage stats:", error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = { getHashData, getPaymentMethods, getAllData, getUserUsageData };