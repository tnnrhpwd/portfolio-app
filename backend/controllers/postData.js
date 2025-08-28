// This file contains the functions that deal with the Data objects( schema imported from Models)  => Exported to Routes(listens + calls these methods on requests)
const bcrypt = require('bcryptjs')  // used to hash passwords
require('dotenv').config();
const { generateToken } = require('../utils/generateToken')
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

  const params = {
      TableName: 'Simple', 
      Item: {
          id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
          text: typeof req.body.data === 'string' ? req.body.data : req.body.data.Text,
          ActionGroupObject: req.body.data.ActionGroupObject,
          files: files,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      }
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
    const params = {
        TableName: 'Simple',
        Item: {
            id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
            text: `Nickname:${nickname}|Email:${email}|Password:${hashedPassword}|stripeid:`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };
  
    try {
        await dynamodb.send(new PutCommand(params));
        res.status(201).json({
            _id: params.Item.id,
            nickname,
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
    await checkIP(req);
    const { email, password } = req.body;

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
        const result = await dynamodb.send(new ScanCommand(params));
        if (result.Items.length !== 1) {
            res.status(400);
            throw new Error("Could not find that user.");
        }

        const user = result.Items[0];
        // Extract password, nickname, and stripe from the stored data
        const userText = user.text;
        const userStripe = userText.substring(userText.indexOf('|stripeid:') + 10);
        const userPassword = userText.substring(userText.indexOf('|Password:') + 10, userText.indexOf('|stripeid:'));
        const userNickname = userText.substring(userText.indexOf('Nickname:') + 9, userText.indexOf('|Email:'));

        // Check if the password matches
        if (await bcrypt.compare(password, userPassword)) {
            res.json({
                _id: user.id,
                email: email,
                nickname: userNickname,
                stripe: userStripe,
                token: generateToken(String(user.id)),
            });
        } else {
            res.status(400);
            throw new Error('Invalid password.');
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500);
        throw new Error('Server error during login.');
    }
});

module.exports = { postData, loginUser, registerUser };