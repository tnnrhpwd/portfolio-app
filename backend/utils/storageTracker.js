const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { STORAGE_LIMITS } = require('../constants/pricing');

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
 * Calculate the size of an object/data in bytes
 * @param {any} data - The data to measure
 * @returns {number} Size in bytes
 */
function calculateDataSize(data) {
    if (data === null || data === undefined) return 0;
    
    if (typeof data === 'string') {
        return Buffer.byteLength(data, 'utf8');
    }
    
    if (typeof data === 'object') {
        return Buffer.byteLength(JSON.stringify(data), 'utf8');
    }
    
    // For other primitive types
    return Buffer.byteLength(String(data), 'utf8');
}

/**
 * Calculate the size of files array
 * @param {Array} files - Array of file objects
 * @returns {number} Total size in bytes
 */
function calculateFilesSize(files) {
    if (!Array.isArray(files)) return 0;
    
    return files.reduce((total, file) => {
        let fileSize = 0;
        
        // Calculate size of file metadata
        if (file.filename) fileSize += Buffer.byteLength(file.filename, 'utf8');
        if (file.contentType) fileSize += Buffer.byteLength(file.contentType, 'utf8');
        
        // Calculate size of file data (base64 encoded)
        if (file.data) {
            if (typeof file.data === 'string') {
                // If it's base64, calculate the original size
                const base64Size = Buffer.byteLength(file.data, 'utf8');
                // Base64 encoding increases size by ~33%, so original size is roughly base64Size * 0.75
                fileSize += Math.floor(base64Size * 0.75);
            } else {
                fileSize += calculateDataSize(file.data);
            }
        }
        
        return total + fileSize;
    }, 0);
}

/**
 * Calculate storage usage for a single database item
 * @param {Object} item - Database item
 * @returns {number} Size in bytes
 */
function calculateItemSize(item) {
    let totalSize = 0;
    
    // Calculate size of each field
    if (item.id) totalSize += calculateDataSize(item.id);
    if (item.text) totalSize += calculateDataSize(item.text);
    if (item.ActionGroupObject) totalSize += calculateDataSize(item.ActionGroupObject);
    if (item.files) totalSize += calculateFilesSize(item.files);
    if (item.createdAt) totalSize += calculateDataSize(item.createdAt);
    if (item.updatedAt) totalSize += calculateDataSize(item.updatedAt);
    
    // Add overhead for DynamoDB metadata (approximately 100 bytes per item)
    totalSize += 100;
    
    return totalSize;
}

/**
 * Get user's total storage usage across all their database items
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Storage usage information
 */
async function getUserStorageUsage(userId) {
    try {
        console.log('getUserStorageUsage: Calculating storage for user:', userId);
        
        // Get all items created by this user
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: 'contains(#text, :creatorId) OR id = :userId',
            ExpressionAttributeNames: {
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':creatorId': userId,
                ':userId': userId
            }
        };

        const result = await dynamodb.send(new ScanCommand(scanParams));
        console.log(`getUserStorageUsage: Found ${result.Items.length} items for user`);
        
        let totalStorage = 0;
        let itemCount = 0;
        let fileCount = 0;
        let largestItem = { size: 0, type: 'none' };
        const storageBreakdown = [];

        // Calculate storage for each item
        for (const item of result.Items) {
            const itemSize = calculateItemSize(item);
            totalStorage += itemSize;
            itemCount++;

            // Count files
            if (item.files && Array.isArray(item.files)) {
                fileCount += item.files.length;
            }

            // Track largest item
            if (itemSize > largestItem.size) {
                largestItem = {
                    size: itemSize,
                    type: item.files?.length > 0 ? 'file_data' : 'text_data',
                    id: item.id,
                    createdAt: item.createdAt
                };
            }

            // Add to breakdown (keep last 10 items)
            storageBreakdown.push({
                id: item.id,
                size: itemSize,
                type: item.files?.length > 0 ? 'file_data' : 'text_data',
                fileCount: item.files?.length || 0,
                createdAt: item.createdAt,
                hasFiles: (item.files && item.files.length > 0),
                textSize: calculateDataSize(item.text),
                filesSize: item.files ? calculateFilesSize(item.files) : 0
            });
        }

        // Sort breakdown by size (largest first) and keep top 10
        storageBreakdown.sort((a, b) => b.size - a.size);
        const topItems = storageBreakdown.slice(0, 10);

        // Get user's membership level for storage limits
        const { getUserRankFromStripe } = require('./apiUsageTracker');
        let userRank;
        try {
            userRank = await getUserRankFromStripe(userId);
        } catch (error) {
            console.error('Error getting user rank for storage:', error);
            userRank = 'Free';
        }

        const storageLimit = STORAGE_LIMITS[userRank];
        const storageUsagePercent = storageLimit ? (totalStorage / storageLimit) * 100 : 0;

        console.log(`getUserStorageUsage: Total storage ${totalStorage} bytes (${formatBytes(totalStorage)}), Limit: ${formatBytes(storageLimit)}, Usage: ${storageUsagePercent.toFixed(1)}%`);

        return {
            totalStorage,
            totalStorageFormatted: formatBytes(totalStorage),
            storageLimit,
            storageLimitFormatted: storageLimit ? formatBytes(storageLimit) : 'N/A',
            storageUsagePercent,
            itemCount,
            fileCount,
            membership: userRank,
            largestItem: {
                ...largestItem,
                sizeFormatted: formatBytes(largestItem.size)
            },
            storageBreakdown: topItems.map(item => ({
                ...item,
                sizeFormatted: formatBytes(item.size),
                textSizeFormatted: formatBytes(item.textSize),
                filesSizeFormatted: formatBytes(item.filesSize)
            })),
            isNearLimit: storageUsagePercent > 80,
            isOverLimit: storageUsagePercent > 100
        };

    } catch (error) {
        console.error('Error calculating storage usage:', error);
        throw error;
    }
}

