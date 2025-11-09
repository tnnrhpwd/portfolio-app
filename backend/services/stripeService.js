const stripe = require('stripe')(process.env.STRIPE_KEY);
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendEmail } = require('./emailService.js');
const Data = require('../models/dataModel');

/**
 * Extract customer ID from user text
 * @param {string} userText - User text containing stripeid
 * @returns {string|null} Customer ID or null
 */
function extractCustomerId(userText) {
    const stripeIdMatch = userText.match(/\|stripeid:([^|]+)/);
    if (!stripeIdMatch || !stripeIdMatch[1]) {
        return null;
    }
    return stripeIdMatch[1].trim();
}

/**
 * Extract email from user text
 * @param {string} userText - User text containing email
 * @returns {string|null} Email or null
 */
function extractEmail(userText) {
    const emailMatch = userText.match(/Email:([^|]+)/);
    if (!emailMatch || !emailMatch[1]) {
        return null;
    }
    return emailMatch[1].trim();
}

/**
 * Extract name from user text
 * @param {string} userText - User text containing nickname
 * @returns {string} Name or 'Unknown'
 */
function extractName(userText) {
    const nameMatch = userText.match(/Nickname:([^|]*)/);
    return nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown';
}

/**
 * Validate or recover Stripe customer ID
 * @param {string} customerId - Customer ID to validate
 * @param {string} email - User email for recovery
 * @param {string} name - User name for recovery
 * @returns {Object} Validated customer object
 */
async function validateOrRecoverCustomer(customerId, email, name) {
    try {
        const customer = await stripe.customers.retrieve(customerId);
        console.log('Customer ID validated successfully');
        return customer;
    } catch (stripeError) {
        console.log(`Invalid Stripe customer ID ${customerId}, attempting recovery...`);
        
        // Search for existing customer by email
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });
        
        if (existingCustomers.data.length > 0) {
            console.log('Found existing Stripe customer by email:', existingCustomers.data[0].id);
            return existingCustomers.data[0];
        } else {
            // Create new customer
            const newCustomer = await stripe.customers.create({ email, name });
            console.log('Created new Stripe customer:', newCustomer.id);
            return newCustomer;
        }
    }
}

/**
 * Update user's Stripe customer ID in database
 * @param {Object} dynamodb - DynamoDB client
 * @param {Object} user - User object
 * @param {string} customerId - New customer ID
 */
async function updateUserCustomerId(dynamodb, user, customerId) {
    const updatedUserData = user.text.replace(/\|stripeid:([^|]*)/, `|stripeid:${customerId}`);
    
    console.log('Updating user data with customer ID:', customerId);
    
    const putParams = {
        TableName: 'Simple',
        Item: {
            ...user,
            text: updatedUserData,
            updatedAt: new Date().toISOString()
        }
    };
    
    await dynamodb.send(new PutCommand(putParams));
    console.log('User data updated with Stripe customer ID');
}

/**
 * Create or validate Stripe customer
 * @param {Object} req - Express request object
 * @param {Object} dynamodb - DynamoDB client
 * @returns {Object} Customer object and message
 */
async function createOrValidateCustomer(req, dynamodb) {
    const { email, name } = req.body;
    const userData = req.user.text;
    
    let customer;
    const existingStripeId = extractCustomerId(userData);
    
    // If user has a Stripe ID, validate it against Stripe
    if (existingStripeId && existingStripeId !== '') {
        try {
            console.log('Validating existing Stripe customer ID:', existingStripeId);
            const existingCustomer = await stripe.customers.retrieve(existingStripeId);
            
            if (existingCustomer.email === email) {
                console.log('Existing Stripe customer ID is valid and email matches');
                customer = existingCustomer;
            } else {
                console.log(`Email mismatch: DB has ${existingStripeId} with email ${existingCustomer.email}, but user email is ${email}`);
                customer = null;
            }
        } catch (stripeError) {
            console.log(`Stripe customer ID ${existingStripeId} is invalid or deleted:`, stripeError.message);
            customer = null;
        }
    }
    
    // If no valid customer found yet, search by email or create new one
    if (!customer) {
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });
        
        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            console.log('Found existing Stripe customer by email:', customer.id, 'for email:', email);
            
            if (existingStripeId && existingStripeId !== customer.id) {
                console.log(`Correcting customer ID mismatch: ${existingStripeId} -> ${customer.id}`);
            }
        } else {
            customer = await stripe.customers.create({ email, name });
            console.log('Created new Stripe customer:', customer.id, 'for email:', email);
            
            if (existingStripeId) {
                console.log(`Replacing invalid customer ID: ${existingStripeId} -> ${customer.id}`);
            }
        }
    }
    
    // Update user's stripeid in the database
    await updateUserCustomerId(dynamodb, req.user, customer.id);
    
    // Determine response message
    let responseMessage;
    if (existingStripeId && existingStripeId === customer.id) {
        responseMessage = 'Existing customer ID validated successfully';
    } else if (existingStripeId && existingStripeId !== customer.id) {
        responseMessage = 'Customer ID corrected and updated in database';
    } else {
        responseMessage = 'Customer found/created and assigned to user';
    }
    
    return { customer, message: responseMessage };
}

