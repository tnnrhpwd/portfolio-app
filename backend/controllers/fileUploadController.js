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
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');
const { checkStorageCapacity } = require('../utils/storageTracker');
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
            res.status(400);
            throw new Error('File not found in S3. Upload may have failed.');
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
            
            // First, get the current item
            const getParams = {
                TableName: 'Simple',
                Key: { id: dataId }
            };
            
            const currentItem = await dynamodb.send(new GetCommand(getParams));
            
            if (!currentItem.Item) {
                res.status(404);
                throw new Error('Data item not found');
            }

            // Check ownership
            if (currentItem.Item.text && currentItem.Item.text.includes('Creator:')) {
                const dataCreator = currentItem.Item.text.substring(
                    currentItem.Item.text.indexOf("Creator:") + 8, 
                    currentItem.Item.text.indexOf("Creator:") + 8 + 24
                );
                if (dataCreator !== req.user.id) {
                    res.status(401);
                    throw new Error('User not authorized to update this item');
                }
            }

            // Update the item with new file data
            const existingFiles = currentItem.Item.files || [];
            const updatedFiles = [...existingFiles, fileData];

            const updateParams = {
                TableName: 'Simple',
                Key: { id: dataId },
                UpdateExpression: 'SET files = :files, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':files': updatedFiles,
                    ':updatedAt': new Date().toISOString()
                },
                ReturnValues: 'ALL_NEW'
            };

            const result = await dynamodb.send(new UpdateCommand(updateParams));
            
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
        res.status(500).json({
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
            // Get current item
            const getParams = {
                TableName: 'Simple',
                Key: { id: dataId }
            };
            
            const currentItem = await dynamodb.send(new GetCommand(getParams));
            
            if (currentItem.Item) {
                // Remove file from files array
                const updatedFiles = (currentItem.Item.files || []).filter(
                    file => file.s3Key !== s3Key
                );

                const updateParams = {
                    TableName: 'Simple',
                    Key: { id: dataId },
                    UpdateExpression: 'SET files = :files, updatedAt = :updatedAt',
                    ExpressionAttributeValues: {
                        ':files': updatedFiles,
                        ':updatedAt': new Date().toISOString()
                    }
                };

                await dynamodb.send(new UpdateCommand(updateParams));
                logger.debug(`File reference removed from data item ${dataId}`);
            }
        }

        res.status(200).json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        logger.error('File deletion error:', error);
        res.status(500).json({
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