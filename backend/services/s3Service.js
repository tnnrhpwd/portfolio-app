// S3 Service for handling file uploads with pre-signed URLs
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');
require('dotenv').config();
const { logger } = require('../utils/logger');

// Enhanced S3 client with configuration
const s3Client = new S3Client({
    region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    // Enable transfer acceleration if configured
    ...(process.env.S3_TRANSFER_ACCELERATION === 'true' && {
        endpoint: `https://s3-accelerate.amazonaws.com`
    })
});

// Configuration from environment variables
const USE_CLOUDFRONT = process.env.USE_CLOUDFRONT !== 'false';
const PRESIGNED_URL_EXPIRES = parseInt(process.env.S3_PRESIGNED_URL_EXPIRES) || 900;
const MAX_FILES_PER_UPLOAD = parseInt(process.env.MAX_FILES_PER_UPLOAD) || 5;

// Validate file type and size with enhanced configuration
const validateFile = (filename, fileSize, contentType) => {
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,image/webp,application/pdf').split(',');
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 52428800; // 50MB default

    logger.debug('Validating file:', { filename, fileSize, contentType, allowedTypes, maxSize });

    // Check file type
    if (!allowedTypes.includes(contentType)) {
        throw new Error(`File type ${contentType} is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
    }

    // Check file size
    if (fileSize > maxSize) {
        throw new Error(`File size ${fileSize} exceeds maximum allowed size of ${maxSize} bytes`);
    }

    // Check filename for security
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    if (sanitizedFilename !== filename) {
        logger.warn(`Filename sanitized from "${filename}" to "${sanitizedFilename}"`);
    }

    return { isValid: true, sanitizedFilename };
};

// Generate S3 key (file path) for user
const generateS3Key = (userId, filename, fileType = 'general') => {
    const fileExtension = filename.split('.').pop();
    const timestamp = Date.now();
    const uniqueId = randomUUID().substring(0, 8);
    
    // Create organized folder structure
    const folder = fileType === 'profile' ? 'profiles' : 
                   fileType === 'ocr' ? 'ocr-images' : 
                   fileType === 'attachment' ? 'attachments' :
                   fileType === 'generated' ? 'generated' : 'general';
    
    return `users/${userId}/${folder}/${timestamp}_${uniqueId}.${fileExtension}`;
};

// Generate pre-signed URL for upload
const generatePresignedUploadUrl = async (userId, filename, contentType, fileSize, fileType = 'general') => {
    try {
        logger.debug('Generating pre-signed URL for:', { userId, filename, contentType, fileSize, fileType });

        // Validate file
        const { sanitizedFilename } = validateFile(filename, fileSize, contentType);

        // Generate S3 key
        const s3Key = generateS3Key(userId, sanitizedFilename, fileType);

        // Create command for S3
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
            ContentType: contentType,
            ContentLength: fileSize,
            Metadata: {
                'uploaded-by': userId,
                'file-type': fileType,
                'original-filename': sanitizedFilename,
                'upload-timestamp': new Date().toISOString()
            }
        });

        // Generate pre-signed URL with configurable expiration
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES });

        logger.debug('Pre-signed URL generated successfully');

        return {
            uploadUrl: presignedUrl,
            s3Key: s3Key,
            bucket: process.env.AWS_S3_BUCKET,
            region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
            expiresIn: 900, // 15 minutes
            contentType: contentType,
            metadata: {
                userId,
                filename: sanitizedFilename,
                fileType,
                size: fileSize
            }
        };

    } catch (error) {
        logger.error('Error generating pre-signed URL:', error);
        throw new Error(`Failed to generate upload URL: ${error.message}`);
    }
};

// Generate CloudFront URL for accessing files with enhanced configuration
const generateCloudFrontUrl = (s3Key) => {
    const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
    
    // Check if CloudFront is enabled and properly configured
    if (USE_CLOUDFRONT && cloudFrontDomain && cloudFrontDomain !== 'your-cloudfront-domain.cloudfront.net') {
        logger.debug(`Using CloudFront URL: https://${cloudFrontDomain}/${s3Key}`);
        return `https://${cloudFrontDomain}/${s3Key}`;
    }
    
    // Fallback to direct S3 URL if CloudFront not configured or disabled
    const region = process.env.AWS_S3_REGION || process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;
    return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
};

// Check if file exists in S3
const checkFileExists = async (s3Key) => {
    try {
        const command = new HeadObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
        });
        
        await s3Client.send(command);
        return true;
    } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
};

// Delete file from S3
const deleteFile = async (s3Key) => {
    try {
        logger.debug('Deleting file from S3:', s3Key);

        const command = new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
        });

        await s3Client.send(command);
        logger.debug('File deleted successfully from S3');
        return true;

    } catch (error) {
        logger.error('Error deleting file from S3:', error);
        throw new Error(`Failed to delete file: ${error.message}`);
    }
};

// Get file metadata from S3
const getFileMetadata = async (s3Key) => {
    try {
        const command = new HeadObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
        });

        const response = await s3Client.send(command);
        
        return {
            size: response.ContentLength,
            contentType: response.ContentType,
            lastModified: response.LastModified,
            metadata: response.Metadata,
            etag: response.ETag
        };

    } catch (error) {
        logger.error('Error getting file metadata:', error);
        throw new Error(`Failed to get file metadata: ${error.message}`);
    }
};

// Upload an in-memory buffer (e.g. a freshly generated image) directly to S3.
// Returns the s3Key, a public CloudFront/S3 URL, and the byte size so callers
// can record storage usage without a second HeadObject round-trip.
const uploadImageBuffer = async (userId, buffer, contentType, fileType = 'generated', filename) => {
    try {
        const ext = contentType === 'image/png' ? 'png'
            : contentType === 'image/jpeg' || contentType === 'image/jpg' ? 'jpg'
            : 'png';
        const name = filename || `image-${Date.now()}.${ext}`;
        const s3Key = generateS3Key(userId, name, fileType);

        const command = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: contentType,
            ContentLength: buffer.length,
            Metadata: {
                'uploaded-by': userId,
                'file-type': fileType,
                'upload-timestamp': new Date().toISOString(),
            },
        });

        await s3Client.send(command);

        return {
            s3Key,
            url: generateCloudFrontUrl(s3Key),
            bytes: buffer.length,
            contentType,
        };
    } catch (error) {
        logger.error('Error uploading image buffer to S3:', error);
        throw new Error(`Failed to upload generated image: ${error.message}`);
    }
};

// Download a file from S3 and return its contents as a base64 string.
const getFileBuffer = async (s3Key) => {
    try {
        logger.debug('Fetching file from S3:', s3Key);

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
        });

        const response = await s3Client.send(command);
        return await response.Body.transformToString('base64');

    } catch (error) {
        logger.error('Error fetching file from S3:', error);
        throw new Error(`Failed to fetch file from S3: ${error.message}`);
    }
};

module.exports = {
    generatePresignedUploadUrl,
    generateCloudFrontUrl,
    checkFileExists,
    deleteFile,
    getFileMetadata,
    getFileBuffer,
    uploadImageBuffer,
    validateFile,
    generateS3Key
};