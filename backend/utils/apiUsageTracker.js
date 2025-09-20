const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// API cost configuration (in USD)
const API_COSTS = {
    openai: {
        'gpt-4': { input: 0.03/1000, output: 0.06/1000 }, // per token
        'gpt-3.5-turbo': { input: 0.0015/1000, output: 0.002/1000 }, // per token
        'o1-mini': { input: 0.003/1000, output: 0.012/1000 }, // per token
        'o1-preview': { input: 0.015/1000, output: 0.06/1000 } // per token
    },
    rapidapi: {
        word: 0.002, // per call
        definition: 0.002 // per call
    }
};

// Membership limits (in USD) - Updated system
const MEMBERSHIP_LIMITS = {
    Free: 0,
    Flex: 0.50, // Flex limit equals the cost of the membership ($0.50/month)
    Premium: null // Premium has customizable limits set per user
};

/**
 * Get or create user credits data
 * @param {string} userText - User text field
 * @returns {Object} Credits data
 */
function parseUserCredits(userText) {
    const creditsMatch = userText.match(/\|Credits:([^|]*)/);
    if (!creditsMatch || !creditsMatch[1]) {
        // Default credits structure
        return {
            availableCredits: 0,
            customLimit: null,
            lastReset: null,
            membershipLevel: 'Free'
        };
    }

    try {
        return JSON.parse(creditsMatch[1]);
    } catch (error) {
        console.error('Error parsing credits data:', error);
        return {
            availableCredits: 0,
            customLimit: null,
            lastReset: null,
            membershipLevel: 'Free'
        };
    }
}

/**
 * Update user credits in user text
 * @param {string} userText - Current user text
 * @param {Object} creditsData - Credits data to save
 * @returns {string} Updated user text
 */
function updateUserCredits(userText, creditsData) {
    const creditsString = JSON.stringify(creditsData);
    
    if (userText.includes('|Credits:')) {
        return userText.replace(/\|Credits:[^|]*/, `|Credits:${creditsString}`);
    } else {
        return `${userText}|Credits:${creditsString}`;
    }
}

/**
 * Check if user needs monthly credit reset
 * @param {Object} creditsData - User credits data
 * @param {string} membership - User membership level
 * @returns {boolean} True if reset is needed
 */
function needsMonthlyReset(creditsData, membership) {
    if (!creditsData.lastReset) return true;
    
    const lastReset = new Date(creditsData.lastReset);
    const now = new Date();
    const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + 
                      (now.getMonth() - lastReset.getMonth());
    
    return monthsDiff >= 1;
}

/**
 * Perform monthly credit reset and top-off
 * @param {Object} creditsData - Current credits data
 * @param {string} membership - User membership level
 * @param {boolean} subscriptionActive - Whether the subscription is active
 * @returns {Object} Updated credits data
 */
function performMonthlyReset(creditsData, membership, subscriptionActive = true) {
    const now = new Date().toISOString();
    
    // Only perform reset if subscription is active
    if (!subscriptionActive) {
        console.log('Subscription not active, skipping monthly reset');
        return creditsData; // Return unchanged if subscription cancelled
    }
    
    switch (membership) {
        case 'Flex':
            // Flex gets topped off to $0.50 worth of credits
            creditsData.availableCredits = Math.max(creditsData.availableCredits, 0.50);
            creditsData.customLimit = 0.50;
            break;
        case 'Premium':
            // Premium gets topped off to their custom limit
            if (creditsData.customLimit) {
                creditsData.availableCredits = Math.max(creditsData.availableCredits, creditsData.customLimit);
            }
            break;
        default:
            // Free users get no credits
            creditsData.availableCredits = 0;
            creditsData.customLimit = null;
            break;
    }
    
    creditsData.lastReset = now;
    creditsData.membershipLevel = membership;
    
    return creditsData;
}

/**
 * Parse usage data from user text
 * @param {string} userText - The user's text field
 * @returns {Object} Parsed usage data
 */
