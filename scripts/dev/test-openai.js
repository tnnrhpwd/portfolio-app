// Test OpenAI API Key
const { OpenAI } = require('openai');
require('dotenv').config();

async function testOpenAIKey() {
    try {
        console.log('Testing OpenAI API key...');
        
        const client = new OpenAI({
            apiKey: process.env.OPENAI_KEY
        });
        
        // Simple test request
        const response = await client.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hello, this is a test.' }],
            max_tokens: 10
        });
        
        console.log('✅ OpenAI API key is working!');
        console.log('Response:', response.choices[0].message.content);
        
    } catch (error) {
        console.error('❌ OpenAI API key test failed:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        if (error.code === 'insufficient_quota') {
            console.error('💡 Your OpenAI account has insufficient quota/billing');
        } else if (error.code === 'invalid_api_key') {
            console.error('💡 Your OpenAI API key is invalid');
        }
    }
}

testOpenAIKey();