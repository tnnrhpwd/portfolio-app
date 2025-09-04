/**
 * Referer Analytics Utility
 * Provides functions to analyze referer tracking data collected by checkIP
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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
 * Extract referer information from access log text
 * @param {string} logText - The log text from database entry
 * @returns {object} Parsed referer information
 */
function parseRefererFromLog(logText) {
    const refererMatch = logText.match(/\|Referer:([^|]*)/);
    const hostMatch = logText.match(/\|RefererHost:([^|]*)/);
    const pathMatch = logText.match(/\|RefererPath:([^|]*)/);
    const categoryMatch = logText.match(/\|RefererCategory:([^|]*)/);
    const queryMatch = logText.match(/\|RefererQuery:([^|]*)/);

    return {
        referer: refererMatch ? refererMatch[1] : null,
        host: hostMatch ? hostMatch[1] : null,
        path: pathMatch ? pathMatch[1] : null,
        category: categoryMatch ? categoryMatch[1] : 'unknown',
        query: queryMatch ? queryMatch[1] : null,
        hasQuery: !!queryMatch
    };
}

/**
 * Get referer statistics from access logs
 * @param {number} daysSince - Number of days to look back (default: 30)
 * @returns {object} Referer analytics data
 */
async function getRefererStats(daysSince = 30) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysSince);
        const cutoffISO = cutoffDate.toISOString();

        const params = {
            TableName: 'Simple',
            FilterExpression: '#createdAt >= :cutoffDate AND contains(#text, :refererTag)',
            ExpressionAttributeNames: {
                '#createdAt': 'createdAt',
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':cutoffDate': cutoffISO,
                ':refererTag': '|Referer:'
            }
        };

        const result = await dynamodb.send(new ScanCommand(params));
        const logs = result.Items || [];

        // Parse all referer data
        const refererData = logs.map(log => {
            const parsed = parseRefererFromLog(log.text);
            return {
                ...parsed,
                timestamp: log.createdAt,
                ip: log.text.match(/IP:([^|]*)/)?.[1],
                userAgent: log.text.match(/\|Browser:([^|]*)/)?.[1]
            };
        });

        // Generate statistics
        const stats = {
            totalVisits: refererData.length,
            dateRange: {
                from: cutoffISO,
                to: new Date().toISOString()
            },
            categories: {},
            hosts: {},
            directVisits: 0,
            searchEngineVisits: 0,
            socialMediaVisits: 0,
            externalVisits: 0,
            internalVisits: 0,
            topReferers: {},
            searchQueries: []
        };

        // Analyze referer data
        refererData.forEach(data => {
            // Category statistics
            const category = data.category || 'unknown';
            stats.categories[category] = (stats.categories[category] || 0) + 1;

            // Host statistics
            if (data.host && data.host !== 'none' && data.host !== 'invalid') {
                stats.hosts[data.host] = (stats.hosts[data.host] || 0) + 1;
            }

            // Count visit types
            if (category === 'direct') {
                stats.directVisits++;
            } else if (category.startsWith('search_')) {
                stats.searchEngineVisits++;
            } else if (category.startsWith('social_')) {
                stats.socialMediaVisits++;
            } else if (category === 'internal') {
                stats.internalVisits++;
            } else if (category === 'external') {
                stats.externalVisits++;
            }

            // Top referers
            if (data.referer && data.referer !== 'direct') {
                stats.topReferers[data.referer] = (stats.topReferers[data.referer] || 0) + 1;
            }

            // Extract search queries
            if (data.query && category.startsWith('search_')) {
                const queryParams = new URLSearchParams(data.query);
                const searchTerms = queryParams.get('q') || queryParams.get('query') || queryParams.get('search');
                if (searchTerms) {
                    stats.searchQueries.push({
                        terms: searchTerms,
                        engine: category,
                        timestamp: data.timestamp
                    });
                }
            }
        });

        // Sort and limit top results
        const sortByCount = (obj) => Object.entries(obj)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

        stats.topReferers = sortByCount(stats.topReferers);
        stats.hosts = sortByCount(stats.hosts);

        return stats;

    } catch (error) {
        console.error('Error getting referer statistics:', error);
        throw error;
    }
}

/**
 * Get referer data for a specific time period
 * @param {string} startDate - Start date in ISO format
 * @param {string} endDate - End date in ISO format
 * @returns {Array} Array of referer data entries
 */
async function getRefererDataByDateRange(startDate, endDate) {
    try {
        const params = {
            TableName: 'Simple',
            FilterExpression: '#createdAt BETWEEN :startDate AND :endDate AND contains(#text, :refererTag)',
            ExpressionAttributeNames: {
                '#createdAt': 'createdAt',
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':startDate': startDate,
                ':endDate': endDate,
                ':refererTag': '|Referer:'
            }
        };

        const result = await dynamodb.send(new ScanCommand(params));
        const logs = result.Items || [];

        return logs.map(log => ({
            ...parseRefererFromLog(log.text),
            timestamp: log.createdAt,
            ip: log.text.match(/IP:([^|]*)/)?.[1],
            method: log.text.match(/\|Method:([^|]*)/)?.[1],
            url: log.text.match(/\|URL:([^|]*)/)?.[1],
            userAgent: log.text.match(/\|Browser:([^|]*)/)?.[1],
            userId: log.text.match(/\|User:([^|]*)/)?.[1]
        }));

    } catch (error) {
        console.error('Error getting referer data by date range:', error);
        throw error;
    }
}

module.exports = {
    parseRefererFromLog,
    getRefererStats,
    getRefererDataByDateRange
};
