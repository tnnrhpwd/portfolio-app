// AWS S3 + CloudFront Configuration Test
// Run this script to verify your setup before testing uploads

require('dotenv').config();

console.log('🔍 AWS S3 + CloudFront Configuration Check');
console.log('=' .repeat(50));

// Check required environment variables
const requiredVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_S3_BUCKET',
    'AWS_S3_REGION',
    'AWS_CLOUDFRONT_DOMAIN'
];

console.log('\n📋 Environment Variables:');
const missingVars = [];
requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value && value !== 'your-cloudfront-domain.cloudfront.net' && value !== 'your-app-bucket-name') {
        console.log(`✅ ${varName}: ${varName.includes('SECRET') ? '***HIDDEN***' : value}`);
    } else {
        console.log(`❌ ${varName}: NOT SET OR PLACEHOLDER`);
        missingVars.push(varName);
    }
});

// Check optional configuration
console.log('\n⚙️  Configuration Settings:');
console.log(`📁 S3 Bucket: ${process.env.AWS_S3_BUCKET}`);
console.log(`🌍 Region: ${process.env.AWS_S3_REGION || process.env.AWS_REGION}`);
console.log(`🚀 CloudFront Domain: ${process.env.AWS_CLOUDFRONT_DOMAIN}`);
console.log(`☁️  Use CloudFront: ${process.env.USE_CLOUDFRONT !== 'false' ? 'YES' : 'NO'}`);
console.log(`⏱️  Pre-signed URL Expires: ${process.env.S3_PRESIGNED_URL_EXPIRES || '900'} seconds`);
console.log(`📏 Max File Size: ${(parseInt(process.env.MAX_FILE_SIZE || '52428800') / 1024 / 1024).toFixed(1)}MB`);
console.log(`📄 Allowed Types: ${process.env.ALLOWED_FILE_TYPES?.split(',').length || 5} types`);

// Test AWS SDK
console.log('\n🔧 AWS SDK Test:');
try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const s3Client = new S3Client({
        region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    console.log('✅ AWS S3 SDK initialized successfully');
    
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    console.log('✅ Pre-signed URL generator available');
    
} catch (error) {
    console.log('❌ AWS SDK Error:', error.message);
}

// Test S3 service import
console.log('\n📦 S3 Service Test:');
try {
    const s3Service = require('../services/s3Service.js');
    console.log('✅ S3 Service imported successfully');
    console.log(`✅ Available functions: ${Object.keys(s3Service).join(', ')}`);
} catch (error) {
    console.log('❌ S3 Service Error:', error.message);
}

// Summary and next steps
console.log('\n📝 Summary:');
if (missingVars.length === 0) {
    console.log('✅ All required environment variables are set!');
    console.log('\n🚀 Next Steps:');
    console.log('1. Create S3 bucket: aws s3 mb s3://' + process.env.AWS_S3_BUCKET);
    console.log('2. Set up CloudFront distribution pointing to your S3 bucket');
    console.log('3. Update AWS_CLOUDFRONT_DOMAIN in .env with your CloudFront domain');
    console.log('4. Test file upload in your app');
} else {
    console.log(`❌ Missing ${missingVars.length} required variable(s): ${missingVars.join(', ')}`);
    console.log('\n🔧 Fix Required:');
    console.log('1. Set all missing environment variables in your .env file');
    console.log('2. Make sure AWS credentials have S3 permissions');
    console.log('3. Run this test again');
}

console.log('\n' + '=' .repeat(50));
console.log('💡 Full setup guide: AWS_SETUP_GUIDE.md');
console.log('📚 Implementation summary: docs/archive/S3_INTEGRATION_SUMMARY.md');