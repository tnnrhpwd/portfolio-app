// File Upload Controller for S3 Integration
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { 
    generatePresignedUploadUrl, 
    generateCloudFrontUrl, 
    checkFileExists, 
    deleteFile,
    getFileMetadata
} = require('../services/s3Service.js');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');
const { checkStorageCapacity, invalidateStorageUsage } = require('../utils/storageTracker');
const {
    INLINE_FILE_LIMITS,
    resolveAllowedFileTypes,
    resolveMaxFileBytes,
} = require('../constants/upload');

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
 * Read one record by its id.
 *
 * `Simple`'s primary key is composite — `id` (partition) + `createdAt` (sort) —
 * so a Get/Update keyed on `id` alone throws ValidationException. Every branch
 * that mutates an existing record therefore has to read the sort key off the
 * row first, and this partition-key Query is how: one read, no table scan.
 *
 * `Limit: 1` mirrors how the rest of the codebase treats a duplicate id (the
 * key allows several rows to share one, each with its own `createdAt`).
 *
 * @param {string} id - Item id (partition key)
 * @returns {Promise<Object|null>} The raw item, or null when absent
 */
async function findItemById(id) {
    const result = await dynamodb.send(new QueryCommand({
        TableName: 'Simple',
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': id },
        Limit: 1,
    }));
    return (result.Items && result.Items[0]) || null;
}

/**
 * The creator id inside a record's `text` ("Creator:<id>|..."), or null.
 *
 * Matched up to the next `|` delimiter rather than sliced to a fixed width:
 * ids in this table vary in length (legacy 24-char ObjectIds vs the 32-char
 * crypto hex ids in use now), and the old fixed-width slice compared the wrong
 * substring against the caller's id.
 *
 * @param {Object} item - Raw DynamoDB item
 * @returns {string|null} Creator id, or null when the record carries no tag
 */
function creatorIdOf(item) {
    const match = String(item?.text || '').match(/(?:^|\|)Creator:([^|]+)/);
    return match ? match[1].trim() : null;
}

