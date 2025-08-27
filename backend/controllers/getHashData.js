require('dotenv').config();
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const fetch = require('node-fetch');
const wordBaseUrl = 'https://random-word-api.p.rapidapi.com/L/';
const defBaseUrl = 'https://mashape-community-urban-dictionary.p.rapidapi.com/define?term=';
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

const rapidapiwordoptions = {
    method: 'GET',
    headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'random-word-api.p.rapidapi.com'
    }
};
const rapidapidefoptions = {
    method: 'GET',
    headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'mashape-community-urban-dictionary.p.rapidapi.com'
    }
};
const { checkIP } = require('../utils/accessData.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const { createCustomer } = require('./postHashData.js');

// @desc    Get Data
// @route   GET /api/data
// @access  Private
const getHashData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
    } catch (error) {
        console.log('Error in checkIP:', error);
        // Continue anyway - don't fail the request for IP checking
    }
    
    console.log('getHashData called');
    console.log('req.user:', req.user);
    console.log('req.query:', req.query);
    
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    if (!req.query || !req.query.data) {
        res.status(400);
        throw new Error('Invalid request query parameter');
    }

    let data;
    let dataSearchString;
    try {
        // Try to parse as JSON first
        data = JSON.parse(req.query.data);
        console.log('Parsed query data as JSON:', data);
        dataSearchString = data.text;
    } catch (error) {
        // If JSON parsing fails, treat as plain string
        console.log('Query data is not JSON, treating as plain string:', req.query.data);
        dataSearchString = req.query.data;
    }

    if (!dataSearchString) {
        res.status(400);
        throw new Error('Invalid request query parameter - no search string found');
    }

    try {
        // Use the search string as provided by the client (case-sensitive)
        console.log('dataSearchString:', dataSearchString);
        
        // Use the user ID with its original casing
        const userSearchString = `Creator:${req.user.id}`; 
        console.log('userSearchString:', userSearchString);
        var randomWord = "";

        if (dataSearchString.startsWith("getword:")) { // Check if dataSearchString is "getword"
            const wordLength = dataSearchString.substring(8); // returns "5" before a user modifies it to other custom numbers
            const ranwordapiurl = `${wordBaseUrl}${wordLength}`;
            const response = await fetch(ranwordapiurl, rapidapiwordoptions);
            if (!response.ok) {
                throw new Error('Failed to fetch random word from rapidapi.');
            }
            const data = await response.json();
            randomWord = data.word.toLowerCase(); // Convert to lowercase - this is specific to the word API
            res.status(200).json({ word: randomWord }); // Return the random word

        } else if (dataSearchString.startsWith("getdef:")) { // Handle "getdef:" request
            const word = dataSearchString.substring(7); // Extract the word from dataSearchString
            const defUrl = `${defBaseUrl}${word}`;

            const response = await fetch(defUrl, rapidapidefoptions);
            if (!response.ok) {
                throw new Error('Failed to fetch definition from rapidapi');
            }
            const data = await response.json();
            
            // Clean up and format the definitions
            let definitions = [];
            if (data.list && data.list.length > 0) {
                // Take up to 3 definitions and clean them
                for (let i = 0; i < Math.min(3, data.list.length); i++) {
                    if (data.list[i] && data.list[i].definition) {
                        let def = data.list[i].definition
                            .replace(/\[|\]/g, '') // Remove brackets
                            .replace(/\r\n/g, ' ') // Replace line breaks
                            .replace(/\s+/g, ' ')  // Replace multiple spaces
                            .trim();
                        
                        if (def && def.length > 0) {
                            definitions.push(`${i + 1}. ${def}`);
                        }
                    }
                }
            }
            
            const definition = definitions.length > 0 
                ? definitions.join(' | ') 
                : 'Definition not available.';
                
            res.status(200).json({ worddef: definition }); // Return the definition

        } else { // Handle database search requests
            try {
                console.log('dataSearchString:', dataSearchString);
                // Check if the search string looks like a direct ID (32 hex characters)
                const isDirectId = /^[a-f0-9]{32}$/i.test(dataSearchString);
                console.log('isDirectId:', isDirectId);
                
                if (isDirectId) {
                    console.log('Searching for direct ID:', dataSearchString);
                    // Use scan with filter like auth middleware does
                    const params = {
                        TableName: 'Simple',
                        FilterExpression: "id = :searchId",
                        ExpressionAttributeValues: {
                            ":searchId": dataSearchString
                        }
                    };

                    console.log('DynamoDB scan params:', params);
                    const result = await dynamodb.scan(params).promise();
                    console.log('DynamoDB scan result:', JSON.stringify(result).substring(0, 100) + '...');

                    if (result.Items && result.Items.length > 0) {
                        const item = result.Items[0]; // Take the first match
                        // Check if this item belongs to the current user
                        const itemText = item.text || '';
                        const userSearchString = `Creator:${req.user.id}`;
                        console.log('Checking if item belongs to user:', userSearchString);
                        console.log('Item text:', itemText.length > 100 ? itemText.substring(0, 100) + '...' : itemText);
                        
                        if (itemText.includes(userSearchString)) {
                            console.log('Item belongs to user, returning data');
                            res.status(200).json({
                                data: [{
                                    data: item.text, // Return the text content as the data field
                                    ActionGroup: item.ActionGroup,
                                    files: item.files,
                                    updatedAt: item.updatedAt,
                                    createdAt: item.createdAt,
                                    __v: null,
                                    _id: item.id,
                                }]
                            });
                        } else {
                            // Item exists but doesn't belong to this user
                            console.log('Item does not belong to user');
                            res.status(200).json({ data: [] }); // Return empty array instead of 403
                        }
                    } else {
                        // Item not found
                        console.log('Item not found');
                        res.status(200).json({ data: [] });
                    }
                } else {
                    // Search for data containing the search string (original behavior)
                    console.log('Searching for text containing:', dataSearchString);
                    // Construct filter expressions for DynamoDB
                    let filterExpressions = [];
                    let expressionAttributeValues = {};
                    let expressionAttributeNames = {};

                    // Add filter for user ID
                    filterExpressions.push('contains(#text, :userId)');
                    expressionAttributeValues[':userId'] = `Creator:${req.user.id}`; // Uses original case user ID
                    expressionAttributeNames['#text'] = 'text';

                    // Add filter for search string
                    filterExpressions.push('contains(#text, :searchString)');
                    expressionAttributeValues[':searchString'] = dataSearchString; // Uses original case search string

                    const params = {
                        TableName: 'Simple',
                        FilterExpression: filterExpressions.join(' AND '),
                        ExpressionAttributeValues: expressionAttributeValues,
                        ExpressionAttributeNames: expressionAttributeNames
                    };

                    const result = await dynamodb.scan(params).promise();

                    res.status(200).json({
                        data: result.Items.map(item => ({
                            data: item.text, // Return the text content as the data field
                            ActionGroup: item.ActionGroup,
                            files: item.files,
                            updatedAt: item.updatedAt,
                            createdAt: item.createdAt,
                            __v: null, // Not applicable for DynamoDB
                            _id: item.id,
                        }))
                    });
                }
            } catch (error) {
                console.error("Error fetching data from DynamoDB:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({
            error: req.query.data,
            input: req.query.data,
            output: randomWord,
            errorMessage: error.message
        });
    }
});

