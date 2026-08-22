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
const { logger } = require('../utils/logger');
const { GUEST_EMAIL, GUEST_PASSWORD, GUEST_NICKNAME } = require('../constants/guestAccount.js');

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
  logger.debug('req.body.data: ', req.body.data);

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
      logger.debug('postData: Checking storage capacity for authenticated user:', req.user.id);
      try {
          const storageCheck = await trackStorageUsage(req.user.id, itemData);
          if (!storageCheck.success) {
              logger.debug('postData: Storage limit exceeded:', storageCheck.error);
              res.status(413); // 413 Payload Too Large
              return res.json({ 
                  error: 'Storage limit exceeded', 
                  details: storageCheck.error,
                  currentUsage: storageCheck.currentUsageFormatted,
                  itemSize: storageCheck.itemSizeFormatted,
                  storageLimit: storageCheck.storageLimitFormatted 
              });
          }
          logger.debug('postData: Storage check passed. Item size:', storageCheck.itemSizeFormatted);
      } catch (storageError) {
          logger.error('postData: Storage check failed:', storageError);
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
      logger.error('Error creating data:', error);
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

    // Guard against duplicate accounts: scan for any existing user whose
    // Email or Nickname field matches (case-insensitively) before creating a
    // new record. Without this, nothing stopped the same person (or a typo'd
    // resubmit) from registering twice, leaving two DynamoDB rows for one
    // email — which broke login outright (loginUser explicitly 400s with
    // "Multiple accounts found" the moment a Scan returns >1 match) and
    // required a manual DB consolidation to fix.
    // The `contains` filter is a cheap pre-filter (same pattern used by
    // loginUser/forgotPassword/resetPassword); the exact-match check below
    // guards against a false-positive substring match.
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedNickname = nickname.trim().toLowerCase();

    const dupeCheckParams = {
        TableName: 'Simple',
        FilterExpression: 'contains(#text, :emailValue) OR contains(#text, :nicknameValue)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: {
            ':emailValue': `Email:${email}`,
            ':nicknameValue': `Nickname:${nickname}|`
        }
    };

    try {
        const dupeResult = await dynamodb.send(new ScanCommand(dupeCheckParams));
        const existing = (dupeResult.Items || []).find((item) => {
            const text = item.text || '';
            const existingEmail = text.substring(text.indexOf('Email:') + 6, text.indexOf('|Password:')).trim().toLowerCase();
            const existingNickname = text.substring(text.indexOf('Nickname:') + 9, text.indexOf('|Email:')).trim().toLowerCase();
            return existingEmail === normalizedEmail || existingNickname === normalizedNickname;
        });

        if (existing) {
            res.status(409);
            throw new Error('An account with that email or nickname already exists.');
        }
    } catch (error) {
        if (error.message.includes('already exists')) {
            throw error;
        }
        logger.error('Error checking for duplicate user during registration:', error);
        res.status(500);
        throw new Error('Server error while checking for existing account.');
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
        logger.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
})

/**
 * (Re)provision the public "Login as Guest" demo account in DynamoDB with the
 * canonical GUEST_EMAIL/GUEST_PASSWORD credentials.
 *
 * The guest login button ships hardcoded credentials, but the underlying
 * DynamoDB record can drift out of sync with them (deleted, never created in
 * an environment, or overwritten with a different password hash by manual
 * DB tooling) — when that happens every guest login attempt fails with a
 * "user not found" or "invalid password" error that no end user can recover
 * from. Self-healing here means guest login always works regardless of the
 * record's current state.
 * @returns {Promise<{id: string, text: string}>} The (re)created guest item.
 */
async function provisionGuestUser() {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(GUEST_PASSWORD, salt);
    const creationDate = new Date().toISOString();

    const item = {
        id: require('crypto').randomBytes(16).toString('hex'),
        text: `Nickname:${GUEST_NICKNAME}|Email:${GUEST_EMAIL}|Password:${hashedPassword}|Birth:${creationDate}|stripeid:guest_customer_id`,
        createdAt: creationDate,
        updatedAt: creationDate,
    };

    await dynamodb.send(new PutCommand({ TableName: 'Simple', Item: item }));
    logger.warn('provisionGuestUser: guest account was missing — auto-created it');
    return item;
}