/**
 * Format bytes into human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes === null || bytes === undefined) return 'N/A';
    
    const k = 1024;
    const decimals = 2;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Check if user has enough storage space for new data
 * @param {string} userId - User ID
 * @param {number} additionalSize - Size of new data in bytes
 * @returns {Promise<Object>} Storage check result
 */
async function checkStorageCapacity(userId, additionalSize) {
    try {
        const currentUsage = await getUserStorageUsage(userId);
        const newTotalSize = currentUsage.totalStorage + additionalSize;
        
        const canStore = !currentUsage.storageLimit || newTotalSize <= currentUsage.storageLimit;
        const availableSpace = currentUsage.storageLimit 
            ? currentUsage.storageLimit - currentUsage.totalStorage 
            : null;
        
        return {
            canStore,
            currentUsage: currentUsage.totalStorage,
            currentUsageFormatted: formatBytes(currentUsage.totalStorage),
            additionalSize,
            additionalSizeFormatted: formatBytes(additionalSize),
            newSize: newTotalSize,
            newSizeFormatted: formatBytes(newTotalSize),
            storageLimit: currentUsage.storageLimit,
            storageLimitFormatted: formatBytes(currentUsage.storageLimit),
            availableSpace,
            availableSpaceFormatted: formatBytes(availableSpace),
            usagePercent: (newTotalSize / currentUsage.storageLimit) * 100,
            reason: canStore ? 
                'Within storage limits' : 
                `Storage limit exceeded. Need ${formatBytes(newTotalSize - currentUsage.storageLimit)} additional space.`
        };
        
    } catch (error) {
        console.error('Error checking storage capacity:', error);
        throw error;
    }
}

/**
 * Track storage when new data is created
 * @param {string} userId - User ID
 * @param {Object} itemData - The data being created
 * @returns {Promise<Object>} Storage tracking result
 */
async function trackStorageUsage(userId, itemData) {
    try {
        // Calculate the size of the new item
        const itemSize = calculateItemSize(itemData);
        
        // Check if user has capacity
        const capacityCheck = await checkStorageCapacity(userId, itemSize);
        
        if (!capacityCheck.canStore) {
            return {
                success: false,
                error: capacityCheck.reason,
                itemSize,
                itemSizeFormatted: formatBytes(itemSize),
                ...capacityCheck
            };
        }
        
        // If we can store it, return success
        return {
            success: true,
            itemSize,
            itemSizeFormatted: formatBytes(itemSize),
            ...capacityCheck
        };
        
    } catch (error) {
        console.error('Error tracking storage usage:', error);
        throw error;
    }
}

module.exports = {
    getUserStorageUsage,
    checkStorageCapacity,
    trackStorageUsage,
    calculateItemSize,
    calculateDataSize,
    calculateFilesSize,
    formatBytes,
    STORAGE_LIMITS
};