function parseUsageData(userText) {
    // Debug logging
    console.log('parseUsageData: Input text length:', userText.length);
    console.log('parseUsageData: Input text preview:', userText.substring(0, 300) + '...');
    
    const usageMatch = userText.match(/\|Usage:([^|]*)/);
    if (!usageMatch || !usageMatch[1]) {
        console.log('parseUsageData: No usage data found in user text');
        return { entries: [], totalCost: 0 };
    }

    const usageString = usageMatch[1].trim();
    console.log('parseUsageData: Found usage string:', usageString);
    
    // Handle edge cases where the string might be empty or just whitespace
    if (!usageString || usageString.length === 0) {
        console.log('parseUsageData: Usage string is empty');
        return { entries: [], totalCost: 0 };
    }
    
    const entries = [];
    let totalCost = 0;

    // Parse entries like: openai-2024-08-30:150t:$0.05,rapidword-2024-08-30:5c:$0.01
    // But also handle single entries without commas: openai-2025-08-30:1664t:$0.0196
    const usageEntries = usageString.includes(',') 
        ? usageString.split(',').filter(entry => entry.trim()).map(entry => entry.trim())
        : [usageString.trim()]; // If no comma, treat the whole string as a single entry
    
    console.log('parseUsageData: Usage entries after processing:', usageEntries);
    
    for (const entry of usageEntries) {
        console.log(`Parsing entry: "${entry}"`);
        const parts = entry.split(':');
        console.log('Split parts:', parts);
        if (parts.length >= 3) {
            const [apiDate, usage, costStr] = parts;
            // Find the first dash to separate API name from date
            const firstDashIndex = apiDate.indexOf('-');
            const apiName = firstDashIndex > 0 ? apiDate.substring(0, firstDashIndex) : apiDate;
            const fullDate = firstDashIndex > 0 ? apiDate.substring(firstDashIndex + 1) : '';
            
            // Clean the cost string and parse it
            const cleanCostStr = costStr.replace('$', '').trim();
            const cost = parseFloat(cleanCostStr);
            
            console.log(`  - API: ${apiName}, Date: ${fullDate}, Usage: ${usage}, Cost: $${cost}`);
            
            if (!isNaN(cost)) {
                entries.push({
                    api: apiName,
                    date: fullDate,
                    usage: usage,
                    cost: cost,
                    fullDate: fullDate
                });
                
                totalCost += cost;
            } else {
                console.warn(`  - Failed to parse cost from "${costStr}"`);
            }
        } else {
            console.warn(`  - Invalid entry format, expected 3 parts but got ${parts.length}: "${entry}"`);
        }
    }

    console.log('parseUsageData: Final result - entries:', entries.length, 'totalCost:', totalCost);
    return { entries, totalCost };
}

/**
 * Format usage data back to string
 * @param {Array} entries - Usage entries
 * @returns {string} Formatted usage string
 */
function formatUsageData(entries) {
    return entries.map(entry => 
        `${entry.api}-${entry.fullDate}:${entry.usage}:$${entry.cost.toFixed(4)}`
    ).join(',');
}

/**
 * Track API usage for a user using the new credit system
 * @param {string} userId - User ID
 * @param {string} apiName - API name (openai, rapidword, rapiddef)
 * @param {Object} usageData - Usage data (tokens, calls, etc.)
 * @param {string} model - Model used (for OpenAI)
 * @returns {Promise} Updated usage info
 */
