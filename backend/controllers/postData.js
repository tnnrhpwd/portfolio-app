// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
const bcrypt = require('bcryptjs')  // used to hash passwords
require('dotenv').config();
const { generateToken } = require('../utils/generateToken')
const { trackStorageUsage } = require('../utils/storageTracker')
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { checkIP } = require('../utils/accessData.js');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);
const storage = multer.memoryStorage();// Set up multer for memory storage
const upload = multer({ storage: storage });


// @desc    post data
// @route   POST /api/data
// @access  Private
const postData = asyncHandler(async (req, res) => {
  await checkIP(req);
  if (!req.body) {
    res.status(400);
    throw new Error('Please add a data field. req: ' + JSON.stringify(req.body.data));
  }
  console.log('req.body.data: ', req.body.data);

  let files = [];
  if (req.files && req.files.length > 0) {
      files = req.files.map(file => ({
          filename: file.originalname,
          contentType: file.mimetype,
          data: file.buffer.toString('base64')
      }));
  } else if (req.body.data && req.body.data.Files) {
      // Read from JSON body
      files = req.body.data.Files;
  }

  const itemData = {
      id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
      text: typeof req.body.data === 'string' ? req.body.data : req.body.data.Text,
      ActionGroupObject: req.body.data.ActionGroupObject,
      files: files,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
  };

  // Check storage capacity if user is authenticated
  if (req.user && req.user.id) {
      console.log('postData: Checking storage capacity for authenticated user:', req.user.id);
      try {
          const storageCheck = await trackStorageUsage(req.user.id, itemData);
          if (!storageCheck.success) {
              console.log('postData: Storage limit exceeded:', storageCheck.error);
              res.status(413); // 413 Payload Too Large
              return res.json({ 
                  error: 'Storage limit exceeded', 
                  details: storageCheck.error,
                  currentUsage: storageCheck.currentUsageFormatted,
                  itemSize: storageCheck.itemSizeFormatted,
                  storageLimit: storageCheck.storageLimitFormatted 
              });
          }
          console.log('postData: Storage check passed. Item size:', storageCheck.itemSizeFormatted);
      } catch (storageError) {
          console.error('postData: Storage check failed:', storageError);
          // Continue with creation but log the error
      }
  }

  const params = {
      TableName: 'Simple', 
      Item: itemData
  };

  try {
      await dynamodb.send(new PutCommand(params));
      res.status(200).json(params.Item); // Return the created item
  } catch (error) {
      console.error('Error creating data:', error);
      res.status(500).json({ error: 'Failed to create data' });
  }
})


// @desc    Register new user
// @route   POST /api/data/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
    await checkIP(req);
    const { nickname, email, password } = req.body
  
    if (!nickname || !email || !password) {
      res.status(400)
      throw new Error('Please add all fields')
    }
  
    // Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
  
    // Create user in DynamoDB
    const creationDate = new Date().toISOString();
    const params = {
        TableName: 'Simple',
        Item: {
            id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
            text: `Nickname:${nickname}|Email:${email}|Password:${hashedPassword}|Birth:${creationDate}|stripeid:`,
            createdAt: creationDate,
            updatedAt: creationDate
        }
    };
  
    try {
        await dynamodb.send(new PutCommand(params));
        res.status(201).json({
            _id: params.Item.id,
            nickname,
            email,
            createdAt: creationDate, // Include the birth date
            token: generateToken(String(params.Item.id)),   //uses JWT secret
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
})

// @desc    Authenticate a user
// @route   POST /api/data/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    console.log('=== LOGIN REQUEST ===');
    console.log('Request origin:', req.get('origin'));
    console.log('Request referer:', req.get('referer'));
    console.log('User agent:', req.get('user-agent'));
    console.log('Request body keys:', Object.keys(req.body));
    
    await checkIP(req);
    const { email, password } = req.body;

    if (!email || !password) {
        console.log('Missing email or password in request');
        res.status(400);
        throw new Error(!email ? 'Email is required' : 'Password is required');
    }

    console.log('Attempting login for email:', email);

    // Query DynamoDB for the user with the given email
    const params = {
        TableName: 'Simple',
        FilterExpression: 'contains(#text, :emailValue)',
        ExpressionAttributeNames: {
            '#text': 'text'
        },
        ExpressionAttributeValues: {
            ':emailValue': `Email:${email}`
        }
    };

    try {
        console.log('Querying DynamoDB for user...');
        const result = await dynamodb.send(new ScanCommand(params));
        console.log('DynamoDB query result:', {
            itemCount: result.Items?.length || 0,
            hasItems: !!result.Items && result.Items.length > 0
        });

        if (!result.Items || result.Items.length === 0) {
            console.log('No user found with email:', email);
            res.status(400);
            throw new Error("Could not find that user.");
        }

        if (result.Items.length > 1) {
            console.warn('Multiple users found with same email:', email);
            res.status(400);
            throw new Error("Multiple accounts found. Please contact support.");
        }

        const user = result.Items[0];
        console.log('User found in database, verifying password...');
        
        // Extract password, nickname, birth, and stripe from the stored data
        const userText = user.text;
        const userStripe = userText.substring(userText.indexOf('|stripeid:') + 10);
        
        // Handle both old format (without Birth) and new format (with Birth)
        let userPassword, userBirth;
        if (userText.includes('|Birth:')) {
            // New format: Nickname:xxx|Email:xxx|Password:xxx|Birth:xxx|stripeid:xxx
            userPassword = userText.substring(userText.indexOf('|Password:') + 10, userText.indexOf('|Birth:'));
            userBirth = userText.substring(userText.indexOf('|Birth:') + 7, userText.indexOf('|stripeid:'));
        } else {
            // Old format: Nickname:xxx|Email:xxx|Password:xxx|stripeid:xxx
            userPassword = userText.substring(userText.indexOf('|Password:') + 10, userText.indexOf('|stripeid:'));
            userBirth = null; // No birth date for old users
        }
        
        const userNickname = userText.substring(userText.indexOf('Nickname:') + 9, userText.indexOf('|Email:'));

        // Check if the password matches
        console.log('Comparing password...');
        const passwordMatch = await bcrypt.compare(password, userPassword);
        console.log('Password match result:', passwordMatch);

        if (passwordMatch) {
            console.log('Login successful for user:', userNickname);
            
            const responseData = {
                _id: user.id,
                email: email,
                nickname: userNickname,
                stripe: userStripe,
                token: generateToken(String(user.id)),
            };
            
            // Include birth date if available
            if (userBirth) {
                responseData.createdAt = userBirth;
            }
            
            console.log('Sending login response with keys:', Object.keys(responseData));
            res.status(200).json(responseData);
        } else {
            console.log('Password verification failed for user:', email);
            res.status(400);
            throw new Error('Invalid password.');
        }
    } catch (error) {
        console.error('=== LOGIN ERROR ===');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        if (error.message.includes('Could not find that user') || 
            error.message.includes('Invalid password') ||
            error.message.includes('Email is required') ||
            error.message.includes('Password is required') ||
            error.message.includes('Multiple accounts found')) {
            // These are expected errors, re-throw them
            throw error;
        } else {
            // Unexpected errors
            console.error('Unexpected login error:', error);
            res.status(500);
            throw new Error('Server error during login.');
        }
    }
});

module.exports = { postData, loginUser, registerUser };