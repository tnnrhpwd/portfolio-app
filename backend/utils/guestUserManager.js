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
    console.log('🔍 Looking for existing guest user...');
    const existingUser = await findGuestUser();
    
    if (!existingUser) {
        console.log('ℹ️  No guest user found to delete.');
        return;
    }

    const deleteParams = {
        TableName: 'Simple',
        Key: {
            'id': { S: existingUser.id.S }
        }
    };

    await dynamodb.send(new DeleteItemCommand(deleteParams));
    console.log('🗑️  Guest user deleted successfully.');
};

const createGuestUser = async () => {
    console.log('🔍 Checking for existing guest user...');
    const existingUser = await findGuestUser();
    
    if (existingUser) {
        console.log('ℹ️  Guest user already exists:');
        console.log('   ID:', existingUser.id.S);
        console.log('   Email: guest@gmail.com');
        console.log('   Password: guest');
        console.log('   Status: Ready for login!');
        return;
    }

    console.log('🆕 Creating new guest user...');
    
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
    
    console.log('✅ Guest user created successfully!');
    console.log('   ID:', userId);
    console.log('   Email: guest@gmail.com');
    console.log('   Password: guest');
    console.log('   Nickname: Guest User');
    console.log('   Status: Ready for debugging!');
};

const resetGuestUser = async () => {
    await deleteGuestUser();
    await createGuestUser();
};

const checkGuestUser = async () => {
    console.log('🔍 Checking guest user status...');
    const existingUser = await findGuestUser();
    
    if (existingUser) {
        console.log('✅ Guest user found and ready!');
        console.log('   ID:', existingUser.id.S);
        console.log('   Email: guest@gmail.com');
        console.log('   Password: guest');
        console.log('   Created:', existingUser.createdAt?.S || 'Unknown');
    } else {
        console.log('❌ No guest user found.');
        console.log('   Run: node utils/guestUserManager.js create');
    }
};

const showHelp = () => {
    console.log(`
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
                    console.log(`❌ Unknown command: ${command}`);
                    showHelp();
                    process.exit(1);
                }
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}
