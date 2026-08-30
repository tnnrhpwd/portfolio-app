const axios = require('axios');

async function testUsage() {
    try {
        // You'll need to replace this with your actual JWT token
        const token = 'YOUR_JWT_TOKEN_HERE'; // Replace with actual token
        
        const response = await axios.get('http://localhost:5001/api/data/usage', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Usage API Response:');
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error calling usage API:');
        console.error('Status:', error.response?.status);
        console.error('Error data:', error.response?.data);
        console.error('Error message:', error.message);
    }
}

testUsage();