// @desc    Request pre-signed URL for file upload
// @route   POST /api/data/upload-url
// @access  Private
const requestUploadUrl = asyncHandler(async (req, res) => {
    logger.debug('Upload URL request received');
    
    try {
        await checkIP(req);
    } catch (error) {
        logger.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        logger.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const { filename, contentType, fileSize, fileType = 'general', dataId } = req.body;

    logger.debug('Upload URL request data:', {
        userId: req.user.id,
        filename,
        contentType,
        fileSize,
        fileType,
        dataId
    });

    // Validate required fields
    if (!filename || !contentType || !fileSize) {
        res.status(400);
        throw new Error('Missing required fields: filename, contentType, and fileSize');
    }

    // Enforce the plan's storage quota BEFORE the client uploads anything.
    // This presigned-URL path is the primary upload route, so without a check
    // here the 50 GB / 100 MB cap in constants/pricing.js would only apply to
    // the legacy inline path. Failing at request time is also the cheapest
    // outcome: no bytes ever reach S3 for an over-limit user.
    //
    // fileSize must be a positive number: a non-numeric value would otherwise
    // skip both this quota check and the S3 size validation and still yield an
    // upload URL.
    const requestedBytes = Number(fileSize);
    if (!Number.isFinite(requestedBytes) || requestedBytes <= 0) {
        res.status(400);
        throw new Error('fileSize must be a positive number of bytes');
    }

    const capacity = await checkStorageCapacity(req.user.id, requestedBytes);
    if (!capacity.canStore) {
        res.status(413).json({
            success: false,
            error: 'Storage limit exceeded',
            details: capacity.reason,
            storageLimitFormatted: capacity.storageLimitFormatted,
            currentUsageFormatted: capacity.currentUsageFormatted,
        });
        return;
    }

    try {
        // Generate pre-signed upload URL
        const uploadData = await generatePresignedUploadUrl(
            req.user.id,
            filename,
            contentType,
            requestedBytes,
            fileType
        );

        logger.debug('Pre-signed URL generated successfully');

        // Return upload data to frontend
        res.status(200).json({
            success: true,
            uploadUrl: uploadData.uploadUrl,
            s3Key: uploadData.s3Key,
            cloudFrontUrl: generateCloudFrontUrl(uploadData.s3Key),
            expiresIn: uploadData.expiresIn,
            metadata: uploadData.metadata
        });

    } catch (error) {
        logger.error('Upload URL generation error:', error);
        res.status(500).json({
            error: `Failed to generate upload URL: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

// @desc    Confirm file upload and update database
// @route   POST /api/data/upload-confirm
// @access  Private
const confirmUpload = asyncHandler(async (req, res) => {
    logger.debug('Upload confirmation received');
    
    try {
        await checkIP(req);
    } catch (error) {
        logger.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        logger.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const { s3Key, dataId, filename, contentType, fileSize, fileType } = req.body;

    logger.debug('Upload confirmation data:', {
        userId: req.user.id,
        s3Key,
        dataId,
        filename,
        fileType
    });

    // Validate required fields
    if (!s3Key) {
        res.status(400);
        throw new Error('Missing required field: s3Key');
    }

    try {
        // Verify file exists in S3
        const fileExists = await checkFileExists(s3Key);
        if (!fileExists) {
                const missingObject = new Error('File not found in S3. Upload may have failed.');
                missingObject.statusCode = 400;
                throw missingObject;
        }

        // Get file metadata from S3
        const fileMetadata = await getFileMetadata(s3Key);
        
        // Generate CloudFront URL for accessing the file
        const cloudFrontUrl = generateCloudFrontUrl(s3Key);

        // Prepare file data for database
        const fileData = {
            s3Key: s3Key,
            filename: filename,
            contentType: contentType || fileMetadata.contentType,
            size: fileSize || fileMetadata.size,
            fileType: fileType || 'general',
            cloudFrontUrl: cloudFrontUrl,
            // Alias the public URL for the render paths that look for
            // `publicUrl` (AttachedFilesSection / DataResult). Without this,
            // a stored S3 file falls back to base64 rendering after a reload.
            publicUrl: cloudFrontUrl,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.id
        };

        // Re-check the quota at confirm time: usage may have grown since the URL
        // was issued (e.g. concurrent uploads that each passed individually).
        // If the file would push the user over, delete the object we just
        // received so we don't keep paying to store an orphan.
        const confirmedBytes = Number(fileSize) || fileMetadata.size || 0;
        if (confirmedBytes > 0) {
            const capacity = await checkStorageCapacity(req.user.id, confirmedBytes);
            if (!capacity.canStore) {
                try {
                    await deleteFile(s3Key);
                } catch (cleanupError) {
                    logger.warn(`Could not delete over-limit upload ${s3Key}: ${cleanupError.message}`);
                }
                res.status(413).json({
                    success: false,
                    error: 'Storage limit exceeded',
                    details: capacity.reason,
                    storageLimitFormatted: capacity.storageLimitFormatted,
                    currentUsageFormatted: capacity.currentUsageFormatted,
                });
                return;
            }
        }

        // If dataId is provided, update existing data item
        if (dataId) {
            logger.debug(`Updating existing data item: ${dataId}`);

            const currentItem = await findItemById(dataId);
            if (!currentItem) {
                const notFound = new Error('Data item not found');
                notFound.statusCode = 404;
                throw notFound;
            }

            // Deny by default: a record carrying no creator tag is not this
            // caller's to modify. The previous check only ran when the record
            // happened to contain a "Creator:" tag, so an untagged record was
            // silently updateable by anyone who guessed its id.
            if (creatorIdOf(currentItem) !== req.user.id) {
                const forbidden = new Error('User not authorized to update this item');
                forbidden.statusCode = 401;
                throw forbidden;
            }

            const existingFiles = currentItem.files || [];
            const updatedFiles = [...existingFiles, fileData];

            const updateParams = {
                TableName: 'Simple',
                // `Simple`'s key is composite, so the sort key read off the row
                // above is required to address it.
                Key: { id: dataId, createdAt: currentItem.createdAt },
                UpdateExpression: 'SET files = :files, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':files': updatedFiles,
                    ':updatedAt': new Date().toISOString()
                },
                ReturnValues: 'ALL_NEW'
            };

            const result = await dynamodb.send(new UpdateCommand(updateParams));

            // The item's `files` grew, so the cached usage figure no longer
            // matches what the next quota check should be measured against.
            invalidateStorageUsage(req.user.id);
            
            logger.debug(`Successfully updated data item ${dataId} with file`);
            
            res.status(200).json({
                success: true,
                message: 'File uploaded and data updated successfully',
                fileData: fileData,
                updatedItem: result.Attributes
            });

        } else {
            // Return file data for client to use when creating new data
            logger.debug('File upload confirmed, returning file data for new item creation');
            
            res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                fileData: fileData
            });
        }

    } catch (error) {
        logger.error('Upload confirmation error:', error);
        // Honour a deliberate status (404 not found / 401 not yours / 400 no
        // object in S3) instead of flattening every one of them into a 500.
        res.status(error.statusCode || 500).json({
            error: `Failed to confirm upload: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

// @desc    Delete file from S3 and database
// @route   DELETE /api/data/file/:s3Key
// @access  Private
const deleteUploadedFile = asyncHandler(async (req, res) => {
    logger.debug('File deletion request received');
    
    try {
        await checkIP(req);
    } catch (error) {
        logger.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        logger.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const s3Key = decodeURIComponent(req.params.s3Key);
    const { dataId } = req.body;

    logger.debug('File deletion data:', {
        userId: req.user.id,
        s3Key,
        dataId
    });

    // Validate S3 key belongs to user (security check)
    if (!s3Key.startsWith(`users/${req.user.id}/`)) {
        res.status(403);
        throw new Error('Unauthorized: Cannot delete files that do not belong to you');
    }

    try {
        // Delete file from S3
        await deleteFile(s3Key);

        // If dataId provided, remove file reference from database
        if (dataId) {
            const currentItem = await findItemById(dataId);

            if (currentItem) {
                // The S3-key prefix check above proves the *object* is the
                // caller's, but says nothing about who owns the record being
                // mutated — check that too before touching it.
                if (creatorIdOf(currentItem) !== req.user.id) {
                    const forbidden = new Error('User not authorized to update this item');
                    forbidden.statusCode = 401;
                    throw forbidden;
                }

                // Remove file from files array
                const updatedFiles = (currentItem.files || []).filter(
                    file => file.s3Key !== s3Key
                );

                const updateParams = {
                    TableName: 'Simple',
                    Key: { id: dataId, createdAt: currentItem.createdAt },
                    UpdateExpression: 'SET files = :files, updatedAt = :updatedAt',
                    ExpressionAttributeValues: {
                        ':files': updatedFiles,
                        ':updatedAt': new Date().toISOString()
                    }
                };

                await dynamodb.send(new UpdateCommand(updateParams));

                // The item's `files` shrank — re-derive rather than report the
                // pre-delete total for the rest of the TTL window.
                invalidateStorageUsage(req.user.id);
                logger.debug(`File reference removed from data item ${dataId}`);
            }
        }

        res.status(200).json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        logger.error('File deletion error:', error);
        // Honour a deliberate status (401 not yours) rather than reporting a
        // permission problem as a server error.
        res.status(error.statusCode || 500).json({
            error: `Failed to delete file: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

// @desc    Upload constraints the client should validate against
// @route   GET /api/data/upload-config
// @access  Private
const getUploadConfig = asyncHandler(async (req, res) => {
    res.status(200).json({
        success: true,
        allowedTypes: resolveAllowedFileTypes(),
        maxFileBytes: resolveMaxFileBytes(),
        // Inline (base64-in-record) attachments are capped hard — anything
        // larger must use the presigned S3 flow.
        maxInlineFileBytes: INLINE_FILE_LIMITS.MAX_INLINE_FILE_BYTES,
        maxInlineTotalBytes: INLINE_FILE_LIMITS.MAX_INLINE_TOTAL_BYTES,
    });
});

module.exports = {
    requestUploadUrl,
    confirmUpload,
    deleteUploadedFile,
    getUploadConfig
};