// Fix CORS Policy for Existing Bucket
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function fixCorsPolicy() {
    console.log('🔧 Fixing CORS Policy...\n');

    const bucketName = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_S3_REGION || process.env.AWS_REGION;

    const s3Client = new S3Client({
        region: region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });

    try {
        console.log(`🔗 Applying corrected CORS policy to "${bucketName}"...`);
        
        const corsConfiguration = {
            CORSRules: [
                {
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                    AllowedOrigins: [
                        'https://sthopwood.com',
                        'https://www.sthopwood.com',
                        'http://localhost:3000',
                        'http://localhost:5000'
                    ],
                    ExposeHeaders: ['ETag'], // Removed wildcard
                    MaxAgeSeconds: 3600
                }
            ]
        };

        await s3Client.send(new PutBucketCorsCommand({
            Bucket: bucketName,
            CORSConfiguration: corsConfiguration
        }));
        
        console.log('✅ CORS policy applied successfully!');
        console.log('\n📋 Applied CORS Configuration:');
        console.log('   - Allowed Methods: GET, PUT, POST, DELETE, HEAD');
        console.log('   - Allowed Origins: Your production and development domains');
        console.log('   - Exposed Headers: ETag');
        console.log('   - Max Age: 1 hour');

        console.log('\n✅ S3 bucket is now ready for file uploads!');
        
        console.log('\n🚀 Next steps:');
        console.log('1. Create CloudFront distribution (see AWS_SETUP_GUIDE.md)');
        console.log('2. Update AWS_CLOUDFRONT_DOMAIN in your .env file');
        console.log('3. Test file upload in your application');
        
    } catch (error) {
        console.log('\n❌ CORS policy update failed!');
        console.log('Error:', error.message);
        
        console.log('\n🔧 You can manually set CORS in AWS Console:');
        console.log('1. Go to S3 → Your bucket → Permissions → CORS');
        console.log('2. Paste this configuration:');
        console.log(`
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": [
            "https://sthopwood.com",
            "https://www.sthopwood.com",
            "http://localhost:3000",
            "http://localhost:5000"
        ],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]`);
    }
}

// Run the CORS fix
fixCorsPolicy().catch(console.error);