// Test OpenAI API Key
const { OpenAI } = require('openai');
require('dotenv').config();

async function testOpenAIKey() {
    try {
        console.log('Testing OpenAI API key...');
        console.log('Key starts with:', process.env.OPENAI_KEY ? process.env.OPENAI_KEY.substring(0, 15) + '...' : 'Not found');
        
        if (!process.env.OPENAI_KEY) {
            console.error('❌ No OPENAI_KEY found in environment variables');
            return;
        }
        
        if (process.env.OPENAI_KEY.length < 40) {
            console.error('❌ OpenAI API key appears to be too short (length:', process.env.OPENAI_KEY.length, ')');
            console.error('   OpenAI keys should be around 51+ characters long');
            return;
        }
        
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
            console.error('   Visit https://platform.openai.com/account/billing to add credits');
        } else if (error.code === 'invalid_api_key') {
            console.error('💡 Your OpenAI API key is invalid or incomplete');
            console.error('   Visit https://platform.openai.com/api-keys to get a new key');
        } else if (error.code === 'unauthorized') {
            console.error('💡 API key is unauthorized - check your OpenAI account status');
        }
    }
}

testOpenAIKey();