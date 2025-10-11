/**
 * Test script for referer tracking functionality
 * This script simulates HTTP requests with different referers to test the tracking
 */

const { checkIP } = require('../../utils/accessData');

// Mock request objects with different referer scenarios
const mockRequests = [
    {
        name: 'Google Search Referer',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.1',
                'referer': 'https://www.google.com/search?q=portfolio+website',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/portfolio',
            user: { id: 'test-user-123' }
        }
    },
    {
        name: 'Facebook Social Media Referer',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.2',
                'referer': 'https://www.facebook.com/posts/12345',
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/about',
            user: { id: 'test-user-456' }
        }
    },
    {
        name: 'Direct Access (No Referer)',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.3',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/home',
            user: { id: 'test-user-789' }
        }
    },
    {
        name: 'Internal Site Navigation',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.4',
                'referer': 'https://yoursite.com/home',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/contact',
            user: { id: 'test-user-101' }
        }
    },
    {
        name: 'GitHub External Link',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.5',
                'referer': 'https://github.com/username/repository',
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/projects',
            user: { id: 'test-user-202' }
        }
    },
    {
        name: 'Malformed Referer URL',
        request: {
            headers: {
                'x-forwarded-for': '203.0.113.6',
                'referer': 'not-a-valid-url',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'host': 'yoursite.com'
            },
            method: 'GET',
            originalUrl: '/blog',
            user: { id: 'test-user-303' }
        }
    }
];

/**
 * Run referer tracking tests
 */
async function runRefererTests() {
    console.log('🧪 Starting Referer Tracking Tests...\n');

    for (let i = 0; i < mockRequests.length; i++) {
        const { name, request } = mockRequests[i];
        
        console.log(`Test ${i + 1}: ${name}`);
        console.log('─'.repeat(50));
        
        try {
            // Note: In development, the function will skip localhost IPs
            // You may want to modify the checkIP function temporarily for testing
            // or use actual external IPs
            
            await checkIP(request);
            console.log('✅ Test completed successfully');
            
        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
        
        console.log(''); // Empty line for readability
        
        // Add a small delay between tests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('🎉 All referer tracking tests completed!');
}

/**
 * Display expected data format
 */
function showExpectedDataFormat() {
    console.log('📋 Expected Referer Data Format in Database:');
    console.log('─'.repeat(60));
    console.log('|Referer:https://www.google.com/search?q=test');
    console.log('|RefererHost:www.google.com');
    console.log('|RefererPath:/search');
    console.log('|RefererQuery:?q=test');
    console.log('|RefererCategory:search_google');
    console.log('');
    console.log('Categories include:');
    console.log('• direct - No referer (direct access)');
    console.log('• internal - Same domain navigation');
    console.log('• search_google - Google search results');
    console.log('• search_bing - Bing search results');
    console.log('• social_facebook - Facebook referral');
    console.log('• social_twitter - Twitter referral');
    console.log('• social_linkedin - LinkedIn referral');
    console.log('• development_github - GitHub referral');
    console.log('• external - Other external sites');
    console.log('• malformed - Invalid referer URL');
    console.log('');
}

// Show expected format first
showExpectedDataFormat();

// Run the tests if this file is executed directly
if (require.main === module) {
    console.log('⚠️  Note: These tests use external IPs that will be recorded in your database.');
    console.log('💡 Tip: Consider running this against a test database or temporarily modify');
    console.log('   the checkIP function to accept localhost IPs for testing.\n');
    
    runRefererTests().catch(console.error);
}

module.exports = {
    runRefererTests,
    mockRequests,
    showExpectedDataFormat
};
