const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const NodeCache = require('node-cache');
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
const { logger } = require('./logger');

/* ── Storage-usage cache ────────────────────────────────────────────────
 *
 * There is no running per-user byte counter in this codebase: usage is
 * *derived*, by scanning every item in the `Simple` table and keeping the ones
 * that mention the user (their id lives inside the `text` string, so no index
 * can serve this). So every caller on the write path paid for a full table
 * scan — and a save paid for one before *and* one after it, for a number that
 * barely moves in between.
 *
 * The per-user result is therefore memoised briefly, and concurrent lookups
 * for the same user collapse onto a single scan. The TTL bounds how stale a
 * figure can be when nothing announces a change; every path that *does* change
 * what is stored either bumps the cached total (the hot save path — O(1), no
 * rescan) or drops the entry so the next read re-derives it.
 * ─────────────────────────────────────────────────────────────────────── */
const STORAGE_USAGE_TTL_SECONDS = Number(process.env.STORAGE_USAGE_TTL_SECONDS) > 0
    ? Number(process.env.STORAGE_USAGE_TTL_SECONDS)
    : 60;

// Safety valve for the scan below: 200 pages of 1 MB. Reaching it means the
// table is bigger than any user's slice of it should ever be.
const MAX_SCAN_PAGES = Number(process.env.STORAGE_SCAN_MAX_PAGES) > 0
    ? Number(process.env.STORAGE_SCAN_MAX_PAGES)
    : 200;

const storageUsageCache = new NodeCache({
    stdTTL: STORAGE_USAGE_TTL_SECONDS,
    checkperiod: Math.max(30, Math.ceil(STORAGE_USAGE_TTL_SECONDS / 2)),
});

// userId -> in-flight scan promise, so N simultaneous requests for one user
// issue one scan rather than N.
const inFlightScans = new Map();

const cacheKeyFor = (userId) => `storage_usage_${userId}`;

/**
 * Drop the cached figure for a user. Call after an operation that changes what
 * they store without going through trackStorageUsage() — an attachment
 * attached or removed, a record deleted — so the next read re-derives instead
 * of reporting a stale total.
 * @param {string} userId - User ID
 */
function invalidateStorageUsage(userId) {
    if (!userId) return;
    storageUsageCache.del(cacheKeyFor(userId));
}

/**
 * Add bytes to the cached figure for a user, without re-scanning.
 *
 * Used by trackStorageUsage() where the item is about to be written: the cached
 * total has to move with it, or back-to-back saves inside the TTL window would
 * each be checked against the same pre-save total. With nothing cached there is
 * nothing to correct (the next read computes from scratch). If a write later
 * fails, the cached total is briefly *too high* — the safe direction for a
 * quota, and bounded by the TTL.
 *
 * largestItem/storageBreakdown are carried over unchanged: they are display
 * detail, and the totals are what enforcement reads.
 * @param {string} userId - User ID
 * @param {number} bytes - Bytes to add
 * @param {number} [fileCountDelta] - Files added by the same item
 */
