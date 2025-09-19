// compressData.js

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { sendEmail } = require('../utils/emailService.js');
const { trackApiUsage, canMakeApiCall } = require('../utils/apiUsageTracker.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const Data = require('../models/dataModel'); // Add Data model import
require('dotenv').config();
const openaikey = process.env.OPENAI_KEY;
let client; // Define client outside the asyncHandler

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS DynamoDB Client
const awsClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(awsClient);

async function initializeOpenAI() {
    try {
        const openai = await import('openai');
        client = new openai.OpenAI({ apiKey: openaikey });
        console.log('OpenAI initialized successfully');
    } catch (error) {
        console.error('Error initializing OpenAI:', error);
        throw error;
    }
}

// @desc    Set data
// @route   POST /api/data
// @access  Private
const postHashData = asyncHandler(async (req, res) => {
    console.log('postHashData called');
    console.log('req.body keys:', Object.keys(req.body));
    console.log('req.body.data:', req.body.data);
    console.log('req.files length:', req.files ? req.files.length : 0);
    
    await checkIP(req);

    if (!req.user) {
      res.status(401);
      throw new Error('User not found');
    }

    if (Object.keys(req.body).length === 0 && (!req.files || req.files.length === 0)) {
        res.status(400);
        throw new Error('Request body and files are missing');
    }

    let textContent;
    let actionGroupObjectContent;
    let filesData = []; // For the DynamoDB 'files' attribute

    // Handle file uploads via multer first
    if (req.files && req.files.length > 0) {
        console.log('Processing files:', req.files.length);
        
        // Validate file sizes before processing
        const maxFileSize = 300 * 1024; // 300KB per file
        const maxTotalSize = 350 * 1024; // 350KB total
        
        const oversizedFiles = req.files.filter(file => file.size > maxFileSize);
        if (oversizedFiles.length > 0) {
            const fileNames = oversizedFiles.map(f => f.originalname).join(', ');
            console.log('Files rejected - too large:', fileNames);
            res.status(413);
            throw new Error(`Files too large: ${fileNames}. Maximum size is 300KB per file.`);
        }
        
        const totalFileSize = req.files.reduce((sum, file) => sum + file.size, 0);
        if (totalFileSize > maxTotalSize) {
            console.log('Files rejected - total size too large:', Math.round(totalFileSize/1024), 'KB');
            res.status(413);
            throw new Error(`Total file size (${Math.round(totalFileSize/1024)}KB) exceeds limit of 350KB.`);
        }
        
        filesData = req.files.map(file => ({
            filename: file.originalname,
            contentType: file.mimetype,
            data: file.buffer.toString('base64')
        }));
        console.log('Files processed successfully:', filesData.length);
    }

    // Handle text content from FormData
    if (req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data')) {
        // For multipart/form-data, text fields are directly in req.body
        textContent = req.body.data || req.body.Text;
        console.log('Extracted textContent from FormData:', textContent);

        if (req.body.ActionGroupObject) {
            if (typeof req.body.ActionGroupObject === 'string') {
                try {
                    actionGroupObjectContent = JSON.parse(req.body.ActionGroupObject);
                } catch (e) {
                    console.warn('Failed to parse ActionGroupObject from multipart form field. Value:', req.body.ActionGroupObject);
                    // Decide how to handle: error, or treat as string, or ignore
                    actionGroupObjectContent = null; // Or some default/error state
                }
            } else {
                 // If it's already an object (less common for multipart but possible if client constructs it so)
                actionGroupObjectContent = req.body.ActionGroupObject;
            }
        }
        
        // If files were sent as a JSON string in a field (e.g., 'filesJsonString') and no actual files uploaded
        // This is less common if also using multer for direct file uploads.
        // The log showed `req.body.files = ""`, which is just a text field.
        // If `filesData` is still empty and `req.body.Files` (or similar field) contains stringified JSON for file metadata
        if (filesData.length === 0 && req.body.Files && typeof req.body.Files === 'string') {
            try {
                const parsedFilesField = JSON.parse(req.body.Files);
                if (Array.isArray(parsedFilesField)) {
                    filesData = parsedFilesField; // Assuming it's already in the desired format
                }
            } catch (e) {
                console.warn('Failed to parse "Files" field from multipart form data.');
            }
        }


    } else { // Handle application/json
        // Check if data is sent directly as 'text' field (for bug reports, reviews, etc.)
        if (req.body.text) {
            textContent = req.body.text;
            actionGroupObjectContent = req.body.ActionGroupObject;
            if (Array.isArray(req.body.Files)) {
                if (filesData.length === 0) filesData = req.body.Files;
            }
        }
        // Original data field handling for backward compatibility
        else if (req.body.data) {
            let jsonDataPayload = req.body.data;
            if (typeof jsonDataPayload === 'string') {
                try {
                    jsonDataPayload = JSON.parse(jsonDataPayload);
                } catch (e) {
                    // If it's a string but not JSON, assume it's the text content itself
                    textContent = jsonDataPayload;
                    jsonDataPayload = null; // No further parsing needed for this path
                }
            }

            if (jsonDataPayload) {
                textContent = jsonDataPayload.Text;
                actionGroupObjectContent = jsonDataPayload.ActionGroupObject;
                if (Array.isArray(jsonDataPayload.Files)) { // Only if no files from multer
                     if (filesData.length === 0) filesData = jsonDataPayload.Files;
                }
            }
        } else {
            res.status(400);
            throw new Error('Please provide either a data field or text field for application/json. req: ' + JSON.stringify(req.body));
        }
    }

    console.log('Final textContent:', textContent);
    console.log('Final actionGroupObjectContent:', actionGroupObjectContent);
    console.log('Final filesData:', filesData);

    if (!textContent) {
         console.error('Text content validation failed - textContent is empty or undefined');
         res.status(400);
         throw new Error('Text content is missing or could not be determined from the request.');
    }

    console.log('Creating DynamoDB item...');
    const params = {
        TableName: 'Simple',
        Item: {
            id: require('crypto').randomBytes(16).toString("hex"),
            text: `Creator:${req.user.id}|` + textContent,
            ActionGroupObject: actionGroupObjectContent, // Will be undefined if not provided/parsed
            files: filesData, // Will be empty array if no files
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };

    // Check total item size before sending to DynamoDB
    const itemSizeBytes = JSON.stringify(params.Item).length;
    const maxDynamoDBSize = 400 * 1024; // 400KB DynamoDB limit
    
    console.log('DynamoDB params:', {
        TableName: params.TableName,
        itemKeys: Object.keys(params.Item),
        textLength: params.Item.text?.length,
        filesCount: params.Item.files?.length || 0,
        totalItemSize: Math.round(itemSizeBytes / 1024) + 'KB'
    });

    if (itemSizeBytes > maxDynamoDBSize) {
        console.error('Item size exceeds DynamoDB limit:', Math.round(itemSizeBytes/1024), 'KB > 400KB');
        res.status(413);
        throw new Error(`Item size (${Math.round(itemSizeBytes/1024)}KB) exceeds DynamoDB limit of 400KB. Please reduce file sizes or content.`);
    }

    try {
        console.log('Sending to DynamoDB...');
        await dynamodb.send(new PutCommand(params));
        console.log('DynamoDB write successful');
        res.status(200).json(params.Item);
    } catch (error) {
        console.error('=== DynamoDB Error ===');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Full error:', error);
        res.status(500).json({ error: 'Failed to create data', details: error.message });
    }
})

// @desc    Compress Data
// @route   POST /api/compress
// @access  Private
const compressData = asyncHandler(async (req, res) => {
    await checkIP(req);
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON); // Log the request body

    const updateId = req.body.updateId; // Check if this is an update to existing chat
    console.log('Update ID:', updateId);

    const itemID = parsedJSON._id; // Get the ID from the query string.

    const contextInput = parsedJSON.text; // Get context input directly from text field
    console.log('Context input:', contextInput); // Log the context input

    if (typeof contextInput !== 'string') { 
        throw new Error('Data input invalid')
    }

    const netIndex = contextInput.includes('Net:') ? contextInput.indexOf('Net:'): 0; 
    const userInput = netIndex>0 ? contextInput.substring(netIndex + 4): contextInput;

    console.log('User input:', userInput); // Log the user input

    try {
        console.log('🔍 Starting API validation check...');
        const startValidation = Date.now();
        const startApiCheck = Date.now();
        
        // Check if user can make OpenAI API call
        const canMakeCall = await canMakeApiCall(req.user.id, 'openai', {
            model: 'o1-mini',
            inputTokens: Math.ceil(userInput.length / 4), // Rough estimate: 4 chars per token
            outputTokens: 200 // Estimate for output
        });

        console.log(`✅ API validation completed in ${Date.now() - startApiCheck}ms`);

        if (!canMakeCall.canMake) {
            console.log('OpenAI API call blocked:', canMakeCall.reason);
            return res.status(402).json({ 
                error: 'API usage limit reached', 
                reason: canMakeCall.reason,
                currentUsage: canMakeCall.currentUsage,
                limit: canMakeCall.limit,
                requiresUpgrade: true
            });
        }

        if (!client) {
            await initializeOpenAI();
        }
        
        console.log('🤖 Starting OpenAI API call...');
        const startOpenAI = Date.now();
        
        const response = await client.chat.completions.create({
          model: 'o1-mini', // Use the o1-mini model
          messages: [{ role: 'user', content: userInput }],
          max_completion_tokens: 1000, // Increase the max tokens to allow more complete responses
        });
        
        console.log(`🤖 OpenAI API call completed in ${Date.now() - startOpenAI}ms`);
        console.log('OpenAI response:', JSON.stringify(response)); // Log the OpenAI response
        
        console.log('📊 Starting usage tracking...');
        const startTracking = Date.now();
        
        // Track API usage
        const inputTokens = response.usage?.prompt_tokens || Math.ceil(userInput.length / 4);
        const outputTokens = response.usage?.completion_tokens || Math.ceil(response.choices[0].message.content.length / 4);
        
        const usageResult = await trackApiUsage(req.user.id, 'openai', {
            inputTokens: inputTokens,
            outputTokens: outputTokens
        }, 'o1-mini');

        console.log(`📊 Usage tracking completed in ${Date.now() - startTracking}ms`);

        if (!usageResult.success) {
            console.log('Usage tracking failed:', usageResult.error);
            // Continue anyway - don't fail the request for usage tracking issues
        } else {
            console.log(`OpenAI usage tracked: $${usageResult.cost.toFixed(4)}, Total: $${usageResult.totalUsage.toFixed(4)}`);
        }
        
        // const response = { data: { choices: [ {text: "This is a simulated response for debugging purposes."} ] } };

        if (response.choices[0].message.content && response.choices[0].message.content.length > 0) {
            console.log('💾 Starting data saving...');
            const startSaving = Date.now();
            
            const compressedData = response.choices[0].message.content; // Extract the compressed data from the OpenAI response.
            const newData = "Creator:"+req.user.id+"|Net:"+userInput+"\n"+compressedData;

            console.log('Saving data with format:', newData.substring(0, 100) + '...');

            if (updateId) {
                // Update existing item in DynamoDB
                console.log('Updating existing chat with ID:', updateId);
                const updateParams = {
                    TableName: 'Simple',
                    Key: {
                        id: updateId
                    },
                    UpdateExpression: 'SET #text = :text, updatedAt = :updatedAt',
                    ExpressionAttributeNames: {
                        '#text': 'text'
                    },
                    ExpressionAttributeValues: {
                        ':text': newData,
                        ':updatedAt': new Date().toISOString()
                    },
                    ReturnValues: 'UPDATED_NEW'
                };

                try {
                    const result = await dynamodb.send(new UpdateCommand(updateParams));
                    console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
                    console.log('Successfully updated existing chat');
                    res.status(200).json({ data: [compressedData] });
                } catch (dbError) {
                    console.error('Error updating DynamoDB:', dbError);
                    res.status(500).json({ error: 'Failed to update data' });
                }
            } else {
                // Create new item in DynamoDB
                console.log('Creating new chat entry');
                const newItemParams = {
                    TableName: 'Simple',
                    Item: {
                        id: require('crypto').randomBytes(16).toString("hex"),
                        text: newData,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                };

                try {
                    await dynamodb.send(new PutCommand(newItemParams));
                    console.log(`💾 Data saving completed in ${Date.now() - startSaving}ms`);
                    console.log('Successfully created new chat');
                    res.status(201).json({ data: [compressedData] });
                } catch (dbError) {
                    console.error('Error saving to DynamoDB:', dbError);
                    res.status(500).json({ error: 'Failed to save data' });
                }
            }
        } else {
            console.log(`💾 Total operation completed in ${Date.now() - startValidation}ms`);
            res.status(500).json({ error: 'No compressed data found in the OpenAI response' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred during compression' });
    }
});

// POST: Create a new customer
const createCustomer = asyncHandler(async (req, res) => {
    const { email, name } = req.body;
    
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    
    // Check if user.text exists before accessing its properties
    if (!req.user.text) {
        res.status(400);
        throw new Error('User data not found or incomplete');
    }
    
    try {
        let customer;
        const userData = req.user.text;
        
        // Check if user already has a Stripe customer ID in the database
        const stripeIdMatch = userData.match(/\|stripeid:([^|]*)/);
        const existingStripeId = stripeIdMatch && stripeIdMatch[1] ? stripeIdMatch[1].trim() : null;
        
        // If user has a Stripe ID, validate it against Stripe
        if (existingStripeId && existingStripeId !== '') {
            try {
                console.log('Validating existing Stripe customer ID:', existingStripeId);
                const existingCustomer = await stripe.customers.retrieve(existingStripeId);
                
                // Check if the email matches
                if (existingCustomer.email === email) {
                    console.log('Existing Stripe customer ID is valid and email matches');
                    customer = existingCustomer;
                } else {
                    console.log(`Email mismatch: DB has ${existingStripeId} with email ${existingCustomer.email}, but user email is ${email}`);
                    // Email doesn't match, need to find or create correct customer
                    customer = null; // Will be handled below
                }
            } catch (stripeError) {
                console.log(`Stripe customer ID ${existingStripeId} is invalid or deleted:`, stripeError.message);
                // Invalid customer ID, need to find or create new one
                customer = null; // Will be handled below
            }
        }
        
        // If no valid customer found yet, search by email or create new one
        if (!customer) {
            // First, check if a customer with this email already exists in Stripe
            const existingCustomers = await stripe.customers.list({
                email: email,
                limit: 1
            });
            
            if (existingCustomers.data.length > 0) {
                // Use the existing customer
                customer = existingCustomers.data[0];
                console.log('Found existing Stripe customer by email:', customer.id, 'for email:', email);
                
                // Log if we're correcting a mismatch
                if (existingStripeId && existingStripeId !== customer.id) {
                    console.log(`Correcting customer ID mismatch: ${existingStripeId} -> ${customer.id}`);
                }
            } else {
                // Create new Stripe customer if none exists
                customer = await stripe.customers.create({ email, name });
                console.log('Created new Stripe customer:', customer.id, 'for email:', email);
                
                if (existingStripeId) {
                    console.log(`Replacing invalid customer ID: ${existingStripeId} -> ${customer.id}`);
                }
            }
        }
        
        // Update user's stripeid in the database
        const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${customer.id}`);
        
        console.log('Original user data:', userData);
        console.log('Updated user data:', updatedUserData);
        
        // Update the user data in DynamoDB using PutCommand (like other successful updates)
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...req.user, // Keep all existing user data
                text: updatedUserData, // Update the text with new stripeid
                updatedAt: new Date().toISOString() // Update timestamp
            }
        };
        
        await dynamodb.send(new PutCommand(putParams));
        console.log('User data updated with Stripe customer ID');
        
        // Determine response message based on what happened
        let responseMessage;
        if (existingStripeId && existingStripeId === customer.id) {
            responseMessage = 'Existing customer ID validated successfully';
        } else if (existingStripeId && existingStripeId !== customer.id) {
            responseMessage = 'Customer ID corrected and updated in database';
        } else {
            responseMessage = 'Customer found/created and assigned to user';
        }
        
        res.status(201).json({
            success: true,
            customer: customer,
            message: responseMessage
        });
    } catch (error) {
        console.error('Customer creation/assignment failed:', error);
        res.status(500);
        throw new Error('Customer creation/assignment failed');
    }
});

// POST: Create a setup intent or attach a payment method
const postPaymentMethod = asyncHandler(async (req, res) => {
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    // Updated: Added validation fix for setup intents
    console.log('Request body:', req.body);
    console.log('req.user:', req.user);
    
    // Check if user.text exists before accessing its properties (corrected structure)
    if (!req.user.text) {
        res.status(400);
        throw new Error('User data not found or incomplete');
    }
    
    console.log('req.user.text:', req.user.text);

    try {
        // Check if stripeid exists and extract customer ID
        const stripeIdMatch = req.user.text.match(/\|stripeid:([^|]*)/);
        if (!stripeIdMatch) {
            res.status(400);
            throw new Error('No customer ID found. Please create a customer first.');
        }
        
        const customerId = stripeIdMatch[1];
        if (!customerId || customerId.trim() === '') {
            console.log('No Stripe customer ID found, returning error to trigger customer creation');
            return res.status(400).json({
                success: false,
                message: 'No customer ID found. Please create a customer first.',
                code: 'CUSTOMER_REQUIRED'
            });
        }
        
        console.log('Extracted Customer ID:', customerId);
        
        // Validate that the customer ID exists in Stripe and get user email for validation
        let validatedCustomer;
        let finalCustomerId = customerId; // Use a mutable variable for updates
        console.log('Initial finalCustomerId:', finalCustomerId);
        
        try {
            validatedCustomer = await stripe.customers.retrieve(finalCustomerId);
            console.log('Customer ID validated successfully in Stripe');
        } catch (stripeError) {
            console.error(`Invalid Stripe customer ID ${finalCustomerId}:`, stripeError.message);
            
            // Fallback: Search by email and update customer ID
            try {
                console.log('Attempting to recover by searching for customer by email...');
                
                // Extract email and name from user data
                const userData = req.user.text;
                const emailMatch = userData.match(/Email:([^|]*)/);
                const nameMatch = userData.match(/Nickname:([^|]*)/);
                
                if (!emailMatch || !emailMatch[1]) {
                    throw new Error('Could not extract email from user data');
                }
                
                const email = emailMatch[1].trim();
                const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
                
                console.log('Extracted email:', email, 'name:', name);
                
                // Search for existing customer by email
                const existingCustomers = await stripe.customers.list({
                    email: email,
                    limit: 1
                });
                
                if (existingCustomers.data.length > 0) {
                    // Found existing customer
                    validatedCustomer = existingCustomers.data[0];
                    console.log('Found existing Stripe customer by email:', validatedCustomer.id);
                } else {
                    // Create new customer
                    validatedCustomer = await stripe.customers.create({ email, name });
                    console.log('Created new Stripe customer:', validatedCustomer.id);
                }
                
                // Update user data with correct customer ID
                const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${validatedCustomer.id}`);
                console.log('Updating user data with correct customer ID:', validatedCustomer.id);
                
                // Update in DynamoDB
                const putParams = {
                    TableName: 'Simple',
                    Item: {
                        ...req.user,
                        text: updatedUserData,
                        updatedAt: new Date().toISOString()
                    }
                };
                
                await dynamodb.send(new PutCommand(putParams));
                console.log('User data updated with correct Stripe customer ID');
                
                // Update customerId for the rest of the function
                finalCustomerId = validatedCustomer.id;
                console.log('Updated finalCustomerId after recovery:', finalCustomerId);
                
            } catch (recoveryError) {
                console.error('Failed to recover customer ID:', recoveryError.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to validate or recover customer ID',
                    details: recoveryError.message
                });
            }
        }
        
        console.log('Final customer ID to be used for operations:', finalCustomerId);
        
        // Case 1: If paymentMethodId is provided (from Stripe.js on frontend), attach it to the customer
        if (req.body.paymentMethodId) {
            const paymentMethodId = req.body.paymentMethodId;
            
            try {
                // Attach the payment method to the customer
                await stripe.paymentMethods.attach(paymentMethodId, {
                    customer: finalCustomerId,
                });
                
                // Set as default payment method
                await stripe.customers.update(finalCustomerId, {
                    invoice_settings: {
                        default_payment_method: paymentMethodId,
                    },
                });
                
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
                res.status(200).json(paymentMethod);
                
            } catch (attachError) {
                console.error('Payment method attachment failed:', attachError.message);
                
                // If this is a "No such customer" error, try the fallback recovery
                if (attachError.code === 'resource_missing' && attachError.message.includes('No such customer')) {
                    console.log('Payment method attachment failed due to invalid customer ID, attempting recovery...');
                    
                    try {
                        // Extract email and name from user data
                        const userData = req.user.text;
                        const emailMatch = userData.match(/Email:([^|]*)/);
                        const nameMatch = userData.match(/Nickname:([^|]*)/);
                        
                        if (!emailMatch || !emailMatch[1]) {
                            throw new Error('Could not extract email from user data');
                        }
                        
                        const email = emailMatch[1].trim();
                        const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
                        
                        console.log('Extracted email for recovery:', email, 'name:', name);
                        
                        // Search for existing customer by email
                        const existingCustomers = await stripe.customers.list({
                            email: email,
                            limit: 1
                        });
                        
                        let recoveredCustomer;
                        if (existingCustomers.data.length > 0) {
                            // Found existing customer
                            recoveredCustomer = existingCustomers.data[0];
                            console.log('Found existing Stripe customer by email:', recoveredCustomer.id);
                        } else {
                            // Create new customer
                            recoveredCustomer = await stripe.customers.create({ email, name });
                            console.log('Created new Stripe customer:', recoveredCustomer.id);
                        }
                        
                        // Update user data with correct customer ID
                        const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${recoveredCustomer.id}`);
                        console.log('Updating user data with recovered customer ID:', recoveredCustomer.id);
                        
                        // Update in DynamoDB
                        const putParams = {
                            TableName: 'Simple',
                            Item: {
                                ...req.user,
                                text: updatedUserData,
                                updatedAt: new Date().toISOString()
                            }
                        };
                        
                        await dynamodb.send(new PutCommand(putParams));
                        console.log('User data updated with recovered Stripe customer ID');
                        
                        // Now retry the payment method attachment with the recovered customer ID
                        console.log('Retrying payment method attachment with recovered customer:', recoveredCustomer.id);
                        
                        await stripe.paymentMethods.attach(paymentMethodId, {
                            customer: recoveredCustomer.id,
                        });
                        
                        await stripe.customers.update(recoveredCustomer.id, {
                            invoice_settings: {
                                default_payment_method: paymentMethodId,
                            },
                        });
                        
                        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
                        console.log('Payment method attached successfully with recovered customer');
                        res.status(200).json(paymentMethod);
                        
                    } catch (recoveryError) {
                        console.error('Failed to recover from payment method attachment error:', recoveryError.message);
                        res.status(500).json({ 
                            error: 'Failed to attach payment method and recovery failed',
                            details: recoveryError.message
                        });
                    }
                } else {
                    // Different error, just throw it
                    throw attachError;
                }
            }
        } 
        // Case 2: Create a setup intent for the frontend to use with Stripe Elements
        else {
            console.log('Creating setup intent for customer:', finalCustomerId);
            
            try {
                // Creating a setup intent with expanded payment_method types
                const setupIntent = await stripe.setupIntents.create({
                    customer: finalCustomerId,
                    // Support more payment methods - note that your Stripe account needs to be configured to accept these
                    payment_method_types: [
                        'link',
                        'card', 
                        'cashapp', 
                    ],
                    usage: 'off_session',  // Allow future payments without customer present
                    // Remove the problematic payment_method_options that was causing the error
                });
                
                console.log('Setup intent created successfully:', setupIntent.id);
                // Return the full setup intent object (includes client_secret)
                res.status(200).json(setupIntent);
                
            } catch (setupIntentError) {
                console.error('Setup intent creation failed:', setupIntentError.message);
                
                // If this is a "No such customer" error, try the fallback recovery
                if (setupIntentError.code === 'resource_missing' && setupIntentError.message.includes('No such customer')) {
                    console.log('Setup intent failed due to invalid customer ID, attempting recovery...');
                    
                    try {
                        // Extract email and name from user data
                        const userData = req.user.text;
                        const emailMatch = userData.match(/Email:([^|]*)/);
                        const nameMatch = userData.match(/Nickname:([^|]*)/);
                        
                        if (!emailMatch || !emailMatch[1]) {
                            throw new Error('Could not extract email from user data');
                        }
                        
                        const email = emailMatch[1].trim();
                        const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
                        
                        console.log('Extracted email for recovery:', email, 'name:', name);
                        
                        // Search for existing customer by email
                        const existingCustomers = await stripe.customers.list({
                            email: email,
                            limit: 1
                        });
                        
                        let recoveredCustomer;
                        if (existingCustomers.data.length > 0) {
                            // Found existing customer
                            recoveredCustomer = existingCustomers.data[0];
                            console.log('Found existing Stripe customer by email:', recoveredCustomer.id);
                        } else {
                            // Create new customer
                            recoveredCustomer = await stripe.customers.create({ email, name });
                            console.log('Created new Stripe customer:', recoveredCustomer.id);
                        }
                        
                        // Update user data with correct customer ID
                        const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${recoveredCustomer.id}`);
                        console.log('Updating user data with recovered customer ID:', recoveredCustomer.id);
                        
                        // Update in DynamoDB
                        const putParams = {
                            TableName: 'Simple',
                            Item: {
                                ...req.user,
                                text: updatedUserData,
                                updatedAt: new Date().toISOString()
                            }
                        };
                        
                        await dynamodb.send(new PutCommand(putParams));
                        console.log('User data updated with recovered Stripe customer ID');
                        
                        // Now try creating the setup intent with the recovered customer ID
                        console.log('Retrying setup intent creation with recovered customer:', recoveredCustomer.id);
                        const retrySetupIntent = await stripe.setupIntents.create({
                            customer: recoveredCustomer.id,
                            payment_method_types: [
                                'link',
                                'card', 
                                'cashapp', 
                            ],
                            usage: 'off_session',
                        });
                        
                        console.log('Setup intent created successfully with recovered customer:', retrySetupIntent.id);
                        res.status(200).json(retrySetupIntent);
                        
                    } catch (recoveryError) {
                        console.error('Failed to recover from setup intent error:', recoveryError.message);
                        res.status(500).json({ 
                            error: 'Failed to create setup intent and recovery failed',
                            details: recoveryError.message
                        });
                    }
                } else {
                    // Different error, just throw it
                    throw setupIntentError;
                }
            }
        }
    } catch (error) {
        console.error('Error handling payment method:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST: Create an invoice at the end of the month
const createInvoice = asyncHandler(async (req, res) => {
    const { customerId, amount, description } = req.body;
    await stripe.invoiceItems.create({
        customer: customerId,
        amount,
        currency: 'usd',
        description,
    });
    const invoice = await stripe.invoices.create({
        customer: customerId,
        auto_advance: true,
    });
    res.status(200).json(invoice);
});

// POST: Subscribe customer to a membership plan
const subscribeCustomer = asyncHandler(async (req, res) => {
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const { paymentMethodId, membershipType, customPrice } = req.body;
    console.log('Subscription request:', { membershipType, paymentMethodId, customPrice });
    // Extract customer ID using regex for more reliability
    const stripeIdMatch = req.user.text.match(/\|stripeid:([^|]+)/);
    if (!stripeIdMatch || !stripeIdMatch[1]) {
        res.status(400);
        throw new Error('Invalid customer ID format');
    }
    
    const customerId = stripeIdMatch[1];
    console.log('Customer ID for subscription management:', customerId);

    // Validate that the customer ID exists in Stripe
    let validatedCustomer;
    let finalCustomerId = customerId; // Use a mutable variable for updates
    try {
        validatedCustomer = await stripe.customers.retrieve(customerId);
        console.log('Customer ID validated successfully for subscription');
    } catch (stripeError) {
        console.error(`Invalid Stripe customer ID ${customerId} during subscription:`, stripeError.message);
        
        // Fallback: Search by email and update customer ID
        try {
            console.log('Attempting to recover by searching for customer by email...');
            
            // Extract email and name from user data
            const userData = req.user.text;
            const emailMatch = userData.match(/Email:([^|]*)/);
            const nameMatch = userData.match(/Nickname:([^|]*)/);
            
            if (!emailMatch || !emailMatch[1]) {
                throw new Error('Could not extract email from user data');
            }
            
            const email = emailMatch[1].trim();
            const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
            
            console.log('Extracted email:', email, 'name:', name);
            
            // Search for existing customer by email
            const existingCustomers = await stripe.customers.list({
                email: email,
                limit: 1
            });
            
            if (existingCustomers.data.length > 0) {
                // Found existing customer
                validatedCustomer = existingCustomers.data[0];
                console.log('Found existing Stripe customer by email:', validatedCustomer.id);
            } else {
                // Create new customer
                validatedCustomer = await stripe.customers.create({ email, name });
                console.log('Created new Stripe customer:', validatedCustomer.id);
            }
            
            // Update user data with correct customer ID
            const updatedUserData = userData.replace(/\|stripeid:([^|]*)/, `|stripeid:${validatedCustomer.id}`);
            console.log('Updating user data with correct customer ID:', validatedCustomer.id);
            
            // Update in DynamoDB
            const putParams = {
                TableName: 'Simple',
                Item: {
                    ...req.user,
                    text: updatedUserData,
                    updatedAt: new Date().toISOString()
                }
            };
            
            await dynamodb.send(new PutCommand(putParams));
            console.log('User data updated with correct Stripe customer ID');
            
            // Update customerId for the rest of the function
            finalCustomerId = validatedCustomer.id;
            
        } catch (recoveryError) {
            console.error('Failed to recover customer ID:', recoveryError.message);
            res.status(500);
            throw new Error(`Failed to validate or recover customer ID: ${recoveryError.message}`);
        }
    }

    // Validate custom price for premium and flex memberships
    if (membershipType === 'premium') {
        if (!customPrice) {
            res.status(400);
            throw new Error('Custom price is required for premium membership');
        }
        
        const numPrice = parseFloat(customPrice);
        if (isNaN(numPrice)) {
            res.status(400);
            throw new Error('Custom price must be a valid number');
        }
        
        if (numPrice < 9999) {
            res.status(400);
            throw new Error('Custom price must be at least $9,999/year for premium membership');
        }
        
        console.log(`Premium annual custom price validated: $${numPrice}/year`);
    } else if (membershipType === 'flex') {
        if (!customPrice) {
            res.status(400);
            throw new Error('Custom price is required for flex membership');
        }
        
        const numPrice = parseFloat(customPrice);
        if (isNaN(numPrice)) {
            res.status(400);
            throw new Error('Custom price must be a valid number');
        }
        
        if (numPrice < 10) {
            res.status(400);
            throw new Error('Custom price must be at least $10 for flex membership');
        }
        
        console.log(`Flex custom price validated: $${numPrice}`);
    }

    // Extract user email for notifications
    const emailMatch = req.user.text.match(/Email:([^|]+)/);
    let userEmail = null;
    if (emailMatch && emailMatch[1]) {
        userEmail = emailMatch[1].trim();
        console.log('User email for notifications:', userEmail);
    }

    // Function to update the Rank in user.data.text using putHashData
    const updateUserRank = async (rank) => {
        try {
            // Convert first letter to uppercase for consistency
            const formattedRank = rank.charAt(0).toUpperCase() + rank.slice(1).toLowerCase();
            console.log(`Updating user rank to: ${formattedRank}`);
            
            // Find the user data document containing user profile data
            // This looks for data with format: Nickname:xxx|Email:xxx|Password:xxx|stripeid:xxx|Rank:xxx
            const userData = await Data.findOne({
                'data.text': { $regex: `Email:.*\\|Password:.*\\|stripeid:${finalCustomerId}`, $options: 'i' }
            });
            
            if (!userData) {
                console.error(`No user profile data found for customer ID: ${finalCustomerId}`);
                return false;
            }
            
            console.log(`Found user profile data with ID: ${userData._id}`);
            
            // Get the current text content
            let updatedText = userData.data.text;
            
            // Update the Rank field if it exists
            if (updatedText.includes('|Rank:')) {
                updatedText = updatedText.replace(/(\|Rank:)[^|]*/, `|Rank:${formattedRank}`);
                console.log(`Updated Rank in text to: ${formattedRank}`);
            } else {
                // Add Rank field if it doesn't exist
                updatedText += `|Rank:${formattedRank}`;
                console.log(`Added new Rank field: ${formattedRank}`);
            }
            
            // Use putHashData to update only the text field
            const result = await Data.findByIdAndUpdate(
                userData._id,
                { 'data.text': updatedText },
                { new: true }
            );
            
            if (!result) {
                console.error('Failed to update user rank in database');
                return false;
            }
            
            console.log('Successfully updated user rank in database');
            return true;
        } catch (error) {
            console.error('Error updating user rank:', error);
            return false;
        }
    };

    try {
        // Get ALL subscriptions in any status for the customer
        const existingSubscriptions = await stripe.subscriptions.list({
            customer: finalCustomerId,
            status: 'all', // Get all subscriptions regardless of status
            limit: 20 // Increased limit to catch more subscriptions
        });

        console.log(`Found ${existingSubscriptions.data.length} existing subscriptions for customer`);
        
        // Log subscription details for debugging
        if (existingSubscriptions.data.length > 0) {
            existingSubscriptions.data.forEach((sub, index) => {
                console.log(`Subscription ${index + 1}: ID=${sub.id}, Status=${sub.status}, Plan=${sub.plan?.nickname || 'unnamed plan'}`);
            });
        }

        // Check current subscription type - but don't use expansion which causes errors
        let currentMembership = 'free';
        let activeSubscriptions = [];
        
        if (existingSubscriptions.data.length > 0) {
            // Filter to just active subscriptions for determining current plan
            activeSubscriptions = existingSubscriptions.data.filter(sub => 
                ['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)
            );
            
            // Only try to determine membership type if we have active subscriptions
            if (activeSubscriptions.length > 0) {
                // First, collect all product IDs
                const productIds = [];
                for (const sub of activeSubscriptions) {
                    if (sub.plan && sub.plan.product) {
                        productIds.push(sub.plan.product);
                    }
                }
                
                // Then fetch products one by one to avoid expansion issues
                if (productIds.length > 0) {
                    for (const productId of productIds) {
                        try {
                            const product = await stripe.products.retrieve(productId);
                            console.log('Product found:', product.name);
                            
                            // Determine membership type from product name
                            if (product.name === 'Flex Membership') {
                                currentMembership = 'flex';
                                break;
                            } else if (product.name === 'Premium Membership') {
                                currentMembership = 'premium';
                                break;
                            }
                        } catch (productError) {
                            console.error(`Error fetching product ${productId}:`, productError.message);
                            // Continue with next product
                        }
                    }
                }
            }
        }
        
        console.log(`Current membership: ${currentMembership}, Requested membership: ${membershipType}`);
        
        // If user is trying to subscribe to their current plan, prevent it
        if (membershipType === currentMembership) {
            res.status(400);
            throw new Error(`You are already subscribed to the ${membershipType} plan`);
        }

        // For email notification - store previous plan
        const oldPlan = currentMembership.charAt(0).toUpperCase() + currentMembership.slice(1);
        
        // Cancel active subscriptions
        if (activeSubscriptions.length > 0) {
            console.log(`Cancelling ${activeSubscriptions.length} active subscriptions`);
            
            // Cancel each subscription that can be cancelled
            for (const subscription of activeSubscriptions) {
                try {
                    const cancelledSub = await stripe.subscriptions.cancel(subscription.id, {
                        prorate: true // Prorate the amount
                    });
                    console.log(`Successfully cancelled subscription: ${subscription.id}, new status: ${cancelledSub.status}`);
                } catch (cancelError) {
                    console.error(`Error cancelling subscription ${subscription.id}: ${cancelError.message}`);
                    // Continue with other subscriptions even if one fails
                }
            }
        }

        // Also handle incomplete_expired subscriptions by deleting them
        const expiredSubscriptions = existingSubscriptions.data.filter(sub => 
            sub.status === 'incomplete_expired'
        );

        if (expiredSubscriptions.length > 0) {
            console.log(`Cleaning up ${expiredSubscriptions.length} expired subscriptions`);
            for (const expSub of expiredSubscriptions) {
                try {
                    // For incomplete_expired, we can't cancel but can delete them from the API
                    await stripe.subscriptions.del(expSub.id);
                    console.log(`Deleted expired subscription: ${expSub.id}`);
                } catch (delError) {
                    console.error(`Error deleting subscription ${expSub.id}:`, delError.message);
                }
            }
        }

        // Handle free membership type
        if (membershipType === 'free') {
            let subscriptionCancellationSuccess = true;
            
            try {
                // Double check that all active subscriptions were cancelled
                const checkSubscriptions = await stripe.subscriptions.list({
                    customer: finalCustomerId,
                    status: 'active',
                    limit: 5
                });
                
                if (checkSubscriptions.data.length > 0) {
                    console.log(`Warning: ${checkSubscriptions.data.length} subscriptions still active after cancellation`);
                    // Try to cancel them one more time
                    for (const sub of checkSubscriptions.data) {
                        try {
                            await stripe.subscriptions.cancel(sub.id, { prorate: true });
                            console.log(`Cancelled remaining subscription: ${sub.id}`);
                        } catch (finalCancelError) {
                            console.error(`Failed to cancel subscription ${sub.id}: ${finalCancelError.message}`);
                            subscriptionCancellationSuccess = false;
                        }
                    }
                }
            } catch (cancelCheckError) {
                console.error('Error checking remaining subscriptions:', cancelCheckError);
                // Don't set success to false here, we'll try to update the rank anyway
            }
            
            // Always update user rank to Free using putHashData - even if subscription cancellation had issues
            try {
                const rankUpdated = await updateUserRank('Free');
                if (!rankUpdated) {
                    console.warn('Failed to update user rank using putHashData');
                    
                    // Fallback to direct database update if putHashData fails
                    try {
                        // Find the user data document by user ID
                        const userData = await Data.findOne({ _id: req.user._id });
                        
                        if (userData) {
                            // Update the Rank field if it exists
                            let updatedUserText = userData.data.text;
                            if (updatedUserText.includes('|Rank:')) {
                                updatedUserText = updatedUserText.replace(/(\|Rank:)[^|]*/, '|Rank:Free');
                            } else {
                                // Add Rank field if it doesn't exist
                                updatedUserText += '|Rank:Free';
                            }
                            
                            // Direct database update
                            userData.data.text = updatedUserText;
                            await userData.save();
                            console.log('Successfully updated user rank through direct database update');
                        }
                    } catch (directUpdateError) {
                        console.error('Failed direct database update:', directUpdateError);
                    }
                }
                
                // Send notification email if email is available
                if (userEmail) {
                    try {
                        await sendEmail(userEmail, 'subscriptionCancelled', {
                            plan: oldPlan,
                            userData: req.user.data
                        });
                        console.log('Cancellation email sent successfully');
                    } catch (emailError) {
                        console.error('Failed to send cancellation email:', emailError);
                        // Don't fail the operation if email sending fails
                    }
                }
            } catch (rankUpdateError) {
                console.error('Error in rank update process:', rankUpdateError);
            }
            
            // For free tier, return success even if some cancellations failed
            // The important thing is that the user's rank is set to Free
            res.status(subscriptionCancellationSuccess ? 200 : 207).json({ 
                success: true, 
                membershipType: 'free',
                message: subscriptionCancellationSuccess ? 
                    'Successfully switched to free plan' : 
                    'Switched to free plan with some subscription cleanup pending'
            });
            return;
        }

        // Set default payment method if provided
        if (paymentMethodId) {
            await stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });
        }

        // Get the correct price ID based on the membership type
        // Map frontend membership types to Stripe product names
        let productName;
        if (membershipType === 'flex') {
            productName = 'Flex Membership';
        } else if (membershipType === 'premium') {
            productName = 'Premium Membership';
        } else {
            res.status(400);
            throw new Error('Invalid membership type');
        }

        // Handle pricing for different membership types
        let priceId;
        let subscription;
        
        if ((membershipType === 'premium' || membershipType === 'flex') && customPrice) {
            // For plans with custom pricing, create a dynamic price
            console.log(`Creating custom price for ${membershipType}: $${customPrice}`);
            
            // First, find or create the product
            const products = await stripe.products.list({
                active: true,
                limit: 100
            });
            
            let product = products.data.find(p => p.name === productName);
            
            if (!product) {
                // Create the product if it doesn't exist
                product = await stripe.products.create({
                    name: productName,
                    description: `${membershipType === 'premium' ? 'Premium' : 'Flex'} Membership with custom pricing`,
                });
                console.log(`Created ${membershipType} product: ${product.id}`);
            }
            
            // Create a new price for this custom amount
            const customPriceAmount = Math.round(parseFloat(customPrice) * 100); // Convert to cents
            const billingInterval = membershipType === 'premium' ? 'year' : 'month';
            const dynamicPrice = await stripe.prices.create({
                product: product.id,
                unit_amount: customPriceAmount,
                currency: 'usd',
                recurring: {
                    interval: billingInterval
                },
                nickname: `${membershipType === 'premium' ? 'Premium' : 'Flex'} Custom - $${customPrice}/${billingInterval}`
            });
            
            priceId = dynamicPrice.id;
            console.log(`Created custom price ID: ${priceId} for $${customPrice}/${billingInterval}`);
            
        } else {
            // For flex plans or premium plans without custom pricing, use existing logic
            
            // First try to use the environment variables if available
            if (membershipType === 'flex' && process.env.STRIPE_FLEX_PRICE_ID) {
                priceId = process.env.STRIPE_FLEX_PRICE_ID;
            } else if (membershipType === 'premium' && process.env.STRIPE_PREMIUM_PRICE_ID) {
                priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
            } else {
                // If environment variables aren't available, look up the price by product name
                const products = await stripe.products.list({
                    active: true,
                    limit: 100 // Increase if you have more products
                });
                
                const product = products.data.find(p => p.name === productName);
                
                if (!product) {
                    console.error(`Product not found: ${productName}`);
                    throw new Error(`Membership product "${productName}" not found in Stripe`);
                }
                
                // Get the price for this product
                const prices = await stripe.prices.list({
                    product: product.id,
                    active: true
                });
                
                if (prices.data.length === 0) {
                    console.error(`No prices found for product: ${productName}`);
                    throw new Error(`No pricing available for "${productName}"`);
                }
                
                // Use the first active price (you could add logic to select a specific price if needed)
                priceId = prices.data[0].id;
            }
            
            console.log(`Using existing price ID: ${priceId} for ${productName}`);
        }

        // Create the subscription with the determined price ID
        subscription = await stripe.subscriptions.create({
            customer: finalCustomerId,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: {
                save_default_payment_method: 'on_subscription',
                payment_method_types: ['card', 'link', 'cashapp']
            },
            expand: ['latest_invoice.payment_intent'],
        });

        // Update user rank based on the membership type using putHashData
        await updateUserRank(membershipType);

        // Send subscription confirmation email if email is available
        if (userEmail) {
            try {
                // Determine if this is an update or new subscription
                if (currentMembership === 'free') {
                    // New subscription
                    await sendEmail(userEmail, 'subscriptionCreated', {
                        plan: membershipType.charAt(0).toUpperCase() + membershipType.slice(1),
                        userData: req.user.data
                    });
                } else {
                    // Subscription update
                    await sendEmail(userEmail, 'subscriptionUpdated', {
                        oldPlan: oldPlan,
                        newPlan: membershipType.charAt(0).toUpperCase() + membershipType.slice(1),
                        userData: req.user.data
                    });
                }
                console.log('Subscription confirmation email sent successfully');
            } catch (emailError) {
                console.error('Failed to send subscription email:', emailError);
                // Don't fail the operation if email sending fails
            }
        }

        const response = {
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
            membershipType: membershipType,
            productName: productName
        };
        
        // Add custom price information for premium plans
        if (membershipType === 'premium' && customPrice) {
            response.customPrice = parseFloat(customPrice);
        }
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error managing subscription:', error);
        
        // Even if there's an error, try to update the rank for free plan requests
        if (membershipType === 'free') {
            try {
                console.log('Attempting rank update despite subscription error');
                await updateUserRank('Free');
            } catch (fallbackError) {
                console.error('Fallback rank update also failed:', fallbackError);
            }
        }
        
        res.status(500).json({ error: error.message });
    }
});

// POST: Handle webhook events. Stripe sends events to this endpoint at any time.
const handleWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    switch (event.type) {
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            // Handle successful payment
            break;
        // ... handle other event types
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).send();
});

// POST: Set custom usage limit for Premium users
const setCustomLimit = asyncHandler(async (req, res) => {
    console.log('setCustomLimit called:', req.body);

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const { customLimit } = req.body;
    
    // Validate custom limit
    if (!customLimit || typeof customLimit !== 'number' || customLimit < 0.50) {
        res.status(400);
        throw new Error('Invalid custom limit. Must be at least $0.50.');
    }

    // Check if user is Premium
    const userText = req.user.text || '';
    let userRank;
    
    try {
        const { getUserRankFromStripe } = require('../utils/apiUsageTracker.js');
        userRank = await getUserRankFromStripe(req.user.id);
    } catch (error) {
        console.error('Failed to get user rank from Stripe:', error);
        res.status(500);
        throw new Error('Unable to verify membership status');
    }

    if (userRank !== 'Premium') {
        res.status(403);
        throw new Error('Custom limits are only available for Premium members');
    }

    // Get current credits data
    const { parseUserCredits, updateUserCredits } = require('../utils/apiUsageTracker.js');
    let creditsData = parseUserCredits(userText);

    // Calculate the price difference
    const currentLimit = creditsData.customLimit || 10.00;
    const limitDifference = customLimit - currentLimit;

    console.log(`Current limit: $${currentLimit.toFixed(2)}, New limit: $${customLimit.toFixed(2)}, Difference: $${limitDifference.toFixed(2)}`);

    if (limitDifference > 0) {
        // User is increasing their limit - charge them the difference and add credits immediately
        try {
            // Get stripe customer ID from user text
            const stripeCustomerId = userText.match(/stripeCustomerId:([^|]+)/)?.[1];
            if (!stripeCustomerId) {
                res.status(400);
                throw new Error('No Stripe customer ID found');
            }

            // Create payment intent for the difference
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(limitDifference * 100), // Convert to cents
                currency: 'usd',
                customer: stripeCustomerId,
                description: `Premium limit increase from $${currentLimit.toFixed(2)} to $${customLimit.toFixed(2)}`,
                automatic_payment_methods: {
                    enabled: true,
                },
                confirm: true,
                return_url: `${process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://www.sthopwood.com' : 'http://localhost:3000')}/profile`
            });

            console.log('Payment processed successfully for limit increase:', paymentIntent.id);

            // Add credits immediately
            creditsData.customLimit = customLimit;
            creditsData.availableCredits = (creditsData.availableCredits || 0) + limitDifference;
            
            // Update subscription for future billing cycles
            const subscriptionId = userText.match(/subscriptionId:([^|]+)/)?.[1];
            if (subscriptionId) {
                try {
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    
                    // Create new price for custom limit amount
                    const customPrice = await stripe.prices.create({
                        currency: 'usd',
                        unit_amount: Math.round(customLimit * 100),
                        recurring: { interval: 'month' },
                        product_data: {
                            name: `Premium Membership - $${customLimit.toFixed(2)} Monthly Limit`
                        }
                    });
                    
                    // Update subscription
                    await stripe.subscriptions.update(subscriptionId, {
                        items: [{
                            id: subscription.items.data[0].id,
                            price: customPrice.id,
                        }],
                        proration_behavior: 'none' // We already charged the difference
                    });
                    
                    console.log(`Updated subscription to monthly charge of $${customLimit.toFixed(2)}`);
                } catch (subscriptionError) {
                    console.error('Error updating subscription:', subscriptionError);
                }
            }
            
            console.log(`Custom limit increased from $${currentLimit.toFixed(2)} to $${customLimit.toFixed(2)}`);
            console.log(`Added $${limitDifference.toFixed(4)} in credits immediately`);
            
        } catch (paymentError) {
            console.error('Payment processing error:', paymentError);
            res.status(400);
            throw new Error(`Payment failed: ${paymentError.message}`);
        }
    } else if (limitDifference < 0) {
        // User is decreasing their limit - adjust for next billing cycle, don't remove existing credits
        creditsData.customLimit = customLimit;
        console.log(`Custom limit decreased from $${currentLimit.toFixed(2)} to $${customLimit.toFixed(2)}`);
        console.log('Next billing cycle will reflect the lower amount');
    } else {
        // No change in limit
        res.status(400);
        throw new Error('Custom limit is the same as current limit');
    }

    // Update user text with new credits data
    const updatedText = updateUserCredits(userText, creditsData);

    // Save to database
    const putParams = {
        TableName: 'Simple',
        Item: {
            ...req.user,
            text: updatedText,
            updatedAt: new Date().toISOString()
        }
    };

    await dynamodb.send(new PutCommand(putParams));

    console.log('Custom limit updated successfully');
    res.status(200).json({
        success: true,
        message: limitDifference > 0 
            ? `Custom limit increased to $${customLimit.toFixed(2)}. Credits added immediately.`
            : `Custom limit updated to $${customLimit.toFixed(2)}. Next billing cycle will reflect the new amount.`,
        newLimit: customLimit,
        availableCredits: creditsData.availableCredits,
        limitChange: limitDifference,
        immediateCredits: Math.max(0, limitDifference)
    });
});

module.exports = { 
    postHashData, 
    compressData, 
    createCustomer, 
    postPaymentMethod, 
    createInvoice, 
    subscribeCustomer, 
    handleWebhook,
    setCustomLimit 
};