async function trackApiUsage(userId, apiName, usageData, model = null) {
    try {
        // Use cached user data
        const user = await getUserDataCached(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const userText = user.text || '';
        
        // Calculate cost for this usage
        let cost = 0;
        let usageString = '';
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        switch (apiName) {
            case 'openai':
                const modelKey = model || 'o1-mini';
                const modelCosts = API_COSTS.openai[modelKey] || API_COSTS.openai['o1-mini'];
                const inputTokens = usageData.inputTokens || 0;
                const outputTokens = usageData.outputTokens || 0;
                cost = (inputTokens * modelCosts.input) + (outputTokens * modelCosts.output);
                usageString = `${inputTokens + outputTokens}t`;
                break;
            case 'rapidword':
                cost = API_COSTS.rapidapi.word;
                usageString = '1c';
                break;
            case 'rapiddef':
                cost = API_COSTS.rapidapi.definition;
                usageString = '1c';
                break;
            default:
                throw new Error(`Unknown API: ${apiName}`);
        }

        // Get membership level
        let userRank;
        try {
            userRank = await getUserRankFromStripe(userId);
            console.log('trackApiUsage: Got rank from Stripe:', userRank);
        } catch (error) {
            console.error('trackApiUsage: Stripe rank lookup failed, using legacy:', error);
            userRank = getUserRank(userText);
            console.log('trackApiUsage: Using legacy rank:', userRank);
        }

        // Get user credits data
        let creditsData = parseUserCredits(userText);
        
        // Check if monthly reset is needed
        if (needsMonthlyReset(creditsData, userRank)) {
            console.log('trackApiUsage: Performing monthly reset for user');
            creditsData = performMonthlyReset(creditsData, userRank);
        }

        // Check if user has enough credits for this call
        if (userRank === 'Free') {
            return {
                success: false,
                error: 'Free users cannot use paid APIs',
                currentCredits: 0,
                requestCost: cost
            };
        }

        if (creditsData.availableCredits < cost) {
            return {
                success: false,
                error: `Insufficient credits. Available: $${creditsData.availableCredits.toFixed(4)}, Required: $${cost.toFixed(4)}`,
                currentCredits: creditsData.availableCredits,
                requestCost: cost
            };
        }

        // Deduct cost from available credits
        creditsData.availableCredits -= cost;
        creditsData.availableCredits = Math.max(0, creditsData.availableCredits); // Ensure no negative credits

        console.log(`trackApiUsage: Deducted $${cost.toFixed(4)}, Remaining credits: $${creditsData.availableCredits.toFixed(4)}`);

        // Parse existing usage data for tracking purposes
        const { entries } = parseUsageData(userText);
        
        // Add new usage entry
        const newEntry = {
            api: apiName,
            date: today,
            fullDate: today,
            usage: usageString,
            cost: cost
        };

        // Find existing entry for today and same API, or add new
        const existingEntryIndex = entries.findIndex(entry => 
            entry.api === apiName && entry.fullDate === today
        );

        if (existingEntryIndex >= 0) {
            // Update existing entry
            const existingEntry = entries[existingEntryIndex];
            const existingCost = existingEntry.cost;
            const existingUsage = existingEntry.usage;
            
            // Combine usage
            if (apiName === 'openai') {
                const existingTokens = parseInt(existingUsage.replace('t', '')) || 0;
                const newTokens = parseInt(usageString.replace('t', '')) || 0;
                newEntry.usage = `${existingTokens + newTokens}t`;
            } else {
                const existingCalls = parseInt(existingUsage.replace('c', '')) || 0;
                newEntry.usage = `${existingCalls + 1}c`;
            }
            
            newEntry.cost = existingCost + cost;
            entries[existingEntryIndex] = newEntry;
        } else {
            entries.push(newEntry);
        }

        // Update user text with new usage data and credits
        const newUsageString = formatUsageData(entries);
        let updatedText;
        
        if (userText.includes('|Usage:')) {
            updatedText = userText.replace(/\|Usage:[^|]*/, `|Usage:${newUsageString}`);
        } else {
            updatedText = `${userText}|Usage:${newUsageString}`;
        }

        // Update credits in user text
        updatedText = updateUserCredits(updatedText, creditsData);

        // Save updated user data
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...user,
                text: updatedText,
                updatedAt: new Date().toISOString()
            }
        };

        await dynamodb.send(new PutCommand(putParams));

        const newTotalUsage = parseUsageData(updatedText);
        
        return {
            success: true,
            cost: cost,
            availableCredits: creditsData.availableCredits,
            customLimit: creditsData.customLimit,
            totalUsage: newTotalUsage.totalCost,
            usageBreakdown: newTotalUsage.entries,
            membership: userRank
        };

    } catch (error) {
        console.error('Error tracking API usage:', error);
        throw error;
    }
}

/**
 * Get user's current usage statistics with new credit system
 * @param {string} userId - User ID
 * @returns {Promise} Usage statistics
 */
