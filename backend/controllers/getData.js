require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { getUserStorageUsage } = require('../utils/storageTracker.js');
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
        
        // Validate that the customer ID exists in Stripe
        let validatedCustomer;
        let finalCustomerId = customerId; // Use a mutable variable for updates
        try {
            validatedCustomer = await stripe.customers.retrieve(customerId);
            console.log('Customer ID validated successfully for subscription check');
        } catch (stripeError) {
            console.error(`Invalid Stripe customer ID ${customerId} during subscription check:`, stripeError.message);
            
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
                // If customer ID is invalid and recovery fails, treat as free plan but log the issue
                console.log('Treating user as free plan due to failed recovery');
                return res.status(200).json({ 
                    subscriptionPlan: 'Free',
                    subscriptionDetails: null,
                    warning: 'Failed to validate or recover customer ID'
                });
            }
        }
        
        // Get only active and relevant in-progress subscriptions
        // This includes active, trialing, past_due, and incomplete subscriptions
        const activeSubscriptions = await stripe.subscriptions.list({
            customer: finalCustomerId,
            status: 'active',
            limit: 5,
            expand: ['data.plan.product']
        });
        
        const incompleteSubscriptions = await stripe.subscriptions.list({
            customer: finalCustomerId,
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

// @desc    Get user storage usage
// @route   GET /api/user/storage
// @access  Private
const getUserStorage = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    // Check for user
    if (!req.user) {
        console.log('getUserStorage: No user found in request');
        res.status(401);
        throw new Error('User not found');
    }
    
    console.log('getUserStorage called for user ID:', req.user.id);

    try {
        const storageData = await getUserStorageUsage(req.user.id);
        
        console.log(`getUserStorage: Returning storage data for user ${req.user.id}:`, {
            totalStorage: storageData.totalStorageFormatted,
            storageLimit: storageData.storageLimitFormatted,
            usage: `${storageData.storageUsagePercent.toFixed(1)}%`
        });
        
        res.status(200).json(storageData);
    } catch (error) {
        console.error('Error fetching storage usage:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch storage usage' });
    }
});

module.exports = { getData, getUserSubscription, getUserStorage };