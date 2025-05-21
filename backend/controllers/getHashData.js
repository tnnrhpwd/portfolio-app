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
    await checkIP(req);
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    if (!req.query || !req.query.data) {
        res.status(400);
        throw new Error('Invalid request query parameter');
    }

    let data;
    try {
        data = JSON.parse(req.query.data);
    } catch (error) {
        res.status(400);
        throw new Error('Invalid request query parameter parsing');
    }

    if (!data.text) {
        res.status(400);
        throw new Error('Invalid request query parameter parsed data');
    }

    try {
        // Use the search string as provided by the client (case-sensitive)
        const dataSearchString = data.text; 
        // Use the user ID with its original casing
        const userSearchString = `Creator:${req.user.id}`; 
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
            const definition = data.list[0].definition + data.list[1].definition + data.list[2].definition;
            res.status(200).json({ worddef: definition }); // Return the definition

        } else { // Handle database search requests
            try {
                // Construct filter expressions for DynamoDB
                let filterExpressions = [];
                let expressionAttributeValues = {};
                let expressionAttributeNames = {};

                // Add filter for user ID
                filterExpressions.push('contains(#text, :userId)');
                expressionAttributeValues[':userId'] = userSearchString; // Uses original case user ID
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
                        data: item,
                        ActionGroup: item.ActionGroup,
                        files: item.files,
                        updatedAt: item.updatedAt,
                        createdAt: item.createdAt,
                        __v: null, // Not applicable for DynamoDB
                        _id: item.id,
                    }))
                });
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