async function getUserUsageStats(userId) {
    try {
        // Use cached user data
        const user = await getUserDataCached(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const userText = user.text || '';
        console.log('getUserUsageStats: User text contains:', userText.substring(0, 200) + '...');
        const usage = parseUsageData(userText);
        console.log('getUserUsageStats: Parsed usage:', usage);
        
        // Try to get rank from Stripe first, fallback to legacy rank
        let userRank;
        try {
            userRank = await getUserRankFromStripe(userId);
            console.log('getUserUsageStats: Got rank from Stripe:', userRank);
        } catch (error) {
            console.error('getUserUsageStats: Stripe rank lookup failed, using legacy:', error);
            userRank = getUserRank(userText);
            console.log('getUserUsageStats: Using legacy rank:', userRank);
        }

        // Get credits data
        let creditsData = parseUserCredits(userText);
        
        // Check if monthly reset is needed and perform it
        if (needsMonthlyReset(creditsData, userRank)) {
            console.log('getUserUsageStats: Performing monthly reset for user');
            creditsData = performMonthlyReset(creditsData, userRank);
            
            // Save updated credits to database
            const updatedText = updateUserCredits(userText, creditsData);
            const putParams = {
                TableName: 'Simple',
                Item: {
                    ...user,
                    text: updatedText,
                    updatedAt: new Date().toISOString()
                }
            };
            await dynamodb.send(new PutCommand(putParams));
        }

        // Calculate limit based on membership type
        let limit;
        if (userRank === 'Premium' && creditsData.customLimit) {
            limit = creditsData.customLimit;
        } else {
            limit = MEMBERSHIP_LIMITS[userRank] || 0;
        }

        const result = {
            totalUsage: usage.totalCost,
            availableCredits: creditsData.availableCredits,
            limit: limit,
            customLimit: creditsData.customLimit,
            usageBreakdown: usage.entries,
            membership: userRank,
            lastReset: creditsData.lastReset,
            // For backwards compatibility, calculate remaining balance as available credits
            remainingBalance: creditsData.availableCredits,
            percentUsed: limit > 0 ? ((limit - creditsData.availableCredits) / limit) * 100 : 0
        };
        
        console.log('getUserUsageStats: Returning result:', result);
        return result;
    } catch (error) {
        console.error('Error getting user usage stats:', error);
        throw error;
    }
}

// In-memory cache for user ranks (expires every 5 minutes)
const userRankCache = new Map();
const userDataCache = new Map(); // Cache DynamoDB user data
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const USER_DATA_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes for user data

/**
 * Get user data from DynamoDB with caching
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User data
 */
async function getUserDataCached(userId) {
    const cacheKey = `user_data_${userId}`;
    const cached = userDataCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < USER_DATA_CACHE_DURATION) {
        console.log(`Using cached user data for ${userId}`);
        return cached.data;
    }

    const scanParams = {
        TableName: 'Simple',
        FilterExpression: "id = :userId",
        ExpressionAttributeValues: {
            ":userId": userId
        }
    };

    const scanResult = await dynamodb.send(new ScanCommand(scanParams));
    if (!scanResult.Items || scanResult.Items.length === 0) {
        return null;
    }

    const userData = scanResult.Items[0];
    userDataCache.set(cacheKey, { data: userData, timestamp: Date.now() });
    return userData;
}

/**
 * Get user rank from Stripe subscription with advanced caching
 * @param {string} userId - User ID
 * @returns {Promise<string>} User rank
 */