// GET: Fetch previous payment methods
const getPaymentMethods = asyncHandler(async (req, res, next) => {
    try {
        console.log('getPaymentMethods called with fromPutHashData:', (req.fromPutHashData ? 'true' : 'false'));
        
        if (!req.user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (!req.user.data.text.includes("|stripeid:")) {
            try {
                // Create a new customer if the customer ID is not found
                const customer = await createCustomer({
                    body: {
                        email: req.user.data.text.substring(req.user.data.text.indexOf('Email:') + 6,
                            req.user.data.text.indexOf('.com|') + 4),
                        name: req.user.data.text.substring(req.user.data.text.indexOf('Nickname:') + 9,
                            req.user.data.text.indexOf('|Email:')),
                    }
                }, res);

                // Update user data with the new customer ID
                req.user.data.text += `|stripeid:${customer.id}`;
                console.log(`|stripeid:${customer.id}`);
                await req.user.save();

                req.paymentMethods = [];
                if (req.fromPostHashData) {
                    return next();
                } else {
                    res.status(200).json({ message: 'Customer created and updated successfully', customer });
                    return;
                }
            } catch (error) {
                console.error('Customer creation failed:', error);
                res.status(500).json({ error: 'Customer creation failed' });
                return;
            }
        }

        // console.log('req.user.data.text:', req.user.data.text);

        const customerId = req.user.data.text.substring(req.user.data.text.indexOf('|stripeid:') + 10,
            req.user.data.text.indexOf('|stripeid:') + 28);
        console.log('Customer ID:', customerId);
        
        // Define all payment method types we want to fetch
        const paymentMethodTypes = ['card', 'link', 'cashapp'];
        let allPaymentMethods = [];
        
        // Fetch each payment method type
        for (const type of paymentMethodTypes) {
            try {
                console.log(`Fetching ${type} payment methods for customer: ${customerId}`);
                const methodsResponse = await stripe.paymentMethods.list({
                    customer: customerId,
                    limit: 10,
                    type: type,
                });
                
                if (methodsResponse.data && methodsResponse.data.length > 0) {
                    console.log(`Found ${methodsResponse.data.length} ${type} payment methods`);
                    allPaymentMethods = [...allPaymentMethods, ...methodsResponse.data];
                }
            } catch (typeError) {
                console.error(`Error fetching ${type} payment methods:`, typeError.message);
                // Continue with other types even if one fails
            }
        }
        
        console.log('Total payment methods found:', allPaymentMethods.length);
        req.paymentMethods = allPaymentMethods;
        
        if (req.fromPutHashData) {
            console.log('Returning next from GetHashData.GetPaymentMethods with payment methods count:', allPaymentMethods.length);
            return next();
        } else {
            console.log('Returning payment methods from GetHashData.GetPaymentMethods ...');
            console.log('Payment methods:', allPaymentMethods);
            res.status(200).json(allPaymentMethods);
        }
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        if (req.fromPostHashData || req.fromPutHashData) {
            return next(error);
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const getAllData = async (req, res) => {
    try {
        console.log('getAllData called. req.body:', req.body, 'req.user:', req.user);
        // Check if the user is an admin
        if (req.user && req.user.id === process.env.ADMIN_USER_ID) {
            // console.log('Fetching all data from DynamoDB...');

            const params = {
                TableName: 'Simple',
        };

            const result = await dynamodb.scan(params).promise();

            res.status(200).json(result.Items.map(item => ({
                id: item.id,
                text: item.text,
                files: item.files ? item.files.map(f => f.filename).join(', ') : "",
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            })));
        } else {
            console.error("Error: User is not an admin.");
            res.status(403).json({ message: 'Access denied. Admins only.' });
        }
    } catch (error) {
        console.error("Error fetching all data from DynamoDB:", error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getHashData, getPaymentMethods, getAllData };