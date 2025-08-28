require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// @desc    Get Public Data
// @route   GET /api/publicdata
// @access  Public
const getData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
    } catch (error) {
        console.log('Error in checkIP:', error);
        // Continue anyway - don't fail the request for IP checking
    }
    
    console.log('getData (public) called with query:', req.query);
    
    if (!req.query || !req.query.data) {
        console.log('Missing query or data parameter');
        res.status(400);
        throw new Error('Invalid request query parameter');
    }

    let data;
    try {
        data = JSON.parse(req.query.data);
        console.log('Parsed data:', data);
    } catch (error) {
        console.log('Error parsing query data:', error);
        res.status(400);
        throw new Error('Invalid request query parameter parsing');
    }

    if (!data.text) {
        console.log('Missing text field in parsed data');
        res.status(400);
        throw new Error('Invalid request query parameter parsed data');
    }

    try {
        const dataSearchString = data.text;
        console.log('Searching for ID:', dataSearchString);

        // Use scan with filter like auth middleware does
        const params = {
            TableName: 'Simple',
            FilterExpression: "id = :searchId",
            ExpressionAttributeValues: {
                ":searchId": dataSearchString
            }
        };

        console.log('DynamoDB scan params:', JSON.stringify(params, null, 2));
        const result = await dynamodb.send(new ScanCommand(params));
        console.log('DynamoDB result:', result);

        // Convert to expected frontend format
        const responseData = result.Items && result.Items.length > 0 ? [{
            data: result.Items[0].text, // Return the text content as the data field
            ActionGroup: result.Items[0].ActionGroup,
            files: result.Items[0].files,
            updatedAt: result.Items[0].updatedAt,
            createdAt: result.Items[0].createdAt,
            __v: null,
            _id: result.Items[0].id,
        }] : [];
        console.log('Response data:', responseData);

        res.status(200).json({
            data: responseData
        });
    } catch (error) {
        console.error("Error fetching public data:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// @desc    Get user subscription information
// @route   GET /api/user/subscription
// @access  Private
const getUserSubscription = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    // Check for user
    if (!req.user) {
        console.log('getUserSubscription: No user found in request');
        res.status(401);
        throw new Error('User not found');
    }
    
    console.log('getUserSubscription called for user ID:', req.user.id);

    try {
        // Extract customer ID using regex for more reliability
        // Make sure we're accessing the text field properly based on DynamoDB structure
        const userText = req.user.text || '';
        console.log('User text:', userText);
        
        const stripeIdMatch = userText.match(/\|stripeid:([^|]+)/);
        console.log('stripeIdMatch:', stripeIdMatch);
        if (!stripeIdMatch || !stripeIdMatch[1]) {
            // No Stripe ID means they're on free plan
            console.log('No Stripe ID found');
            return res.status(200).json({ 
                subscriptionPlan: 'Free',
                subscriptionDetails: null 
            });
        }
        
        const customerId = stripeIdMatch[1];
        console.log('Customer ID:', customerId);
        
        // Get only active and relevant in-progress subscriptions
        // This includes active, trialing, past_due, and incomplete subscriptions
        const activeSubscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 5,
            expand: ['data.plan.product']
        });
        
        const incompleteSubscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'incomplete',
            limit: 5,
            expand: ['data.plan.product']
        });
        
        console.log(`Found ${activeSubscriptions.data.length} active and ${incompleteSubscriptions.data.length} incomplete subscriptions`);
        
        // Combine and sort all relevant subscriptions by created date (newest first)
        const allRelevantSubscriptions = [
            ...activeSubscriptions.data,
            ...incompleteSubscriptions.data
        ].sort((a, b) => b.created - a.created);

        if (allRelevantSubscriptions.length === 0) {
            console.log('No active subscriptions found');
            // No active subscriptions means they're on free plan
            return res.status(200).json({ 
                subscriptionPlan: 'Free',
                subscriptionDetails: null 
            });
        }

        // Get the most recent subscription
        const subscription = allRelevantSubscriptions[0];
        
        // Get the product name to determine subscription type
        const productName = subscription.plan.product.name;
        console.log('Subscription product name:', productName);
        let subscriptionPlan = 'Free';
        if (productName === 'Flex Membership') {
            subscriptionPlan = 'Flex';
        } else if (productName === 'Premium Membership') {
            subscriptionPlan = 'Premium';
        }
        console.log('Subscription plan:', subscriptionPlan);
        
        // Return subscription details
        res.status(200).json({
            subscriptionPlan,
            subscriptionDetails: {
                id: subscription.id,
                status: subscription.status,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                productName: productName,
                priceId: subscription.plan.id,
                amount: subscription.plan.amount,
                currency: subscription.plan.currency,
                interval: subscription.plan.interval
            }
        });
    } catch (error) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch subscription information' });
    }
});

module.exports = { getData, getUserSubscription };