function addStorageUsage(userId, bytes, fileCountDelta = 0) {
    if (!userId || !Number.isFinite(bytes) || bytes === 0) return;
    const key = cacheKeyFor(userId);
    const cached = storageUsageCache.get(key);
    if (!cached) return;

    storageUsageCache.set(key, buildUsageResult({
        totalStorage: cached.totalStorage + bytes,
        itemCount: cached.itemCount + 1,
        fileCount: cached.fileCount + fileCountDelta,
        largestItem: cached.largestItem,
        topItems: cached.storageBreakdown,
        userRank: cached.membership,
    }));
}

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
        
        // Explicit byte size (e.g. S3-stored generated images) takes priority
        // over inline base64 data — generated images live in S3 and are
        // referenced here by size, not by a base64 payload.
        if (typeof file.size === 'number' && file.size > 0) {
            fileSize += file.size;
        } else if (file.data) {
            // Calculate size of file data (base64 encoded)
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
 * The uncached computation behind getUserStorageUsage(): page the table, size
 * every item that belongs to the user, resolve the plan that sets their limit.
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Storage usage information
 */
async function computeStorageUsage(userId) {
    try {
        logger.debug('getUserStorageUsage: Calculating storage for user:', userId);
        
        const items = await scanUserItems(userId);
        logger.debug(`getUserStorageUsage: Found ${items.length} items for user`);
        
        let totalStorage = 0;
        let itemCount = 0;
        let fileCount = 0;
        let largestItem = { size: 0, type: 'none' };
        const storageBreakdown = [];

        // Calculate storage for each item
        for (const item of items) {
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
        const { getUserRankFromStripe, getUserDataCached, isSpecialUser } = require('./apiUsageTracker');
        let userRank;
        try {
            userRank = await getUserRankFromStripe(userId);
        } catch (error) {
            logger.error('Error getting user rank for storage:', error);
            userRank = 'Free';
        }

        // Users flagged "Special" by an admin get the Pro storage allowance
        // regardless of their underlying plan rank — the same escape hatch as
        // unlimited AI credits (see isSpecialUser). This also flows through
        // checkStorageCapacity/trackStorageUsage, so writes are enforced
        // against the Pro limit rather than the Free one.
        try {
            const userData = await getUserDataCached(userId);
            if (isSpecialUser(userData?.text || '')) {
                userRank = 'Pro';
            }
        } catch (error) {
            logger.debug('getUserStorageUsage: special-user check skipped:', error);
        }

        const usage = buildUsageResult({
            totalStorage,
            itemCount,
            fileCount,
            largestItem,
            topItems,
            userRank,
        });

        logger.debug(`getUserStorageUsage: Total storage ${usage.totalStorage} bytes (${usage.totalStorageFormatted}), Limit: ${usage.storageLimitFormatted}, Usage: ${usage.storageUsagePercent.toFixed(1)}%`);

        return usage;

    } catch (error) {
        logger.error('Error calculating storage usage:', error);
        throw error;
    }
}

/**
 * Page through every item that belongs to this user.
 *
 * A single ScanCommand returns at most 1 MB and applies its filter to that page
 * alone, so the previous one-shot scan only ever counted the matches that fell
 * inside the table's first megabyte. For any account past roughly that size the
 * reported usage — and with it the plan's storage quota — was an under-count.
 * Follow LastEvaluatedKey to the end instead.
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Matching items
 */
async function scanUserItems(userId) {
    const items = [];
    let exclusiveStartKey;
    let pages = 0;
    let truncated = false;

    do {
        const page = await dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            // The creator id is embedded in `text` ("Creator:<id>|..."), which
            // no index can search, so this is a table scan by nature.
            FilterExpression: 'contains(#text, :creatorId) OR #id = :userId',
            ExpressionAttributeNames: {
                '#id': 'id',
                '#text': 'text',
                '#files': 'files',
                '#createdAt': 'createdAt',
                '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
                ':creatorId': userId,
                ':userId': userId,
            },
            // Only what calculateItemSize() reads. Every other attribute was
            // fetched and then ignored, so projecting them away costs nothing
            // and lets each 1 MB page carry more of the items we care about.
            ProjectionExpression: '#id, #text, ActionGroupObject, #files, #createdAt, #updatedAt',
            ExclusiveStartKey: exclusiveStartKey,
        }));

        if (page.Items && page.Items.length) items.push(...page.Items);

        exclusiveStartKey = page.LastEvaluatedKey;
        pages += 1;
        if (exclusiveStartKey && pages >= MAX_SCAN_PAGES) {
            truncated = true;
            break;
        }
    } while (exclusiveStartKey);

    if (truncated) {
        logger.warn(`getUserStorageUsage: stopped after ${MAX_SCAN_PAGES} scan pages; usage for user ${userId} is under-counted. Raise STORAGE_SCAN_MAX_PAGES, or key items by owner so this lookup can use an index.`);
    }

    return items;
}

