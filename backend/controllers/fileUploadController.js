// File Upload Controller for S3 Integration
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { 
    generatePresignedUploadUrl, 
    generateCloudFrontUrl, 
    checkFileExists, 
    deleteFile,
    getFileMetadata
} = require('../utils/s3Service.js');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
    console.log('Upload URL request received');
    
    try {
        await checkIP(req);
    } catch (error) {
        console.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        console.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const { filename, contentType, fileSize, fileType = 'general', dataId } = req.body;

    console.log('Upload URL request data:', {
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

    try {
        // Generate pre-signed upload URL
        const uploadData = await generatePresignedUploadUrl(
            req.user.id,
            filename,
            contentType,
            parseInt(fileSize),
            fileType
        );

        console.log('Pre-signed URL generated successfully');

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
        console.error('Upload URL generation error:', error);
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
    console.log('Upload confirmation received');
    
    try {
        await checkIP(req);
    } catch (error) {
        console.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        console.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const { s3Key, dataId, filename, contentType, fileSize, fileType } = req.body;

    console.log('Upload confirmation data:', {
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
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.id
        };

        // If dataId is provided, update existing data item
        if (dataId) {
            console.log(`Updating existing data item: ${dataId}`);
            
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
            
            console.log(`Successfully updated data item ${dataId} with file`);
            
            res.status(200).json({
                success: true,
                message: 'File uploaded and data updated successfully',
                fileData: fileData,
                updatedItem: result.Attributes
            });

        } else {
            // Return file data for client to use when creating new data
            console.log('File upload confirmed, returning file data for new item creation');
            
            res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                fileData: fileData
            });
        }

    } catch (error) {
        console.error('Upload confirmation error:', error);
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
    console.log('File deletion request received');
    
    try {
        await checkIP(req);
    } catch (error) {
        console.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }

    // Check for user authentication
    if (!req.user) {
        console.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }

    const s3Key = decodeURIComponent(req.params.s3Key);
    const { dataId } = req.body;

    console.log('File deletion data:', {
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
                console.log(`File reference removed from data item ${dataId}`);
            }
        }

        res.status(200).json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('File deletion error:', error);
        res.status(500).json({
            error: `Failed to delete file: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = {
    requestUploadUrl,
    confirmUpload,
    deleteUploadedFile
};