/**
 * Attach payment method to customer
 * @param {string} paymentMethodId - Payment method ID
 * @param {string} customerId - Customer ID
 * @returns {Object} Payment method object
 */
async function attachPaymentMethod(paymentMethodId, customerId) {
    await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
    });
    
    await stripe.customers.update(customerId, {
        invoice_settings: {
            default_payment_method: paymentMethodId,
        },
    });
    
    return await stripe.paymentMethods.retrieve(paymentMethodId);
}

/**
 * Create setup intent for customer
 * @param {string} customerId - Customer ID
 * @returns {Object} Setup intent object
 */
async function createSetupIntent(customerId) {
    console.log('Creating setup intent for customer:', customerId);
    
    const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['link', 'card', 'cashapp'],
        usage: 'off_session',
    });
    
    console.log('Setup intent created successfully:', setupIntent.id);
    return setupIntent;
}

/**
 * Create invoice for customer
 * @param {string} customerId - Customer ID
 * @param {number} amount - Amount in cents
 * @param {string} description - Invoice description
 * @returns {Object} Invoice object
 */
async function createInvoice(customerId, amount, description) {
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
    
    return invoice;
}

/**
 * Update user rank in database
 * @param {string} customerId - Customer ID
 * @param {string} rank - New rank
 * @returns {boolean} Success status
 */
async function updateUserRank(customerId, rank) {
    try {
        const formattedRank = rank.charAt(0).toUpperCase() + rank.slice(1).toLowerCase();
        console.log(`Updating user rank to: ${formattedRank}`);
        
        const userData = await Data.findOne({
            'data.text': { $regex: `Email:.*\\|Password:.*\\|stripeid:${customerId}`, $options: 'i' }
        });
        
        if (!userData) {
            console.error(`No user profile data found for customer ID: ${customerId}`);
            return false;
        }
        
        console.log(`Found user profile data with ID: ${userData._id}`);
        
        let updatedText = userData.data.text;
        
        if (updatedText.includes('|Rank:')) {
            updatedText = updatedText.replace(/(\|Rank:)[^|]*/, `|Rank:${formattedRank}`);
        } else {
            updatedText += `|Rank:${formattedRank}`;
        }
        
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
}

/**
 * Get current membership type from Stripe subscriptions
 * @param {string} customerId - Customer ID
 * @returns {string} Current membership type
 */
async function getCurrentMembershipType(customerId) {
    const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20
    });
    
    console.log(`Found ${existingSubscriptions.data.length} existing subscriptions for customer`);
    
    let currentMembership = 'free';
    const activeSubscriptions = existingSubscriptions.data.filter(sub => 
        ['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)
    );
    
    if (activeSubscriptions.length > 0) {
        const productIds = [];
        for (const sub of activeSubscriptions) {
            if (sub.plan && sub.plan.product) {
                productIds.push(sub.plan.product);
            }
        }
        
        for (const productId of productIds) {
            try {
                const product = await stripe.products.retrieve(productId);
                console.log('Product found:', product.name);
                
                if (product.name === 'Simple Membership') {
                    currentMembership = 'flex';
                    break;
                } else if (product.name === 'CSimple Membership') {
                    currentMembership = 'premium';
                    break;
                }
            } catch (productError) {
                console.error(`Error fetching product ${productId}:`, productError.message);
            }
        }
    }
    
    return currentMembership;
}

/**
 * Cancel all active subscriptions for a customer
 * @param {string} customerId - Customer ID
 * @returns {boolean} Success status
 */
