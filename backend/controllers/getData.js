require('dotenv').config();
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const fetch = require('node-fetch');
const Data = require('../models/dataModel');
const wordBaseUrl = 'https://random-word-api.p.rapidapi.com/L/';
const defBaseUrl = 'https://mashape-community-urban-dictionary.p.rapidapi.com/define?term=';
const { ObjectId } = require('mongoose').Types;
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

        const searchConditions = [
            {
                $or: [
                    { 'data.text': { $regex: "\\|Public:true", $options: 'i' } },
                ]
            },
            {
                $or: [
                    { 'data.text': { $regex: dataSearchString, $options: 'i' } },
                ]
            }
        ];
        
        if (ObjectId.isValid(dataSearchString)) {
            searchConditions[1].$or.push({ _id: ObjectId(dataSearchString) });
        }
        
        const dataList = await Data.find({ $and: searchConditions });

        res.status(200).json({
            data: dataList.map((data) => ({
                data: data.data,
                files: data.files,
                updatedAt: data.updatedAt,
                createdAt: data.createdAt,
                __v: data.__v,
                _id: data._id,
                ActionGroup: data.ActionGroup // ← Added
            }))
        });    } catch (error) {
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

    try {
        // Extract customer ID using regex for more reliability
        const stripeIdMatch = req.user.data.text.match(/\|stripeid:([^|]+)/);
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