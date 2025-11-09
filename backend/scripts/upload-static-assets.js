// Upload Static Assets to S3 Script
// This script uploads frontend static assets to S3 and provides CloudFront URLs

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
require('dotenv').config();

// Initialize S3 client
const s3Client = new S3Client({
    region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET;
const CLOUDFRONT_DOMAIN = process.env.AWS_CLOUDFRONT_DOMAIN;

async function uploadAsset(localFilePath, s3Key, description = '') {
    try {
        console.log(`📁 Uploading ${description || path.basename(localFilePath)}...`);
        
        // Check if file exists locally
        if (!fs.existsSync(localFilePath)) {
            throw new Error(`File not found: ${localFilePath}`);
        }

        // Read file
        const fileContent = fs.readFileSync(localFilePath);
        const contentType = mime.lookup(localFilePath) || 'application/octet-stream';
        const fileSize = fs.statSync(localFilePath).size;

        console.log(`   📋 File size: ${(fileSize / 1024).toFixed(1)} KB`);
        console.log(`   🎨 Content type: ${contentType}`);

        // Upload to S3
        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileContent,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000' // 1 year cache for static assets
            // Note: Public access is controlled by bucket policy, not ACL
        };

        const result = await s3Client.send(new PutObjectCommand(uploadParams));
        
        // Generate CloudFront URL
        const cloudFrontUrl = `https://${CLOUDFRONT_DOMAIN}/${s3Key}`;
        const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION || process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

        console.log(`   ✅ Upload successful!`);
        console.log(`   🌐 CloudFront URL: ${cloudFrontUrl}`);
        console.log(`   📦 S3 URL: ${s3Url}`);

        return {
            success: true,
            s3Key,
            cloudFrontUrl,
            s3Url,
            contentType,
            fileSize,
            etag: result.ETag
        };

    } catch (error) {
        console.error(`   ❌ Upload failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

async function uploadStaticAssets() {
    console.log('🚀 Starting Static Assets Upload to S3...\n');
    
    console.log(`📊 Configuration:`);
    console.log(`   S3 Bucket: ${BUCKET_NAME}`);
    console.log(`   CloudFront Domain: ${CLOUDFRONT_DOMAIN}`);
    console.log(`   AWS Region: ${process.env.AWS_S3_REGION || process.env.AWS_REGION}\n`);

    const assets = [
        {
            localPath: '../frontend/src/pages/Simple/Simple/simple_graphic.png',
            s3Key: 'static/images/simple_graphic.png',
            description: 'Simple System Intelligence Overview Graphic'
        }
        // Add more static assets here as needed
    ];

    const results = [];

    for (const asset of assets) {
        const absolutePath = path.resolve(__dirname, asset.localPath);
        const result = await uploadAsset(absolutePath, asset.s3Key, asset.description);
        results.push({ ...asset, ...result });
        console.log(); // Empty line for readability
    }

    // Summary
    console.log('📊 Upload Summary:');
    console.log('==========================================');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful uploads: ${successful.length}`);
    console.log(`❌ Failed uploads: ${failed.length}`);
    
    if (successful.length > 0) {
        console.log('\n🌐 CloudFront URLs for your code:');
        console.log('==========================================');
        successful.forEach(asset => {
            console.log(`// ${asset.description}`);
            console.log(`const ${path.basename(asset.s3Key, path.extname(asset.s3Key)).replace(/[^a-zA-Z0-9]/g, '_')}Url = '${asset.cloudFrontUrl}';`);
            console.log('');
        });
    }

    if (failed.length > 0) {
        console.log('\n❌ Failed uploads:');
        failed.forEach(asset => {
            console.log(`   ${asset.description}: ${asset.error}`);
        });
    }

    return results;
}

// Run if called directly
if (require.main === module) {
    uploadStaticAssets().catch(console.error);
}

module.exports = { uploadAsset, uploadStaticAssets };