// S3 Service for handling file uploads with pre-signed URLs
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');
require('dotenv').config();
const { logger } = require('../utils/logger');
const {
    BLOCKED_EXTENSIONS,
    EXTENSION_CONTENT_TYPES,
    resolveAllowedFileTypes,
    resolveMaxFileBytes,
} = require('../constants/upload');

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

// Objects are stored under immutable keys (timestamp + random suffix), so a
// long browser/CloudFront TTL is safe and cuts repeat egress + origin GETs.
const CACHE_CONTROL = process.env.S3_CACHE_CONTROL || 'public, max-age=31536000, immutable';

// Optional storage class applied to NEW objects (e.g. INTELLIGENT_TIERING).
// Left unset by default: the lifecycle rules in
// scripts/configure-s3-lifecycle.js age objects into cheaper classes without
// Intelligent-Tiering's per-object monitoring fee, which is a poor trade for
// many small files.
const UPLOAD_STORAGE_CLASS = process.env.S3_UPLOAD_STORAGE_CLASS || undefined;

// Egress is the one S3 line item that can quietly grow, and CloudFront is
// both cheaper than direct-from-S3 egress and has a generous free tier. Warn
// once at boot if the app is configured to use CloudFront but the domain is
// missing/placeholder, because that silently falls back to direct S3 URLs.
const CLOUDFRONT_DOMAIN = process.env.AWS_CLOUDFRONT_DOMAIN;
if (USE_CLOUDFRONT && (!CLOUDFRONT_DOMAIN || CLOUDFRONT_DOMAIN === 'your-cloudfront-domain.cloudfront.net')) {
    logger.warn(
        '[s3] USE_CLOUDFRONT is enabled but AWS_CLOUDFRONT_DOMAIN is unset or still the placeholder — ' +
        'files will be served directly from S3 (higher egress cost). Set AWS_CLOUDFRONT_DOMAIN, ' +
        'or set USE_CLOUDFRONT=false to silence this warning.'
    );
}

// Validate file type and size with enhanced configuration
const validateFile = (filename, fileSize, contentType) => {
    // Allow-list + max size live in constants/upload.js, which is also what
    // GET /api/data/upload-config serves to the frontend — so the client's
    // pre-check and this server-side validation can't drift apart.
    const allowedTypes = resolveAllowedFileTypes();
    const maxSize = resolveMaxFileBytes();

    logger.debug('Validating file:', { filename, fileSize, contentType, allowedTypes, maxSize });

    // Check file type
    if (!allowedTypes.includes(contentType)) {
        throw new Error(`File type ${contentType} is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
    }

    // Defense-in-depth: the client supplies `contentType` and the S3 key keeps
    // the original extension. Reject known-dangerous extensions and known
    // image/pdf extensions that don't match the declared content type, so a
    // user can't upload an .html/.svg/.exe relabeled as an allowed image.
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
        throw new Error(`File extension .${ext} is not allowed.`);
    }
    const typeByExt = EXTENSION_CONTENT_TYPES;
    if (typeByExt[ext] && typeByExt[ext] !== contentType) {
        throw new Error(`File extension .${ext} does not match content type ${contentType}`);
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
            CacheControl: CACHE_CONTROL,
            ...(UPLOAD_STORAGE_CLASS && { StorageClass: UPLOAD_STORAGE_CLASS }),
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
            expiresIn: PRESIGNED_URL_EXPIRES,
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
            CacheControl: CACHE_CONTROL,
            ...(UPLOAD_STORAGE_CLASS && { StorageClass: UPLOAD_STORAGE_CLASS }),
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

// Read just the leading bytes of an object, so the upload-confirm gate can see
// what was actually stored (see utils/fileSignature.js). A Range GET keeps this
// to a few hundred bytes rather than the whole object.
//
// Returns null instead of throwing when the read fails. Content verification is
// defence-in-depth on top of validation that already passed, so an S3 hiccup
// must not fail an otherwise-good upload — the caller logs and moves on.
const getObjectHead = async (s3Key, byteCount = 512) => {
    try {
        const span = Math.max(1, Number(byteCount) || 1);
        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: s3Key,
            Range: `bytes=0-${span - 1}`,
        });

        const response = await s3Client.send(command);
        if (!response.Body) return null;

        const chunk = await response.Body.transformToByteArray();
        return Buffer.from(chunk);

    } catch (error) {
        logger.warn(`Could not read leading bytes of ${s3Key}: ${error.message}`);
        return null;
    }
};

module.exports = {
    generatePresignedUploadUrl,
    generateCloudFrontUrl,
    checkFileExists,
    deleteFile,
    getFileMetadata,
    getFileBuffer,
    getObjectHead,
    uploadImageBuffer,
    validateFile,
    generateS3Key
};