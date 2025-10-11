/**
 * OCR Test Script
 * Simple test to verify OCR functionality is working
 */

const fs = require('fs');
const path = require('path');

// Test image in base64 format (simple text image)
const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function testOCR() {
    console.log('🧪 Testing OCR Backend Integration...\n');
    
    try {
        // Import the OCR functions (adjust path as needed)
        const ocrController = require('./controllers/ocrController');
        
        // Mock request and response objects
        const mockReq = {
            user: { id: 'test-user-id' },
            body: {
                imageData: testImageBase64,
                contentType: 'image/png',
                filename: 'test-image.png',
                method: 'openai-vision',
                model: 'gpt-4o',
                llmProvider: 'openai',
                llmModel: 'o1-mini'
            }
        };
        
        const mockRes = {
            status: (code) => ({ 
                json: (data) => {
                    console.log(`Response Status: ${code}`);
                    console.log('Response Data:', JSON.stringify(data, null, 2));
                    return data;
                }
            })
        };
        
        console.log('Testing OCR extraction with OpenAI Vision...');
        await ocrController.extractOCR(mockReq, mockRes);
        
        console.log('\n✅ OCR test completed!');
        console.log('\nNote: This is a basic integration test.');
        console.log('For full testing, upload a real image through the UI.');
        
    } catch (error) {
        console.error('❌ OCR test failed:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Make sure you have run: node install-ocr-deps.js');
        console.log('2. Check that OPENAI_KEY is set in your .env file');
        console.log('3. Verify the backend server can start without errors');
    }
}

// Only run if called directly
if (require.main === module) {
    testOCR();
}

module.exports = { testOCR };