async function cancelActiveSubscriptions(customerId) {
    const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20
    });
    
    const activeSubscriptions = existingSubscriptions.data.filter(sub => 
        ['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)
    );
    
    if (activeSubscriptions.length > 0) {
        console.log(`Cancelling ${activeSubscriptions.length} active subscriptions`);
        
        for (const subscription of activeSubscriptions) {
            try {
                await stripe.subscriptions.cancel(subscription.id, { prorate: true });
                console.log(`Successfully cancelled subscription: ${subscription.id}`);
            } catch (cancelError) {
                console.error(`Error cancelling subscription ${subscription.id}: ${cancelError.message}`);
            }
        }
    }
    
    // Clean up expired subscriptions
    const expiredSubscriptions = existingSubscriptions.data.filter(sub => 
        sub.status === 'incomplete_expired'
    );
    
    if (expiredSubscriptions.length > 0) {
        console.log(`Cleaning up ${expiredSubscriptions.length} expired subscriptions`);
        for (const expSub of expiredSubscriptions) {
            try {
                await stripe.subscriptions.del(expSub.id);
                console.log(`Deleted expired subscription: ${expSub.id}`);
            } catch (delError) {
                console.error(`Error deleting subscription ${expSub.id}:`, delError.message);
            }
        }
    }
    
    return true;
}

/**
 * Get or create price ID for membership
 * @param {string} membershipType - Membership type
 * @param {number|null} customPrice - Custom price (optional)
 * @returns {string} Price ID
 */
async function getOrCreatePriceId(membershipType, customPrice = null) {
    let productName;
    if (membershipType === 'flex') {
        productName = 'Simple Membership';
    } else if (membershipType === 'premium') {
        productName = 'CSimple Membership';
    } else {
        throw new Error('Invalid membership type');
    }
    
    if ((membershipType === 'premium' || membershipType === 'flex') && customPrice) {
        console.log(`Creating custom price for ${membershipType}: $${customPrice}`);
        
        const products = await stripe.products.list({
            active: true,
            limit: 100
        });
        
        let product = products.data.find(p => p.name === productName);
        
        if (!product) {
            product = await stripe.products.create({
                name: productName,
                description: `${membershipType === 'premium' ? 'Premium' : 'Flex'} Membership with custom pricing`,
            });
            console.log(`Created ${membershipType} product: ${product.id}`);
        }
        
        const customPriceAmount = Math.round(parseFloat(customPrice) * 100);
        const billingInterval = membershipType === 'premium' ? 'year' : 'month';
        const dynamicPrice = await stripe.prices.create({
            product: product.id,
            unit_amount: customPriceAmount,
            currency: 'usd',
            recurring: { interval: billingInterval },
            nickname: `${membershipType === 'premium' ? 'Premium' : 'Flex'} Custom - $${customPrice}/${billingInterval}`
        });
        
        console.log(`Created custom price ID: ${dynamicPrice.id} for $${customPrice}/${billingInterval}`);
        return dynamicPrice.id;
    } else {
        // Use environment variables or look up existing price
        if (membershipType === 'flex' && process.env.STRIPE_FLEX_PRICE_ID) {
            return process.env.STRIPE_FLEX_PRICE_ID;
        } else if (membershipType === 'premium' && process.env.STRIPE_PREMIUM_PRICE_ID) {
            return process.env.STRIPE_PREMIUM_PRICE_ID;
        }
        
        const products = await stripe.products.list({
            active: true,
            limit: 100
        });
        
        const product = products.data.find(p => p.name === productName);
        
        if (!product) {
            throw new Error(`Membership product "${productName}" not found in Stripe`);
        }
        
        const prices = await stripe.prices.list({
            product: product.id,
            active: true
        });
        
        if (prices.data.length === 0) {
            throw new Error(`No pricing available for "${productName}"`);
        }
        
        console.log(`Using existing price ID: ${prices.data[0].id} for ${productName}`);
        return prices.data[0].id;
    }
}

/**
 * Create subscription for customer
 * @param {string} customerId - Customer ID
 * @param {string} priceId - Price ID
 * @returns {Object} Subscription object
 */
async function createSubscription(customerId, priceId) {
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
    
    return subscription;
}

module.exports = {
    stripe,
    extractCustomerId,
    extractEmail,
    extractName,
    validateOrRecoverCustomer,
    updateUserCustomerId,
    createOrValidateCustomer,
    attachPaymentMethod,
    createSetupIntent,
    createInvoice,
    updateUserRank,
    getCurrentMembershipType,
    cancelActiveSubscriptions,
    getOrCreatePriceId,
    createSubscription
};