/**
 * Shape a usage figure from its raw parts. Shared by the scan path and by
 * addStorageUsage(), which has to produce the identical object shape from a
 * cached total plus a delta rather than from real items.
 * @param {Object} parts - Raw totals
 * @returns {Object} Storage usage information
 */
function buildUsageResult({ totalStorage, itemCount, fileCount, largestItem, topItems, userRank }) {
    const storageLimit = STORAGE_LIMITS[userRank];
    const storageUsagePercent = storageLimit ? (totalStorage / storageLimit) * 100 : 0;

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
            sizeFormatted: formatBytes(largestItem?.size || 0)
        },
        storageBreakdown: (topItems || []).map(item => ({
            ...item,
            sizeFormatted: formatBytes(item.size),
            textSizeFormatted: formatBytes(item.textSize),
            filesSizeFormatted: formatBytes(item.filesSize)
        })),
        isNearLimit: storageUsagePercent > 80,
        isOverLimit: storageUsagePercent > 100
    };
}

/**
 * Get user's total storage usage across all their database items, served from
 * the short-lived per-user cache described at the top of this file.
 * @param {string} userId - User ID
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceRefresh] - Bypass the cache and re-scan
 * @returns {Promise<Object>} Storage usage information
 */
function getUserStorageUsage(userId, { forceRefresh = false } = {}) {
    const key = cacheKeyFor(userId);

    if (!forceRefresh) {
        const cached = storageUsageCache.get(key);
        if (cached) {
            logger.debug('getUserStorageUsage: cache hit for user', userId);
            return Promise.resolve(cached);
        }

        // Another request is already scanning for this user — join it rather
        // than launching a second identical full-table scan.
        const pending = inFlightScans.get(key);
        if (pending) {
            logger.debug('getUserStorageUsage: joining in-flight scan for user', userId);
            return pending;
        }
    }

    const promise = computeStorageUsage(userId)
        .then((usage) => {
            storageUsageCache.set(key, usage);
            logger.debug(`getUserStorageUsage: cached ${usage.totalStorageFormatted} for user ${userId} (ttl ${STORAGE_USAGE_TTL_SECONDS}s)`);
            return usage;
        })
        .finally(() => {
            if (inFlightScans.get(key) === promise) inFlightScans.delete(key);
        });

    inFlightScans.set(key, promise);
    return promise;
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
            // A plan with no limit (storageLimit falsy) must not be divided by —
            // the old arithmetic produced NaN, which callers then rendered.
            usagePercent: currentUsage.storageLimit
                ? (newTotalSize / currentUsage.storageLimit) * 100
                : 0,
            reason: canStore ? 
                'Within storage limits' : 
                `Storage limit exceeded. Need ${formatBytes(newTotalSize - currentUsage.storageLimit)} additional space.`
        };
        
    } catch (error) {
        logger.error('Error checking storage capacity:', error);
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
        
        // Keep the cached total in step with the item that is about to be
        // written, so the next save inside the TTL window is checked against an
        // up-to-date figure instead of re-scanning the whole table for it.
        addStorageUsage(userId, itemSize, Array.isArray(itemData?.files) ? itemData.files.length : 0);

        // If we can store it, return success
        return {
            success: true,
            itemSize,
            itemSizeFormatted: formatBytes(itemSize),
            ...capacityCheck
        };
        
    } catch (error) {
        logger.error('Error tracking storage usage:', error);
        throw error;
    }
}

module.exports = {
    getUserStorageUsage,
    checkStorageCapacity,
    trackStorageUsage,
    invalidateStorageUsage,
    addStorageUsage,
    calculateItemSize,
    calculateDataSize,
    calculateFilesSize,
    formatBytes,
    STORAGE_LIMITS
};
