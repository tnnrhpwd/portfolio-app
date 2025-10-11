#!/usr/bin/env node

/**
 * Install OCR dependencies script
 * Run this to install the required packages for production OCR functionality
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Installing OCR dependencies for production...\n');

const dependencies = [
    'tesseract.js@^5.1.0',              // Local OCR fallback
    '@google-cloud/vision@^4.0.0',      // Google Vision API
    '@azure/cognitiveservices-computervision@^8.2.0', // Azure Computer Vision
    '@azure/ms-rest-js@^2.7.0',         // Azure auth
    '@aws-sdk/client-textract@^3.0.0'   // AWS Textract (for future use)
];

try {
    console.log('Installing packages:');
    dependencies.forEach(dep => console.log(`  - ${dep}`));
    console.log('');

    // Install dependencies
    const installCommand = `npm install ${dependencies.join(' ')}`;
    console.log('Running:', installCommand);
    
    execSync(installCommand, { 
        stdio: 'inherit',
        cwd: __dirname 
    });

    console.log('\n✅ OCR dependencies installed successfully!\n');
    
    console.log('📋 Next steps:');
    console.log('1. Set up Google Cloud Vision API credentials (optional):');
    console.log('   - Create a service account key file');
    console.log('   - Set GOOGLE_CLOUD_KEY_FILE environment variable');
    console.log('');
    console.log('2. Set up Azure Computer Vision credentials (optional):');
    console.log('   - Set AZURE_COMPUTER_VISION_KEY environment variable');
    console.log('   - Set AZURE_COMPUTER_VISION_ENDPOINT environment variable');
    console.log('');
    console.log('3. OpenAI Vision is now the default production method');
    console.log('   - Uses your existing OPENAI_KEY');
    console.log('   - Falls back to Tesseract if OpenAI fails');
    console.log('');
    console.log('🚀 Your OCR backend is now production-ready!');

} catch (error) {
    console.error('\n❌ Error installing OCR dependencies:');
    console.error(error.message);
    
    console.log('\n💡 Manual installation:');
    console.log('You can install these packages manually:');
    dependencies.forEach(dep => {
        console.log(`npm install ${dep}`);
    });
}