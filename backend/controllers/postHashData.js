// compressData.js

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const Data = require('../models/dataModel.js');
const { checkIP } = require('../utils/accessData.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
require('dotenv').config();
const openai = require('openai');
const openaikey = process.env.OPENAI_KEY;
const client = new openai({ apiKey: openaikey });

// @desc    Set data
// @route   POST /api/data
// @access  Private
const postHashData = asyncHandler(async (req, res) => {
    await checkIP(req);
    if (!req.user) {  // Check for user
      res.status(401)
      throw new Error('User not found')
    }
    if (!req.body) {
      res.status(400)
      throw new Error('Please add a data field. req: ' + JSON.stringify(req.body.data))
    }
    console.log('req.body.data: ', req.body.data)
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

    const datas = await Data.create({
        data: {
            text: typeof req.body.data === 'string' ? req.body.data : req.body.data.Text,
            ActionGroupObject: req.body.data.ActionGroupObject,
            files: files
        }
    });
    
    res.status(200).json(datas)
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

    const { paymentMethodId, membershipType, cancelAllSubscriptions } = req.body;
    console.log('Subscription request:', { membershipType, paymentMethodId, cancelAllSubscriptions });

    try {
        // Extract customer ID using regex for more reliability
        const stripeIdMatch = req.user.data.text.match(/\|stripeid:([^|]+)/);
        if (!stripeIdMatch || !stripeIdMatch[1]) {
            res.status(400);
            throw new Error('Invalid customer ID format');
        }
        
        const customerId = stripeIdMatch[1];

        // First, check for existing subscriptions
        const existingSubscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 10 // Increase if needed
        });

        // Check current subscription type
        let currentMembership = 'free';
        if (existingSubscriptions.data.length > 0) {
            const productIds = existingSubscriptions.data.map(sub => sub.plan.product);
            
            // Get product details to determine current subscription type
            if (productIds.length > 0) {
                const products = await stripe.products.list({
                    ids: productIds,
                    expand: ['data.name']
                });
                
                const productNames = products.data.map(p => p.name);
                if (productNames.includes('Flex Membership')) {
                    currentMembership = 'flex';
                } else if (productNames.includes('Premium Membership')) {
                    currentMembership = 'premium';
                }
            }
        }
        
        // If user is trying to subscribe to their current plan, prevent it
        if (membershipType === currentMembership && !cancelAllSubscriptions) {
            res.status(400);
            throw new Error(`You are already subscribed to the ${membershipType} plan`);
        }
        
        // Cancel existing subscriptions regardless of which plan they're switching to
        if (existingSubscriptions.data.length > 0) {
            console.log(`Cancelling ${existingSubscriptions.data.length} existing subscriptions`);
            
            // Cancel each subscription
            for (const subscription of existingSubscriptions.data) {
                await stripe.subscriptions.cancel(subscription.id, {
                    prorate: true // Prorate the amount
                });
                console.log(`Cancelled subscription: ${subscription.id}`);
            }
        }

        // Handle free membership type by updating user data
        if (membershipType === 'free') {
            // Update user data with free subscription status
            let updatedUserText = req.user.data.text;
            
            // Update the Rank field if it exists
            if (updatedUserText.includes('|Rank:')) {
                updatedUserText = updatedUserText.replace(/(\|Rank:)[^|]*/, '|Rank:Free');
            } else {
                // Add Rank field if it doesn't exist
                updatedUserText += '|Rank:Free';
            }
            
            // Update the user document
            req.user.data.text = updatedUserText;
            await req.user.save();
            
            // For free tier, return success after canceling subscriptions
            res.status(200).json({ 
                success: true, 
                membershipType: 'free',
                message: 'Successfully switched to free plan'
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

        res.status(200).json({
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
            membershipType: membershipType,
            productName: productName
        });
    } catch (error) {
        console.error('Error creating subscription:', error);
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