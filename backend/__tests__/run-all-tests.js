/**
 * Test Runner - Run all backend tests
 * Usage: node __tests__/run-all-tests.js
 */

const path = require('path');

console.log('🧪 Backend Test Suite Runner\n');
console.log('=' .repeat(60));

async function runAllTests() {
    const tests = [
        {
            name: 'OpenAI API Key Test',
            path: './unit/test-openai.js',
            description: 'Verifies OpenAI API key is valid and working'
        },
        {
            name: 'OCR Integration Test',
            path: './integration/test-ocr.js',
            description: 'Tests OCR functionality with mock data'
        },
        {
            name: 'Referer Tracking Test',
            path: './integration/test-referer-tracking.js',
            description: 'Tests referer categorization and tracking'
        },
        {
            name: 'Referer Fixes Test', 
            path: './integration/test-referer-fixes.js',
            description: 'Tests specific referer tracking fixes'
        },
        {
            name: 'Specific Issues Test',
            path: './integration/test-specific-issues.js',
            description: 'Tests specific reported issues'
        }
    ];

    console.log(`\n📋 Found ${tests.length} test suites to run:\n`);
    
    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        console.log(`${i + 1}. ${test.name}`);
        console.log(`   📄 ${test.description}`);
        console.log(`   📁 ${test.path}\n`);
    }

    console.log('🚀 Starting test execution...\n');
    console.log('=' .repeat(60));

    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        console.log(`\n🔄 Running: ${test.name}`);
        console.log('-' .repeat(40));
        
        try {
            // Import and run the test
            const testModule = require(test.path);
            
            if (typeof testModule === 'function') {
                await testModule();
            } else if (testModule.testOCR) {
                await testModule.testOCR();
            } else if (testModule.runRefererTests) {
                await testModule.runRefererTests();
            } else {
                console.log('⚠️  Test module loaded but no test function found');
            }
            
            console.log(`✅ ${test.name} completed`);
            
        } catch (error) {
            console.error(`❌ ${test.name} failed:`, error.message);
        }
        
        // Add delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '=' .repeat(60));
    console.log('🎉 All tests completed!');
    console.log('\n💡 Individual tests can be run with:');
    tests.forEach(test => {
        console.log(`   node __tests__/${test.path.replace('./', '')}`);
    });
}

// Only run if called directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests };