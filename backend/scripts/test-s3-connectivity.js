// Test AWS S3 Connectivity
// This script tests if your AWS credentials can access S3

const { S3Client, ListBucketsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function testS3Connectivity() {
    console.log('🔗 Testing AWS S3 Connectivity...\n');

    // Initialize S3 client
    const s3Client = new S3Client({
        region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });

    try {
        // Test 1: List all buckets (verify credentials work)
        console.log('📋 Test 1: Listing all buckets...');
        const listCommand = new ListBucketsCommand({});
        const response = await s3Client.send(listCommand);
        
        console.log(`✅ Found ${response.Buckets.length} bucket(s):`);
        response.Buckets.forEach(bucket => {
            const isTarget = bucket.Name === process.env.AWS_S3_BUCKET;
            console.log(`   ${isTarget ? '🎯' : '📁'} ${bucket.Name} (${bucket.CreationDate?.toLocaleDateString()})`);
        });

        // Test 2: Check if target bucket exists
        const targetBucket = process.env.AWS_S3_BUCKET;
        console.log(`\n🎯 Test 2: Checking target bucket "${targetBucket}"...`);
        
        const bucketExists = response.Buckets.some(bucket => bucket.Name === targetBucket);
        
        if (bucketExists) {
            console.log('✅ Target bucket exists!');
            
            // Test 3: Check bucket permissions
            console.log('\n🔐 Test 3: Checking bucket permissions...');
            const headCommand = new HeadBucketCommand({ Bucket: targetBucket });
            await s3Client.send(headCommand);
            console.log('✅ You have access to the target bucket!');
            
        } else {
            console.log('❌ Target bucket does not exist!');
            console.log('\n🔧 Create it with:');
            console.log(`aws s3 mb s3://${targetBucket} --region ${process.env.AWS_S3_REGION}`);
        }

        console.log('\n✅ S3 connectivity test completed successfully!');
        
    } catch (error) {
        console.log('\n❌ S3 connectivity test failed!');
        console.log('Error:', error.message);
        
        if (error.name === 'CredentialsProviderError') {
            console.log('\n🔧 Credential Issues:');
            console.log('- Check AWS_ACCESS_KEY_ID is correct');
            console.log('- Check AWS_SECRET_ACCESS_KEY is correct');
            console.log('- Make sure credentials have S3 permissions');
        } else if (error.name === 'NoSuchBucket') {
            console.log('\n🔧 Bucket Issues:');
            console.log(`- Create bucket: aws s3 mb s3://${process.env.AWS_S3_BUCKET}`);
            console.log('- Check bucket name spelling');
        } else if (error.name === 'AccessDenied') {
            console.log('\n🔧 Permission Issues:');
            console.log('- Your credentials lack S3 permissions');
            console.log('- Attach S3FullAccess policy to your IAM user');
        }
    }
}

// Run the test
testS3Connectivity().catch(console.error);