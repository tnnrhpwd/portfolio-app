require('dotenv').config();
const AWS = require('aws-sdk');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

// @desc    Get Public Data
// @route   GET /api/publicdata
// @access  Public
const getData = asyncHandler(async (req, res) => {
    await checkIP(req);
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
        const dataSearchString = data.text.toLowerCase();

        const params = {
            TableName: 'Simple',
            FilterExpression: "#text = :textValue",
            ExpressionAttributeNames: {
                "#text": "text"
            },
            ExpressionAttributeValues: {
                ':textValue': dataSearchString
            }
        };

        const result = await dynamodb.scan(params).promise();

        res.status(200).json({
            data: result.Items
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
        res.status(401);
        throw new Error('User not found');
    }
    console.log('calling getUserSubscriptions');
    console.log('User from request:', req.user);

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