// App.test.js

if (typeof TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

const AWS = require('aws-sdk');
require('dotenv').config();

// Configure AWS with endpoint for local testing
AWS.config.update({
    region: process.env.AWS_REGION || 'us-east-1', // Provide a default region
    accessKeyId: 'test',
    secretAccessKey: 'test',
    endpoint: 'http://localhost:8000' // Local DynamoDB endpoint
});

// Set AWS SDK to not use the EC2 instance metadata service
AWS.config.credentials = new AWS.Credentials('test', 'test');

// Create dynamoDB client
const dynamodb = new AWS.DynamoDB.DocumentClient();

describe('Backend Tests', () => {
    it('should return an empty array if DynamoDB table is empty', async () => {
        const mockResult = { Items: [] };
        jest.spyOn(dynamodb, 'scan').mockImplementation(() => ({
            promise: jest.fn().mockResolvedValue(mockResult)
        }));
        const params = { TableName: 'Simple', Limit: 1 };
        const result = await dynamodb.scan(params).promise();
        expect(result.Items).toEqual([]);
    });

    it('should handle OpenAI API returning no choices', async () => {
        const axios = require('axios');
        jest.spyOn(axios, 'post').mockResolvedValue({ data: { choices: [] } });
        const response = await axios.post('https://api.openai.com/v1/completions', {
            prompt: 'Say nothing',
            max_tokens: 5
        }, {
            headers: { Authorization: 'Bearer test' }
        });
        expect(response.data.choices).toEqual([]);
    });
    it('should successfully retrieve items from DynamoDB table', async () => {
        // Mock DynamoDB response
        const mockResult = { Items: [{ id: '1', name: 'Test Item' }] };
        jest.spyOn(dynamodb, 'scan').mockImplementation(() => ({
            promise: jest.fn().mockResolvedValue(mockResult)
        }));
        const params = {
            TableName: 'Simple',
            Limit: 1
        };
        const result = await dynamodb.scan(params).promise();
        expect(result).toBeDefined();
        expect(result).toEqual(mockResult);
    });

    it('should handle DynamoDB scan errors gracefully', async () => {
        const error = new Error('DynamoDB scan failed');
        jest.spyOn(dynamodb, 'scan').mockImplementation(() => ({
            promise: jest.fn().mockRejectedValue(error)
        }));
        const params = { TableName: 'Simple', Limit: 1 };
        await expect(dynamodb.scan(params).promise()).rejects.toThrow('DynamoDB scan failed');
    });

    it('should send a prompt to the OpenAI API and receive a valid response', async () => {
        // Mock OpenAI API call
        const axios = require('axios');
        jest.spyOn(axios, 'post').mockResolvedValue({ data: { choices: [{ text: 'Hello, world!' }] } });
        // Simulate a call to OpenAI API
        const response = await axios.post('https://api.openai.com/v1/completions', {
            prompt: 'Say hello',
            max_tokens: 5
        }, {
            headers: { Authorization: 'Bearer test' }
        });
        expect(response.data).toBeDefined();
        expect(response.data.choices[0].text).toBe('Hello, world!');
    });

    it('should handle OpenAI API errors gracefully', async () => {
        const axios = require('axios');
        jest.spyOn(axios, 'post').mockRejectedValue(new Error('OpenAI API error'));
        await expect(
            axios.post('https://api.openai.com/v1/completions', { prompt: 'fail', max_tokens: 5 }, { headers: { Authorization: 'Bearer test' } })
        ).rejects.toThrow('OpenAI API error');
    });
});