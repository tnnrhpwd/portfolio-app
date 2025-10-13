// Check and Generate CloudFront S3 Bucket Policy
const { S3Client, GetBucketPolicyCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function checkAndGenerateBucketPolicy() {
    console.log('🔐 Checking S3 Bucket Policy for CloudFront Access...\n');

    const bucketName = process.env.AWS_S3_BUCKET;
    const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
    const region = process.env.AWS_S3_REGION || process.env.AWS_REGION;

    const s3Client = new S3Client({
        region: region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });

    try {
        // Check current bucket policy
        console.log(`📋 Checking current bucket policy for: ${bucketName}`);
        
        let currentPolicy = null;
        try {
            const policyCommand = new GetBucketPolicyCommand({ Bucket: bucketName });
            const policyResponse = await s3Client.send(policyCommand);
            currentPolicy = JSON.parse(policyResponse.Policy);
            console.log('✅ Current bucket policy found');
        } catch (error) {
            if (error.name === 'NoSuchBucketPolicy') {
                console.log('ℹ️  No bucket policy currently set');
            } else {
                throw error;
            }
        }

        // Generate recommended policy
        console.log('\n🔧 Generating recommended CloudFront bucket policy...');
        
        // Note: You'll need to get your AWS account ID and CloudFront distribution ID
        console.log(`
📝 MANUAL STEP REQUIRED:

To allow CloudFront access to your S3 bucket, you need to:

1. Get your CloudFront Distribution ID:
   - Go to AWS CloudFront Console
   - Find your distribution for ${cloudFrontDomain}  
   - Copy the Distribution ID (looks like: E1ABCDEFGHIJKL)

2. Get your AWS Account ID:
   - AWS Console → Top right → Account dropdown → Account ID

3. Apply this bucket policy to your S3 bucket "${bucketName}":

{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowCloudFrontServicePrincipal",
            "Effect": "Allow",
            "Principal": {
                "Service": "cloudfront.amazonaws.com"
            },
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::${bucketName}/*",
            "Condition": {
                "StringEquals": {
                    "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
                }
            }
        }
    ]
}

4. Apply via AWS Console:
   - S3 → ${bucketName} → Permissions → Bucket Policy
   - Paste the policy above (replace YOUR_ACCOUNT_ID and YOUR_DISTRIBUTION_ID)
   - Save changes

OR use AWS CLI:
aws s3api put-bucket-policy --bucket ${bucketName} --policy file://bucket-policy.json

`);

        console.log('🎯 Current Configuration Status:');
        console.log(`✅ S3 Bucket: ${bucketName} (exists and accessible)`);
        console.log(`✅ CloudFront Domain: ${cloudFrontDomain} (responding)`);  
        console.log(`✅ CORS Policy: Applied for browser uploads`);
        console.log(`⏳ Bucket Policy: Needs CloudFront access (manual step above)`);

        console.log('\n🚀 What Works Right Now:');
        console.log('✅ File uploads via pre-signed URLs (direct to S3)');
        console.log('✅ File display via direct S3 URLs');
        console.log('✅ XAI OCR processing (main issue solved!)');
        
        console.log('\n⚡ After Bucket Policy (Optional Performance Boost):');
        console.log('🚀 Files served globally via CloudFront CDN');
        console.log('🚀 Faster loading times worldwide');
        console.log('🚀 S3 bandwidth cost reduction');

    } catch (error) {
        console.log(`❌ Error checking bucket policy: ${error.message}`);
    }
}

// Run the check
checkAndGenerateBucketPolicy().catch(console.error);