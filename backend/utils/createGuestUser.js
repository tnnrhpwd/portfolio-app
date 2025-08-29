// Utility script to create a guest user for development/debugging
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { DynamoDBClient, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { randomUUID } = require('crypto');

// DynamoDB client configuration
const dynamodb = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const createGuestUser = async () => {
    try {
        console.log('Checking if guest user already exists...');
        
        // Check if guest user already exists
        const checkParams = {
            TableName: 'Simple',
            FilterExpression: 'contains(#text, :emailValue)',
            ExpressionAttributeNames: {
                '#text': 'text'
            },
            ExpressionAttributeValues: {
                ':emailValue': { S: 'Email:guest@gmail.com' }
            }
        };

        const existingUser = await dynamodb.send(new ScanCommand(checkParams));
        
        if (existingUser.Items && existingUser.Items.length > 0) {
            console.log('Guest user already exists!');
            console.log('Guest user data:', existingUser.Items[0].text.S);
            return;
        }

        console.log('Creating new guest user...');
        
        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('guest', salt);
        
        // Generate unique ID
        const userId = randomUUID();
        
        // Create current timestamp
        const currentTime = new Date().toISOString();
        
        // Create user text in the expected format
        // Format: Nickname:xxx|Email:xxx|Password:xxx|Birth:xxx|stripeid:xxx
        const userText = `Nickname:Guest User|Email:guest@gmail.com|Password:${hashedPassword}|Birth:${currentTime}|stripeid:guest_customer_id`;
        
        // Create the user item
        const putParams = {
            TableName: 'Simple',
            Item: {
                'id': { S: userId },
                'text': { S: userText },
                'createdAt': { S: currentTime },
                'updatedAt': { S: currentTime }
            }
        };

        await dynamodb.send(new PutItemCommand(putParams));
        
        console.log('✅ Guest user created successfully!');
        console.log('User ID:', userId);
        console.log('Email: guest@gmail.com');
        console.log('Password: guest');
        console.log('Nickname: Guest User');
        
    } catch (error) {
        console.error('❌ Error creating guest user:', error);
        throw error;
    }
};

// Run the script
if (require.main === module) {
    createGuestUser()
        .then(() => {
            console.log('Guest user setup completed.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Failed to setup guest user:', error);
            process.exit(1);
        });
}

module.exports = { createGuestUser };
