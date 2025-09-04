const { checkIP } = require('./utils/accessData');

console.log('🔍 Testing Specific Reported Issues\n');

// Mock a real-world scenario based on your reported issue
async function testSpecificIssues() {
    console.log('============================================================\n');
    
    // Test 1: The exact issue you reported - sthopwood.com marked as external
    console.log('Test 1: Your Reported Issue - sthopwood.com navigation');
    console.log('----------------------------------------');
    
    // Mock the scenario where someone navigates within your site
    const mockReq1 = {
        ip: '127.0.0.1',
        method: 'GET',
        url: '/portfolio',
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'referer': 'https://sthopwood.com/',
            'host': 'sthopwood.com'
        },
        body: {},
        get: function(header) {
            return this.headers[header.toLowerCase()];
        }
    };
    
    const mockRes1 = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const entry = data.message;
            const parts = entry.split('|');
            const refererData = parts[4]; // Referer data is at index 4
            
            console.log(`Entry: ${entry}`);
            console.log(`Referer data: ${refererData}`);
            
            if (refererData.includes('category:internal')) {
                console.log('✅ FIXED: sthopwood.com is now correctly categorized as internal');
            } else {
                console.log('❌ ISSUE: sthopwood.com is still being categorized incorrectly');
            }
            console.log('');
        }
    };
    
    await checkIP(mockReq1, mockRes1, () => {});
    
    // Test 2: Instagram app scenario
    console.log('Test 2: Instagram App Navigation (no referer)');
    console.log('----------------------------------------');
    
    const mockReq2 = {
        ip: '127.0.0.1',
        method: 'GET',
        url: '/portfolio',
        headers: {
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 234.0.0.16.109 (iPhone12,1; iOS 14_6; en_US; en-US; scale=2.00; 1170x2532; 356446648)',
            'host': 'sthopwood.com'
            // No referer header - typical for Instagram app
        },
        body: {},
        get: function(header) {
            return this.headers[header.toLowerCase()];
        }
    };
    
    const mockRes2 = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const entry = data.message;
            const parts = entry.split('|');
            const refererData = parts[4];
            
            console.log(`Entry: ${entry}`);
            console.log(`Referer data: ${refererData}`);
            
            if (refererData.includes('category:social_instagram')) {
                console.log('✅ FIXED: Instagram app is now correctly detected');
            } else {
                console.log('❌ ISSUE: Instagram app is not being detected');
            }
            console.log('');
        }
    };
    
    await checkIP(mockReq2, mockRes2, () => {});
    
    // Test 3: Instagram link redirect
    console.log('Test 3: Instagram Link Redirect');
    console.log('----------------------------------------');
    
    const mockReq3 = {
        ip: '127.0.0.1',
        method: 'GET',
        url: '/portfolio',
        headers: {
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15',
            'referer': 'https://l.instagram.com/?u=https://sthopwood.com',
            'host': 'sthopwood.com'
        },
        body: {},
        get: function(header) {
            return this.headers[header.toLowerCase()];
        }
    };
    
    const mockRes3 = {
        status: () => ({ json: () => {} }),
        json: (data) => {
            const entry = data.message;
            const parts = entry.split('|');
            const refererData = parts[4];
            
            console.log(`Entry: ${entry}`);
            console.log(`Referer data: ${refererData}`);
            
            if (refererData.includes('category:social_instagram')) {
                console.log('✅ FIXED: Instagram redirect is now correctly detected');
            } else {
                console.log('❌ ISSUE: Instagram redirect is not being detected');
            }
            console.log('');
        }
    };
    
    await checkIP(mockReq3, mockRes3, () => {});
    
    console.log('============================================================');
    console.log('🎯 Test Summary: All specific reported issues should now be resolved');
}

testSpecificIssues().catch(console.error);
