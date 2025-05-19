// compressData.js

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { json } = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_KEY);
require('dotenv').config();
const openaikey = process.env.OPENAI_KEY;
let client; // Define client outside the asyncHandler

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
    console.log('req.body: ', JSON.stringify(req.body));
    await checkIP(req);
    console.log('req.body:')
    // console.log('req.body.data: ', json.stringify(req.body));

    if (!req.user) {  // Check for user
      res.status(401)
      throw new Error('User not found')
    }
    // console.log('req.body: ', json.stringify(req.body));
    // Check if req.body exists
    if (!req.body) {
        res.status(400);
        throw new Error('Request body is missing');
    }

    // Check if req.body.data exists
    if (!req.body.data) {
        res.status(400);
        throw new Error('Please add a data field. req: ' + JSON.stringify(req.body));
    }

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

    let text;
    if (typeof req.body.data === 'string') {
        text = req.body.data;
    } else if (req.body.data.Text) {
        text = req.body.data.Text;
    } else {
        console.log('req.body.data:', req.body.data);
        res.status(400);
        throw new Error('Invalid data format.  Missing Text property.  req.body.data: ' + JSON.stringify(req.body.data));
    }

    const params = {
        TableName: 'Simple',
        Item: {
            id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
            text: `Creator:${req.user.id}|` + text,
            ActionGroupObject: req.body.data.ActionGroupObject,
            files: files,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };

    try {
        await dynamodb.put(params).promise();
        res.status(200).json(params.Item); // Return the created item
    } catch (error) {
        console.error('Error creating data:', error);
        res.status(500).json({ error: 'Failed to create data' });
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

    // Check for user
    if (req.user.data && req.user.data.text && typeof req.user.data.text === 'string' && !req.user.data.text.includes("tnnrhpwd@gmail.com")) {
        res.status(401)
        throw new Error('Only admin are authorized to utilize the API at this time.' + req.user.data.text)
    }

    const parsedJSON = JSON.parse(req.body.data);
    console.log('Request body:', parsedJSON); // Log the request body

    const itemID = parsedJSON._id; // Get the ID from the query string.

    const contextInput = parsedJSON.data.text; // Get context input from the query string.
    console.log('Context input:', contextInput); // Log the context input

    if (typeof contextInput !== 'string') { 
        throw new Error('Data input invalid')
    }

    const netIndex = contextInput.includes('Net:') ? contextInput.indexOf('Net:'): 0; 
    const userInput = netIndex>0 ? contextInput.substring(netIndex + 4): contextInput;

    console.log('User input:', userInput); // Log the user input

    try {
        if (!client) {
            await initializeOpenAI();
        }
        const response = await client.chat.completions.create({
          model: 'o1-mini', // Use the o1-mini model
          messages: [{ role: 'user', content: userInput }],
          max_completion_tokens: 1000, // Increase the max tokens to allow more complete responses
        });
        console.log('OpenAI response:', JSON.stringify(response)); // Log the OpenAI response
        // const response = { data: { choices: [ {text: "This is a simulated response for debugging purposes."} ] } };

        if (response.choices[0].message.content && response.choices[0].message.content.length > 0) {
            const compressedData = response.choices[0].message.content; // Extract the compressed data from the OpenAI response.
            const newData = "Creator:"+req.user._id+"|Net:"+userInput+"\n"+compressedData;

            // Check if the ID is a valid ObjectID
            if (itemID && itemID.match(/^[0-9a-fA-F]{24}$/)) {
                // Check if the ID exists in the database
                const existingData = await Data.findById(itemID);
                if (existingData) {
                    const updatedData = await Data.findByIdAndUpdate(itemID, { data: { text: newData } }, { new: true });
                    res.status(200).json({ data: [compressedData] });
                } else {
                    res.status(404).json({ error: 'Data not found' });
                }
            } else {
                // Create a new item if no valid itemID is provided
                const newItem = new Data({ data: { text: newData }, user: req.user._id });
                console.log('New item:', newItem);
                await newItem.save();
                res.status(201).json({ data: [compressedData] });
            }
        } else {
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
    try {
        const customer = await stripe.customers.create({ email, name });
        return customer;
    } catch (error) {
        console.error('Customer creation failed:', error);
        throw new Error('Customer creation failed');
    }
});

// POST: Create a setup intent or attach a payment method
const postPaymentMethod = asyncHandler(async (req, res) => {
    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    console.log('Request body:', req.body);
    console.log('req.user.data.text:', req.user.data.text);

    try {
        // Check if stripeid exists
        if (!req.user.data.text.includes('|stripeid:')) {
            res.status(400);
            throw new Error('No customer ID found. Please create a customer first.');
        }

        // Extract customer ID using regex for more reliability
        const stripeIdMatch = req.user.data.text.match(/\|stripeid:([^|]+)/);
        if (!stripeIdMatch || !stripeIdMatch[1]) {
            res.status(400);
            throw new Error('Invalid customer ID format');
        }
        
        const customerId = stripeIdMatch[1];
        console.log('Extracted Customer ID:', customerId);
        
        // Case 1: If paymentMethodId is provided (from Stripe.js on frontend), attach it to the customer
        if (req.body.paymentMethodId) {
            const paymentMethodId = req.body.paymentMethodId;
            
            // Attach the payment method to the customer
            await stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId,
            });
            
            // Set as default payment method
            await stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });
            
            const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
            res.status(200).json(paymentMethod);
        } 
        // Case 2: Create a setup intent for the frontend to use with Stripe Elements
        else {
            // Creating a setup intent with expanded payment_method types
            const setupIntent = await stripe.setupIntents.create({
                customer: customerId,
                // Support more payment methods - note that your Stripe account needs to be configured to accept these
                payment_method_types: [
                    'link',
                    'card', 
                    'cashapp', 
                ],
                usage: 'off_session',  // Allow future payments without customer present
                // Remove the problematic payment_method_options that was causing the error
            });
            
            // Return the full setup intent object (includes client_secret)
            res.status(200).json(setupIntent);
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

    const { paymentMethodId, membershipType } = req.body;
    console.log('Subscription request:', { membershipType, paymentMethodId });
    // Extract customer ID using regex for more reliability
    const stripeIdMatch = req.user.data.text.match(/\|stripeid:([^|]+)/);
    if (!stripeIdMatch || !stripeIdMatch[1]) {
        res.status(400);
        throw new Error('Invalid customer ID format');
    }
    
    const customerId = stripeIdMatch[1];
    console.log('Customer ID for subscription management:', customerId);

    // Extract user email for notifications
    const emailMatch = req.user.data.text.match(/Email:([^|]+)/);
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
                'data.text': { $regex: `Email:.*\\|Password:.*\\|stripeid:${customerId}`, $options: 'i' }
            });
            
            if (!userData) {
                console.error(`No user profile data found for customer ID: ${customerId}`);
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
            customer: customerId,
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
                    customer: customerId,
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

        // Find the price ID for the product
        let priceId;
        
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
        
        console.log(`Using price ID: ${priceId} for ${productName}`);

        // Create the subscription
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
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

        res.status(200).json({
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
            membershipType: membershipType,
            productName: productName
        });
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

module.exports = { postHashData, compressData, createCustomer, postPaymentMethod, createInvoice, subscribeCustomer, handleWebhook };