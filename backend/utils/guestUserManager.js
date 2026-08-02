#!/usr/bin/env node
// Development script to manage guest user for debugging
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { randomUUID } = require('crypto');

// DynamoDB client configuration
const dynamodb = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const args = process.argv.slice(2);
const command = args[0];

const findGuestUser = async () => {
const { logger } = require('./logger');
    const params = {
        TableName: 'Simple',
        FilterExpression: 'contains(#text, :emailValue)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':emailValue': { S: 'Email:guest@gmail.com' } }
    };
    
    const result = await dynamodb.send(new ScanCommand(params));
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
};

const deleteGuestUser = async () => {
    logger.debug('🔍 Looking for existing guest user...');
    const existingUser = await findGuestUser();
    
    if (!existingUser) {
        logger.debug('ℹ️  No guest user found to delete.');
        return;
    }

    const deleteParams = {
        TableName: 'Simple',
        Key: {
            'id': { S: existingUser.id.S }
        }
    };

    await dynamodb.send(new DeleteItemCommand(deleteParams));
    logger.debug('🗑️  Guest user deleted successfully.');
};

const createGuestUser = async () => {
    logger.debug('🔍 Checking for existing guest user...');
    const existingUser = await findGuestUser();
    
    if (existingUser) {
        logger.debug('ℹ️  Guest user already exists:');
        logger.debug('   ID:', existingUser.id.S);
        logger.debug('   Email: guest@gmail.com');
        logger.debug('   Password: guest');
        logger.debug('   Status: Ready for login!');
        return;
    }

    logger.debug('🆕 Creating new guest user...');
    
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('guest', salt);
    
    // Generate unique ID
    const userId = randomUUID();
    const currentTime = new Date().toISOString();
    
    // Create user text in the expected format
    const userText = `Nickname:Guest User|Email:guest@gmail.com|Password:${hashedPassword}|Birth:${currentTime}|stripeid:guest_customer_id`;
    
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
    
    logger.debug('✅ Guest user created successfully!');
    logger.debug('   ID:', userId);
    logger.debug('   Email: guest@gmail.com');
    logger.debug('   Password: guest');
    logger.debug('   Nickname: Guest User');
    logger.debug('   Status: Ready for debugging!');
};

const resetGuestUser = async () => {
    await deleteGuestUser();
    await createGuestUser();
};

const checkGuestUser = async () => {
    logger.debug('🔍 Checking guest user status...');
    const existingUser = await findGuestUser();
    
    if (existingUser) {
        logger.debug('✅ Guest user found and ready!');
        logger.debug('   ID:', existingUser.id.S);
        logger.debug('   Email: guest@gmail.com');
        logger.debug('   Password: guest');
        logger.debug('   Created:', existingUser.createdAt?.S || 'Unknown');
    } else {
        logger.debug('❌ No guest user found.');
        logger.debug('   Run: node utils/guestUserManager.js create');
    }
};

const showHelp = () => {
    logger.debug(`
🛠️  Guest User Manager - Development Tool

Usage: node utils/guestUserManager.js <command>

Commands:
  check    - Check if guest user exists and show details
  create   - Create guest user (if doesn't exist)
  delete   - Remove guest user from database  
  reset    - Delete and recreate guest user
  help     - Show this help message

Example:
  node utils/guestUserManager.js check
  node utils/guestUserManager.js create
  node utils/guestUserManager.js reset

The guest user credentials are:
  Email: guest@gmail.com
  Password: guest
    `);
};

// Main execution
const main = async () => {
    try {
        switch (command) {
            case 'check':
                await checkGuestUser();
                break;
            case 'create':
                await createGuestUser();
                break;
            case 'delete':
                await deleteGuestUser();
                break;
            case 'reset':
                await resetGuestUser();
                break;
            case 'help':
            case '--help':
            case '-h':
                showHelp();
                break;
            default:
                if (!command) {
                    await checkGuestUser(); // Default action
                } else {
                    logger.debug(`❌ Unknown command: ${command}`);
                    showHelp();
                    process.exit(1);
                }
        }
    } catch (error) {
        logger.error('❌ Error:', error.message);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}
