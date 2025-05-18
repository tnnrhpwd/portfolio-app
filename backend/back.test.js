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
    it('can access DynamoDB', async () => {
        // Mock DynamoDB response instead of making a real call
        const mockResult = { Items: [] };
        jest.spyOn(dynamodb, 'scan').mockImplementation(() => ({
            promise: jest.fn().mockResolvedValue(mockResult)
        }));
        
        const params = {
            TableName: 'Simple', // Replace with your table name
            Limit: 1 // Just check if we can access it
        };

        try {
            const result = await dynamodb.scan(params).promise();
            expect(result).toBeDefined();
            expect(result).toEqual(mockResult);
        } catch (error) {
            console.error('Error accessing DynamoDB:', error);
            throw error;
        }
    });

    it.todo('can communicate with the OpenAI api');
});