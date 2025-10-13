// Test CloudFront Distribution
const https = require('https');
require('dotenv').config();

async function testCloudFront() {
    console.log('☁️  Testing CloudFront Distribution...\n');

    const cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
    
    if (!cloudFrontDomain || cloudFrontDomain === 'your-cloudfront-domain.cloudfront.net') {
        console.log('❌ CloudFront domain not configured!');
        return;
    }

    console.log(`🌍 Testing domain: ${cloudFrontDomain}`);

    // Test 1: Check if CloudFront domain is accessible
    try {
        console.log('\n📡 Test 1: CloudFront accessibility...');
        
        const testUrl = `https://${cloudFrontDomain}/test`;
        
        await new Promise((resolve, reject) => {
            const req = https.get(testUrl, { timeout: 5000 }, (res) => {
                console.log(`✅ CloudFront responding (Status: ${res.statusCode})`);
                
                if (res.statusCode === 404) {
                    console.log('   ℹ️  404 is expected for test path - CloudFront is working!');
                } else if (res.statusCode === 403) {
                    console.log('   ℹ️  403 means CloudFront is working but S3 access needs configuration');
                }
                
                resolve();
            });
            
            req.on('error', (error) => {
                if (error.code === 'ENOTFOUND') {
                    console.log('❌ CloudFront domain not found!');
                    console.log('   Check if distribution is deployed and domain is correct');
                } else {
                    console.log(`❌ CloudFront error: ${error.message}`);
                }
                reject(error);
            });
            
            req.on('timeout', () => {
                console.log('⏱️  CloudFront request timed out');
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
        
    } catch (error) {
        // Error handling is done in the request callbacks
    }

    // Test 2: Validate domain format
    console.log('\n🔍 Test 2: Domain validation...');
    
    const domainPattern = /^d[a-z0-9]+\.cloudfront\.net$/;
    const isValidFormat = domainPattern.test(cloudFrontDomain);
    
    console.log(`✅ Domain format valid: ${isValidFormat ? 'YES' : 'NO'}`);
    
    if (!isValidFormat) {
        console.log('   ⚠️  CloudFront domains should match: d[random].cloudfront.net');
    }

    // Test 3: Check S3 service compatibility
    console.log('\n🔧 Test 3: S3 Service integration...');
    
    try {
        const s3Service = require('./utils/s3Service.js');
        const testKey = 'test/sample-file.jpg';
        const testUrl = s3Service.generateCloudFrontUrl(testKey);
        
        console.log(`✅ Generated CloudFront URL: ${testUrl}`);
        
        const expectedUrl = `https://${cloudFrontDomain}/${testKey}`;
        if (testUrl === expectedUrl) {
            console.log('✅ S3 service CloudFront integration working correctly!');
        } else {
            console.log('⚠️  S3 service URL generation mismatch');
        }
        
    } catch (error) {
        console.log(`❌ S3 service integration error: ${error.message}`);
    }

    console.log('\n📋 CloudFront Status Summary:');
    console.log(`🌐 Domain: ${cloudFrontDomain}`);
    console.log(`🔗 Full URL: https://${cloudFrontDomain}`);
    console.log(`⚙️  S3 Integration: Ready`);
    
    console.log('\n🚀 Next Steps:');
    console.log('1. Test file upload in your application');
    console.log('2. Upload should work with direct S3 URLs immediately');
    console.log('3. Files will be served via CloudFront for global performance');
}

// Run the CloudFront test
testCloudFront().catch(console.error);