async function getUserRankFromStripe(userId) {
    try {
        // Check cache first
        const cacheKey = userId;
        const cached = userRankCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            console.log(`getUserRankFromStripe: Using cached rank for ${userId}: ${cached.rank}`);
            return cached.rank;
        }

        console.log('getUserRankFromStripe called for userId:', userId);
        
        // Get user data with caching
        const user = await getUserDataCached(userId);
        if (!user) {
            console.log('getUserRankFromStripe: User not found in DynamoDB');
            const rank = 'Free';
            userRankCache.set(cacheKey, { rank, timestamp: Date.now() });
            return rank;
        }

        const userText = user.text || '';
        console.log('getUserRankFromStripe: User text (first 200 chars):', userText.substring(0, 200));
        
        // Extract Stripe customer ID
        const stripeIdMatch = userText.match(/\|stripeid:([^|]+)/);
        if (!stripeIdMatch || !stripeIdMatch[1]) {
            console.log('getUserRankFromStripe: No Stripe customer ID found');
            const rank = 'Free';
            userRankCache.set(cacheKey, { rank, timestamp: Date.now() });
            return rank;
        }

        const customerId = stripeIdMatch[1];
        console.log('getUserRankFromStripe: Customer ID:', customerId);
        const stripe = require('stripe')(process.env.STRIPE_KEY);
        
        // Optimized: Get only the most recent subscriptions and use a single API call
        const recentSubscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 3, // Reduced from 10 to 3 for speed
            expand: ['data.plan.product']
        });

        console.log('getUserRankFromStripe: Found', recentSubscriptions.data.length, 'recent subscriptions');
        
        // Only log detailed info if no cached result and in development
        if (process.env.NODE_ENV === 'development' && !cached) {
            recentSubscriptions.data.forEach((sub, index) => {
                console.log(`getUserRankFromStripe: Subscription ${index + 1}: ID=${sub.id}, Status=${sub.status}, Product=${sub.plan?.product?.name || 'unknown'}`);
            });
        }

        // Find the best subscription in priority order
        const priorityStatuses = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid'];
        let validSubscription = null;
        let foundStatus = null;

        for (const status of priorityStatuses) {
            const subscription = recentSubscriptions.data.find(sub => sub.status === status);
            if (subscription) {
                validSubscription = subscription;
                foundStatus = status;
                console.log(`getUserRankFromStripe: Using ${status} subscription: ${subscription.id}`);
                break;
            }
        }
        
        if (!validSubscription) {
            console.log('getUserRankFromStripe: No valid subscriptions found');
            const rank = 'Free';
            userRankCache.set(cacheKey, { rank, timestamp: Date.now() });
            return rank;
        }
        
        // Determine rank from product name
        const productName = validSubscription.plan.product.name;
        console.log('getUserRankFromStripe: Product name:', productName, 'Status:', foundStatus);
        
        let rank = 'Free';
        if (productName === 'Simple Membership') {
            rank = 'Flex';
        } else if (productName === 'CSimple Membership') {
            rank = 'Premium';
        }

        console.log(`getUserRankFromStripe: Returning ${rank} membership (status: ${foundStatus})`);

        // Cache the result with longer duration for stable subscriptions
        const cacheDuration = foundStatus === 'active' ? CACHE_DURATION * 2 : CACHE_DURATION;
        userRankCache.set(cacheKey, { rank, timestamp: Date.now() - (CACHE_DURATION - cacheDuration) });
        
        return rank;
        
    } catch (error) {
        console.error('Error getting user rank from Stripe:', error);
        // Don't cache errors, return default
        return 'Free';
    }
}

/**
 * Get user rank from text (legacy method, kept for backward compatibility)
 * @param {string} userText - User text field
 * @returns {string} User rank
 */
function getUserRank(userText) {
    const rankMatch = userText.match(/\|Rank:([^|]+)/);
    return rankMatch ? rankMatch[1].trim() : 'Free';
}

/**
 * Check if user can make an API call using the new credit system
 * @param {string} userId - User ID
 * @param {string} apiName - API name
 * @param {Object} estimatedUsage - Estimated usage for the call
 * @returns {Promise} Can make call result
 */