/**
 * Reset an existing guest account's stored password hash back to
 * GUEST_PASSWORD. Used when the record exists but its password field no
 * longer matches the canonical guest credentials (see provisionGuestUser).
 * @param {{id: string, text: string}} user - Existing guest DynamoDB item.
 * @returns {Promise<void>}
 */
async function resetGuestUserPassword(user) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(GUEST_PASSWORD, salt);

    const updatedText = user.text.includes('|Password:')
        ? user.text.replace(/\|Password:[^|]*/, `|Password:${hashedPassword}`)
        : `${user.text}|Password:${hashedPassword}`;

    await dynamodb.send(new PutCommand({
        TableName: 'Simple',
        Item: { ...user, text: updatedText, updatedAt: new Date().toISOString() },
    }));
    logger.warn('resetGuestUserPassword: guest account password was out of sync — reset it');
}

// @desc    Authenticate a user
// @route   POST /api/data/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    logger.debug('=== LOGIN REQUEST ===');
    logger.debug('Request origin:', req.get('origin'));
    logger.debug('Request referer:', req.get('referer'));
    logger.debug('User agent:', req.get('user-agent'));
    logger.debug('Request body keys:', Object.keys(req.body));
    
    await checkIP(req);
    const { email, password } = req.body;

    if (!email || !password) {
        logger.debug('Missing email or password in request');
        res.status(400);
        throw new Error(!email ? 'Email is required' : 'Password is required');
    }

    logger.debug('Attempting login for email:', email);

    // The "Login as Guest" button submits fixed, publicly-known credentials.
    // If those exact credentials are what's being submitted, the DB record
    // backing them is allowed to self-heal below (auto-create/reset) instead
    // of ever surfacing an error for something no end user can fix.
    const isGuestLoginAttempt = email.toLowerCase() === GUEST_EMAIL && password === GUEST_PASSWORD;

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
        logger.debug('Querying DynamoDB for user...');
        const result = await dynamodb.send(new ScanCommand(params));
        logger.debug('DynamoDB query result:', {
            itemCount: result.Items?.length || 0,
            hasItems: !!result.Items && result.Items.length > 0
        });

        if (!result.Items || result.Items.length === 0) {
            if (isGuestLoginAttempt) {
                logger.debug('Guest account missing — auto-provisioning it');
                const guestUser = await provisionGuestUser();
                return res.status(200).json({
                    _id: guestUser.id,
                    email: GUEST_EMAIL,
                    nickname: GUEST_NICKNAME,
                    stripe: 'guest_customer_id',
                    createdAt: guestUser.createdAt,
                    token: generateToken(String(guestUser.id)),
                });
            }
            logger.debug('No user found with email:', email);
            res.status(400);
            throw new Error("Could not find that user.");
        }

        if (result.Items.length > 1) {
            logger.warn('Multiple users found with same email:', email);
            res.status(400);
            throw new Error("Multiple accounts found. Please contact support.");
        }

        const user = result.Items[0];
        logger.debug('User found in database, verifying password...');
        
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
        logger.debug('Comparing password...');
        let passwordMatch = await bcrypt.compare(password, userPassword);
        logger.debug('Password match result:', passwordMatch);

        if (!passwordMatch && isGuestLoginAttempt) {
            logger.debug('Guest account password out of sync — resetting it to the canonical guest password');
            await resetGuestUserPassword(user);
            passwordMatch = true;
        }

        if (passwordMatch) {
            logger.debug('Login successful for user:', userNickname);
            
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
            
            logger.debug('Sending login response with keys:', Object.keys(responseData));
            res.status(200).json(responseData);
        } else {
            logger.debug('Password verification failed for user:', email);
            res.status(400);
            throw new Error('Invalid password.');
        }
    } catch (error) {
        logger.error('=== LOGIN ERROR ===');
        logger.error('Error name:', error.name);
        logger.error('Error message:', error.message);
        logger.error('Error stack:', error.stack);
        
        if (error.message.includes('Could not find that user') || 
            error.message.includes('Invalid password') ||
            error.message.includes('Email is required') ||
            error.message.includes('Password is required') ||
            error.message.includes('Multiple accounts found')) {
            // These are expected errors, re-throw them
            throw error;
        } else {
            // Unexpected errors
            logger.error('Unexpected login error:', error);
            res.status(500);
            throw new Error('Server error during login.');
        }
    }
});

module.exports = { postData, loginUser, registerUser };