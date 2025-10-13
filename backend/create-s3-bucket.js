// Create S3 Bucket for Portfolio Files
const { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function createPortfolioBucket() {
    console.log('🪣 Creating Portfolio S3 Bucket...\n');

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
        // Step 1: Create bucket
        console.log(`📁 Step 1: Creating bucket "${bucketName}" in ${region}...`);
        
        const createParams = {
            Bucket: bucketName,
            ...(region !== 'us-east-1' && {
                CreateBucketConfiguration: {
                    LocationConstraint: region
                }
            })
        };

        await s3Client.send(new CreateBucketCommand(createParams));
        console.log('✅ Bucket created successfully!');

        // Step 2: Configure CORS
        console.log('\n🔗 Step 2: Configuring CORS policy...');
        
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
                    ExposeHeaders: ['ETag', 'x-amz-meta-*'],
                    MaxAgeSeconds: 3600
                }
            ]
        };

        await s3Client.send(new PutBucketCorsCommand({
            Bucket: bucketName,
            CORSConfiguration: corsConfiguration
        }));
        
        console.log('✅ CORS policy applied successfully!');

        // Step 3: Information about bucket policy (will be set after CloudFront)
        console.log('\n🔐 Step 3: Bucket Policy (CloudFront setup needed first)');
        console.log('⚠️  Bucket is currently private (recommended)');
        console.log('   After creating CloudFront distribution, you\'ll need to:');
        console.log('   1. Create CloudFront distribution');
        console.log('   2. Add bucket policy allowing CloudFront access');
        console.log('   3. Update AWS_CLOUDFRONT_DOMAIN in .env');

        console.log('\n✅ S3 bucket setup completed!');
        console.log('\n🚀 Next steps:');
        console.log('1. Create CloudFront distribution (see AWS_SETUP_GUIDE.md)');
        console.log('2. Update AWS_CLOUDFRONT_DOMAIN in your .env file');
        console.log('3. Test file upload in your application');
        
    } catch (error) {
        console.log('\n❌ Bucket creation failed!');
        console.log('Error:', error.message);
        
        if (error.name === 'BucketAlreadyExists') {
            console.log('\n💡 The bucket name is already taken globally.');
            console.log('🔧 Solutions:');
            console.log('1. Try a different bucket name in AWS_S3_BUCKET');
            console.log('2. Or use: sthopwood-portfolio-' + Date.now());
        } else if (error.name === 'BucketAlreadyOwnedByYou') {
            console.log('\n✅ Great! You already own this bucket.');
            console.log('Continuing with CORS configuration...');
            
            // Still try to apply CORS
            try {
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
                            ExposeHeaders: ['ETag', 'x-amz-meta-*'],
                            MaxAgeSeconds: 3600
                        }
                    ]
                };

                await s3Client.send(new PutBucketCorsCommand({
                    Bucket: bucketName,
                    CORSConfiguration: corsConfiguration
                }));
                
                console.log('✅ CORS policy updated successfully!');
            } catch (corsError) {
                console.log('⚠️  CORS update failed:', corsError.message);
            }
        } else {
            console.log('\n🔧 Common fixes:');
            console.log('- Check your AWS credentials have S3:CreateBucket permission');
            console.log('- Verify the bucket name is globally unique');
            console.log('- Make sure the region is correct');
        }
    }
}

// Run the bucket creation
createPortfolioBucket().catch(console.error);