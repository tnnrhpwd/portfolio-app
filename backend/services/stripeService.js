const { getStripe, isTestMode, liveStripe } = require('../utils/stripeInstance');
// Default stripe instance for backward compat; per-request calls use getStripe(userId)
const stripe = liveStripe;
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { sendEmail } = require('./emailService.js');
const Data = require('../models/dataModel');
const { STRIPE_PRODUCT_IDS, PLAN_TO_STRIPE_PRODUCT, STRIPE_PRODUCT_MAP } = require('../constants/pricing');

// Cache for auto-created test-mode product/price IDs so they are only created once
const testPriceCache = {}; // e.g. { simple: 'price_xxx', pro: 'price_xxx' }

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
async function validateOrRecoverCustomer(customerId, email, name, userId) {
    const s = getStripe(userId);
    try {
        const customer = await s.customers.retrieve(customerId);
        console.log('Customer ID validated successfully');
        return customer;
    } catch (stripeError) {
        console.log(`Invalid Stripe customer ID ${customerId}, attempting recovery...`);
        
        // Search for existing customer by email
        const existingCustomers = await s.customers.list({
            email: email,
            limit: 1
        });
        
        if (existingCustomers.data.length > 0) {
            console.log('Found existing Stripe customer by email:', existingCustomers.data[0].id);
            return existingCustomers.data[0];
        } else {
            // Create new customer
            const newCustomer = await s.customers.create({ email, name });
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
    const userId = req.user.id;
    const s = getStripe(userId);
    
    let customer;
    const existingStripeId = extractCustomerId(userData);
    
    // If user has a Stripe ID, validate it against Stripe
    if (existingStripeId && existingStripeId !== '') {
        try {
            console.log('Validating existing Stripe customer ID:', existingStripeId);
            const existingCustomer = await s.customers.retrieve(existingStripeId);
            
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
        const existingCustomers = await s.customers.list({
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
            customer = await s.customers.create({ email, name });
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
async function attachPaymentMethod(paymentMethodId, customerId, userId) {
    const s = getStripe(userId);
    await s.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
    });
    
    await s.customers.update(customerId, {
        invoice_settings: {
            default_payment_method: paymentMethodId,
        },
    });
    
    return await s.paymentMethods.retrieve(paymentMethodId);
}

/**
 * Create setup intent for customer
 * @param {string} customerId - Customer ID
 * @returns {Object} Setup intent object
 */
async function createSetupIntent(customerId, userId) {
    const s = getStripe(userId);
    console.log('Creating setup intent for customer:', customerId);
    
    const setupIntent = await s.setupIntents.create({
        customer: customerId,
        automatic_payment_methods: { enabled: true },
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
async function createInvoice(customerId, amount, description, userId) {
    const s = getStripe(userId);
    await s.invoiceItems.create({
        customer: customerId,
        amount,
        currency: 'usd',
        description,
    });
    
    const invoice = await s.invoices.create({
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

        // Scan DynamoDB for the user record containing this stripeid
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient: DocClient, ScanCommand, PutCommand: PutCmd } = require('@aws-sdk/lib-dynamodb');
        const ddbClient = new DynamoDBClient({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
        const dynamodb = DocClient.from(ddbClient);

        const scanResult = await dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            FilterExpression: 'contains(#txt, :stripeid)',
            ExpressionAttributeNames: { '#txt': 'text' },
            ExpressionAttributeValues: { ':stripeid': `stripeid:${customerId}` }
        }));

        if (!scanResult.Items || scanResult.Items.length === 0) {
            console.error(`No user profile data found for customer ID: ${customerId}`);
            return false;
        }

        const userData = scanResult.Items[0];
        console.log(`Found user profile data with ID: ${userData.id}`);

        let updatedText = userData.text;

        if (updatedText.includes('|Rank:')) {
            updatedText = updatedText.replace(/(\|Rank:)[^|]*/, `|Rank:${formattedRank}`);
        } else {
            updatedText += `|Rank:${formattedRank}`;
        }

        await dynamodb.send(new PutCmd({
            TableName: 'Simple',
            Item: {
                ...userData,
                text: updatedText,
                updatedAt: new Date().toISOString()
            }
        }));

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
async function getCurrentMembershipType(customerId, userId) {
    const s = getStripe(userId);
    const testMode = isTestMode(userId);
    const existingSubscriptions = await s.subscriptions.list({
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
        for (const sub of activeSubscriptions) {
            const pid = sub.plan && sub.plan.product;
            // Live mode: direct ID lookup
            if (pid && STRIPE_PRODUCT_IDS[pid]) {
                currentMembership = STRIPE_PRODUCT_IDS[pid];
                console.log(`Product ${pid} matched plan: ${currentMembership}`);
                break;
            }
            // Test mode: look up product name to identify plan
            if (pid && testMode) {
                try {
                    const product = await s.products.retrieve(pid);
                    const planId = STRIPE_PRODUCT_MAP[product.name];
                    if (planId) {
                        currentMembership = planId;
                        console.log(`Test product "${product.name}" (${pid}) matched plan: ${currentMembership}`);
                        break;
                    }
                } catch (e) {
                    console.warn(`Could not retrieve test product ${pid}:`, e.message);
                }
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
async function cancelActiveSubscriptions(customerId, userId) {
    const s = getStripe(userId);
    const existingSubscriptions = await s.subscriptions.list({
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
                await s.subscriptions.cancel(subscription.id, { prorate: true });
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
                await s.subscriptions.cancel(expSub.id);
                console.log(`Cancelled expired subscription: ${expSub.id}`);
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
async function getOrCreatePriceId(membershipType, customPrice = null, userId) {
    const testMode = isTestMode(userId);

    // ── env-var overrides (test keys checked first when in test mode) ──
    if (testMode) {
        if (membershipType === 'pro' && process.env.TEST_STRIPE_PRO_PRICE_ID) {
            return process.env.TEST_STRIPE_PRO_PRICE_ID;
        } else if (membershipType === 'simple' && process.env.TEST_STRIPE_SIMPLE_PRICE_ID) {
            return process.env.TEST_STRIPE_SIMPLE_PRICE_ID;
        }
        // Check in-memory cache
        if (testPriceCache[membershipType]) {
            console.log(`Using cached test price for ${membershipType}: ${testPriceCache[membershipType]}`);
            return testPriceCache[membershipType];
        }
    } else {
        if (membershipType === 'pro' && process.env.STRIPE_PRO_PRICE_ID) {
            return process.env.STRIPE_PRO_PRICE_ID;
        } else if (membershipType === 'simple' && process.env.STRIPE_SIMPLE_PRICE_ID) {
            return process.env.STRIPE_SIMPLE_PRICE_ID;
        }
    }

    const s = getStripe(userId);

    // ── Live mode: look up by hardcoded product ID ──
    if (!testMode) {
        const productId = PLAN_TO_STRIPE_PRODUCT[membershipType];
        if (!productId) {
            throw new Error('Invalid membership type');
        }
        const prices = await s.prices.list({ product: productId, active: true, limit: 1 });
        if (prices.data.length === 0) {
            throw new Error(`No pricing available for product ${productId}`);
        }
        console.log(`Using price ID: ${prices.data[0].id} for ${membershipType} (${productId})`);
        return prices.data[0].id;
    }

    // ── Test mode: find or create product & price ──
    const productName = membershipType === 'pro' ? 'Pro Membership' : 'Simple Membership';
    const unitAmount  = membershipType === 'pro' ? 1200 : 3900; // cents

    // Search for existing test product by name
    const products = await s.products.list({ limit: 100, active: true });
    let testProduct = products.data.find(p => p.name === productName);

    if (!testProduct) {
        console.log(`Creating test product: ${productName}`);
        testProduct = await s.products.create({ name: productName });
    }

    // Look for an existing active recurring price on this product
    const prices = await s.prices.list({ product: testProduct.id, active: true, limit: 10 });
    let matchingPrice = prices.data.find(
        p => p.unit_amount === unitAmount && p.recurring?.interval === 'month'
    );

    if (!matchingPrice) {
        console.log(`Creating test price for ${productName}: $${unitAmount / 100}/month`);
        matchingPrice = await s.prices.create({
            product: testProduct.id,
            unit_amount: unitAmount,
            currency: 'usd',
            recurring: { interval: 'month' },
        });
    }

    console.log(`Using test price ID: ${matchingPrice.id} for ${membershipType} (${testProduct.id})`);
    testPriceCache[membershipType] = matchingPrice.id;
    return matchingPrice.id;
}

/**
 * Create subscription for customer
 * @param {string} customerId - Customer ID
 * @param {string} priceId - Price ID
 * @returns {Object} Subscription object
 */
async function createSubscription(customerId, priceId, userId) {
    const s = getStripe(userId);
    const subscription = await s.subscriptions.create({
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
