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
    console.log('1. Set up Azure Computer Vision credentials (optional):');
    console.log('   - Set AZURE_COMPUTER_VISION_KEY environment variable');
    console.log('   - Set AZURE_COMPUTER_VISION_ENDPOINT environment variable');
    console.log('');
    console.log('2. Tesseract (local) is now the default production method');
    console.log('   - No API key required — runs fully on AWS');
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