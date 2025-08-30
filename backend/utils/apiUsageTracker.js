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

// Membership limits (in USD)
const MEMBERSHIP_LIMITS = {
    Free: 0,
    Flex: 10,
    Premium: 10 // Premium gets unlimited (but we track for transparency)
};

/**
 * Parse usage data from user text
 * @param {string} userText - The user's text field
 * @returns {Object} Parsed usage data
 */
function parseUsageData(userText) {
    const usageMatch = userText.match(/\|Usage:([^|]*)/);
    if (!usageMatch || !usageMatch[1]) {
        return { entries: [], totalCost: 0 };
    }

    const usageString = usageMatch[1];
    const entries = [];
    let totalCost = 0;

    // Parse entries like: openai-2024-08-30:150t:$0.05,rapidword-2024-08-30:5c:$0.01
    const usageEntries = usageString.split(',').filter(entry => entry.trim());
    
    for (const entry of usageEntries) {
        const parts = entry.split(':');
        if (parts.length >= 3) {
            const [apiDate, usage, costStr] = parts;
            const [apiName, date] = apiDate.split('-', 2);
            const cost = parseFloat(costStr.replace('$', ''));
            
            entries.push({
                api: apiName,
                date: date,
                usage: usage,
                cost: cost,
                fullDate: apiDate.substring(apiName.length + 1)
            });
            
            totalCost += cost;
        }
    }

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
 * Track API usage for a user
 * @param {string} userId - User ID
 * @param {string} apiName - API name (openai, rapidword, rapiddef)
 * @param {Object} usageData - Usage data (tokens, calls, etc.)
 * @param {string} model - Model used (for OpenAI)
 * @returns {Promise} Updated usage info
 */
async function trackApiUsage(userId, apiName, usageData, model = null) {
    try {
        // Get user data
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: "id = :userId",
            ExpressionAttributeValues: {
                ":userId": userId
            }
        };

        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        if (!scanResult.Items || scanResult.Items.length === 0) {
            throw new Error('User not found');
        }

        const user = scanResult.Items[0];
        const userText = user.text || '';
        
        // Parse existing usage data
        const { entries } = parseUsageData(userText);
        
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

        // Check if user has exceeded their limit
        const currentUsage = parseUsageData(userText);
        const userRank = getUserRank(userText);
        const userLimit = MEMBERSHIP_LIMITS[userRank] || 0;
        
        if (userRank === 'Free' || (userLimit > 0 && currentUsage.totalCost + cost > userLimit)) {
            return {
                success: false,
                error: `Usage limit exceeded. Current: $${currentUsage.totalCost.toFixed(4)}, Limit: $${userLimit}, This request: $${cost.toFixed(4)}`,
                currentUsage: currentUsage.totalCost,
                limit: userLimit,
                requestCost: cost
            };
        }

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

        // Update user text with new usage data
        const newUsageString = formatUsageData(entries);
        let updatedText;
        
        if (userText.includes('|Usage:')) {
            updatedText = userText.replace(/\|Usage:[^|]*/, `|Usage:${newUsageString}`);
        } else {
            updatedText = `${userText}|Usage:${newUsageString}`;
        }

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
            totalUsage: newTotalUsage.totalCost,
            limit: userLimit,
            remainingBalance: Math.max(0, userLimit - newTotalUsage.totalCost),
            usageBreakdown: newTotalUsage.entries
        };

    } catch (error) {
        console.error('Error tracking API usage:', error);
        throw error;
    }
}

/**
 * Get user's current usage statistics
 * @param {string} userId - User ID
 * @returns {Promise} Usage statistics
 */
async function getUserUsageStats(userId) {
    try {
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: "id = :userId",
            ExpressionAttributeValues: {
                ":userId": userId
            }
        };

        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        if (!scanResult.Items || scanResult.Items.length === 0) {
            throw new Error('User not found');
        }

        const user = scanResult.Items[0];
        const userText = user.text || '';
        const usage = parseUsageData(userText);
        const userRank = getUserRank(userText);
        const limit = MEMBERSHIP_LIMITS[userRank] || 0;

        return {
            totalUsage: usage.totalCost,
            limit: limit,
            remainingBalance: Math.max(0, limit - usage.totalCost),
            usageBreakdown: usage.entries,
            membership: userRank,
            percentUsed: limit > 0 ? (usage.totalCost / limit) * 100 : 0
        };
    } catch (error) {
        console.error('Error getting user usage stats:', error);
        throw error;
    }
}

/**
 * Get user rank from text
 * @param {string} userText - User text field
 * @returns {string} User rank
 */
function getUserRank(userText) {
    const rankMatch = userText.match(/\|Rank:([^|]+)/);
    return rankMatch ? rankMatch[1].trim() : 'Free';
}

/**
 * Check if user can make an API call
 * @param {string} userId - User ID
 * @param {string} apiName - API name
 * @param {Object} estimatedUsage - Estimated usage for the call
 * @returns {Promise} Can make call result
 */
async function canMakeApiCall(userId, apiName, estimatedUsage = {}) {
    try {
        const stats = await getUserUsageStats(userId);
        
        if (stats.membership === 'Free') {
            return { canMake: false, reason: 'Free users cannot use paid APIs' };
        }

        if (stats.membership === 'Premium') {
            return { canMake: true, reason: 'Premium user has unlimited access' };
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

        const wouldExceed = stats.totalUsage + estimatedCost > stats.limit;
        
        return {
            canMake: !wouldExceed,
            reason: wouldExceed ? 'Would exceed usage limit' : 'Within usage limit',
            currentUsage: stats.totalUsage,
            estimatedCost: estimatedCost,
            limit: stats.limit,
            remainingBalance: stats.remainingBalance
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
    API_COSTS,
    MEMBERSHIP_LIMITS
};
