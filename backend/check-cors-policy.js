// Check S3 Bucket CORS Configuration
const { S3Client, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function checkBucketCors() {
    console.log('🔍 Checking S3 Bucket CORS Configuration...\n');

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
        console.log(`📋 Checking CORS policy for bucket: ${bucketName}`);
        
        const corsCommand = new GetBucketCorsCommand({ Bucket: bucketName });
        const corsResponse = await s3Client.send(corsCommand);
        
        console.log('✅ CORS policy found:');
        console.log(JSON.stringify(corsResponse.CORSRules, null, 2));
        
        // Validate CORS for file uploads
        const hasRequiredMethods = corsResponse.CORSRules.some(rule => {
            const methods = rule.AllowedMethods || [];
            return methods.includes('PUT') && methods.includes('POST');
        });
        
        const hasRequiredOrigins = corsResponse.CORSRules.some(rule => {
            const origins = rule.AllowedOrigins || [];
            return origins.some(origin => 
                origin === '*' || 
                origin.includes('localhost') || 
                origin.includes('sthopwood.com')
            );
        });
        
        console.log('\n📊 CORS Validation:');
        console.log(`✅ Required Methods (PUT/POST): ${hasRequiredMethods ? 'YES' : 'NO'}`);
        console.log(`✅ Required Origins (Your domains): ${hasRequiredOrigins ? 'YES' : 'NO'}`);
        
        if (hasRequiredMethods && hasRequiredOrigins) {
            console.log('\n🎉 CORS is properly configured for file uploads!');
        } else {
            console.log('\n⚠️  CORS needs to be updated for file uploads!');
            console.log('Run: node fix-cors-policy.js to apply correct CORS policy');
        }
        
    } catch (error) {
        if (error.name === 'NoSuchCORSConfiguration') {
            console.log('❌ No CORS policy found on bucket!');
            console.log('\n🔧 CORS is required for browser file uploads.');
            console.log('Run: node fix-cors-policy.js to add CORS policy');
        } else {
            console.log('❌ Error checking CORS:', error.message);
        }
    }
}

// Run the CORS check
checkBucketCors().catch(console.error);