async function canMakeApiCall(userId, apiName, estimatedUsage = {}) {
    try {
        console.log('canMakeApiCall called for userId:', userId, 'apiName:', apiName);
        
        // Get user data
        const user = await getUserDataCached(userId);
        if (!user) {
            return { canMake: false, reason: 'User not found' };
        }

        const userText = user.text || '';
        
        // Get membership level
        let userRank;
        try {
            userRank = await getUserRankFromStripe(userId);
            console.log('canMakeApiCall: Got rank from Stripe:', userRank);
        } catch (error) {
            console.error('canMakeApiCall: Stripe rank lookup failed, using legacy:', error);
            userRank = getUserRank(userText);
        }

        console.log('canMakeApiCall: User membership:', userRank);

        // Free users cannot use paid APIs
        if (userRank === 'Free') {
            console.log('canMakeApiCall: Blocking free user');
            return { canMake: false, reason: 'Free users cannot use paid APIs' };
        }

        // Get user credits data
        let creditsData = parseUserCredits(userText);
        
        // Check if monthly reset is needed
        if (needsMonthlyReset(creditsData, userRank)) {
            console.log('canMakeApiCall: Checking subscription status for monthly reset...');
            
            // Check if subscription is active
            let subscriptionActive = true;
            if (userText.includes('subscriptionId:')) {
                try {
                    const subscriptionId = userText.match(/subscriptionId:([^|]+)/)?.[1];
                    if (subscriptionId) {
                        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                        subscriptionActive = subscription.status === 'active';
                        console.log(`Subscription ${subscriptionId} status: ${subscription.status}`);
                    }
                } catch (subError) {
                    console.error('Error checking subscription status:', subError);
                    subscriptionActive = false; // Assume cancelled if we can't check
                }
            } else {
                subscriptionActive = false; // No subscription ID means no active subscription
            }
            
            console.log('canMakeApiCall: Performing monthly reset for user, subscription active:', subscriptionActive);
            creditsData = performMonthlyReset(creditsData, userRank, subscriptionActive);
            
            // Save updated credits to database
            const updatedText = updateUserCredits(userText, creditsData);
            const putParams = {
                TableName: 'Simple',
                Item: {
                    ...user,
                    text: updatedText,
                    updatedAt: new Date().toISOString()
                }
            };
            await dynamodb.send(new PutCommand(putParams));
        }

        // Calculate estimated cost for this call
        let estimatedCost = 0;
        switch (apiName) {
            case 'openai':
                const modelKey = estimatedUsage.model || 'o1-mini';
                const modelCosts = API_COSTS.openai[modelKey] || API_COSTS.openai['o1-mini'];
                const inputTokens = estimatedUsage.inputTokens || 100; // Default estimate
                const outputTokens = estimatedUsage.outputTokens || 200; // Default estimate
                estimatedCost = (inputTokens * modelCosts.input) + (outputTokens * modelCosts.output);
                break;
            case 'rapidword':
            case 'rapiddef':
                estimatedCost = API_COSTS.rapidapi[apiName === 'rapidword' ? 'word' : 'definition'];
                break;
        }

        // Check if user has enough available credits
        const hasEnoughCredits = creditsData.availableCredits >= estimatedCost;
        
        console.log(`canMakeApiCall: Available credits: $${creditsData.availableCredits.toFixed(4)}, Estimated cost: $${estimatedCost.toFixed(4)}, Can make: ${hasEnoughCredits}`);
        
        let reason;
        if (hasEnoughCredits) {
            reason = 'Within credit limit';
        } else {
            // Different messaging based on membership type
            if (userRank === 'Flex') {
                reason = 'Insufficient credits. Simple membership usage is frozen until next month or upgrade to CSimple.';
            } else if (userRank === 'Premium') {
                reason = 'Insufficient credits. Consider increasing your CSimple limit to continue usage.';
            } else {
                reason = 'Insufficient credits';
            }
        }
        
        return {
            canMake: hasEnoughCredits,
            reason: reason,
            currentCredits: creditsData.availableCredits,
            estimatedCost: estimatedCost,
            customLimit: creditsData.customLimit,
            membership: userRank,
            isFrozen: !hasEnoughCredits && userRank === 'Flex',
            canIncreaseLimit: !hasEnoughCredits && userRank === 'Premium'
        };
    } catch (error) {
        console.error('Error checking if user can make API call:', error);
        return { canMake: false, reason: 'Error checking usage limits' };
    }
}

module.exports = {
    trackApiUsage,
    getUserUsageStats,
    canMakeApiCall,
    parseUsageData,
    getUserRankFromStripe,
    getUserRank,
    getUserDataCached,
    API_COSTS,
    MEMBERSHIP_LIMITS,
    // New credit system functions
    parseUserCredits,
    updateUserCredits,
    needsMonthlyReset,
    performMonthlyReset
};
