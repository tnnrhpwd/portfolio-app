const { getStripe, isTestMode, liveStripe } = require('../utils/stripeInstance');
const crypto = require('crypto');
// Default stripe instance for backward compat; per-request calls use getStripe(userId)
const stripe = liveStripe;
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { sendEmail } = require('./emailService.js');
const Data = require('../models/dataModel');
const { STRIPE_PRODUCT_IDS, PLAN_TO_STRIPE_PRODUCT, STRIPE_PRODUCT_MAP } = require('../constants/pricing');
const { fetchRawUserRecord } = require('../utils/dynamoUser');

// Shared DynamoDB client — reused across all calls to avoid creating new clients each invocation
const _ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    maxAttempts: 3
});
const _dynamodb = DynamoDBDocumentClient.from(_ddbClient);
const { logger } = require('../utils/logger');

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
        logger.debug('Customer ID validated successfully');
        return customer;
    } catch (stripeError) {
        logger.debug(`Invalid Stripe customer ID ${customerId}, attempting recovery...`);
        
        // Search for existing customer by email
        const existingCustomers = await s.customers.list({
            email: email,
            limit: 1
        });
        
        if (existingCustomers.data.length > 0) {
            logger.debug('Found existing Stripe customer by email:', existingCustomers.data[0].id);
            return existingCustomers.data[0];
        } else {
            // Create new customer
            const newCustomer = await s.customers.create({ email, name });
            logger.debug('Created new Stripe customer:', newCustomer.id);
            return newCustomer;
        }
    }
}

/**
 * Update user's Stripe customer ID in database
 * @param {Object} dynamodb - DynamoDB client
 * @param {Object} user - User object (may be the REDACTED req.user copy)
 * @param {string} customerId - New customer ID
 */
async function updateUserCustomerId(dynamodb, user, customerId) {
    // `user` is usually req.user, whose `text` has the password hash redacted
    // to "[redacted]". Writing that back would destroy the real hash, so
    // always re-fetch the raw record before mutating it.
    const rawUser = (await fetchRawUserRecord(dynamodb, user.id)) || user;
    const updatedUserData = rawUser.text.replace(/\|stripeid:([^|]*)/, `|stripeid:${customerId}`);

    logger.debug('Updating user data with customer ID:', customerId);

    const putParams = {
        TableName: 'Simple',
        Item: {
            ...rawUser,
            text: updatedUserData,
            updatedAt: new Date().toISOString()
        }
    };

    await dynamodb.send(new PutCommand(putParams));
    logger.debug('User data updated with Stripe customer ID');
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
            logger.debug('Validating existing Stripe customer ID:', existingStripeId);
            const existingCustomer = await s.customers.retrieve(existingStripeId);
            
            if (existingCustomer.email === email) {
                logger.debug('Existing Stripe customer ID is valid and email matches');
                customer = existingCustomer;
            } else {
                logger.debug(`Email mismatch: DB has ${existingStripeId} with email ${existingCustomer.email}, but user email is ${email}`);
                customer = null;
            }
        } catch (stripeError) {
            logger.debug(`Stripe customer ID ${existingStripeId} is invalid or deleted:`, stripeError.message);
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
            logger.debug('Found existing Stripe customer by email:', customer.id, 'for email:', email);
            
            if (existingStripeId && existingStripeId !== customer.id) {
                logger.debug(`Correcting customer ID mismatch: ${existingStripeId} -> ${customer.id}`);
            }
        } else {
            const idempotencyKey = crypto.randomUUID();
            customer = await s.customers.create({ email, name }, { idempotencyKey });
            logger.debug('Created new Stripe customer:', customer.id, 'for email:', email);
            
            if (existingStripeId) {
                logger.debug(`Replacing invalid customer ID: ${existingStripeId} -> ${customer.id}`);
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
    logger.debug('Creating setup intent for customer:', customerId);
    
    const setupIntent = await s.setupIntents.create({
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        usage: 'on_session',
    });
    
    logger.debug('Setup intent created successfully:', setupIntent.id);
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
    const idempotencyKey = `inv_${customerId}_${amount}_${Date.now()}`;
    await s.invoiceItems.create({
        customer: customerId,
        amount,
        currency: 'usd',
        description,
    }, { idempotencyKey: `${idempotencyKey}_item` });
    
    const invoice = await s.invoices.create({
        customer: customerId,
        auto_advance: true,
    }, { idempotencyKey });
    
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
        logger.debug(`Updating user rank to: ${formattedRank}`);

        // Use the shared DynamoDB client instead of creating a new one each call
        // Note: This is still a full-table scan filtered by stripeid.
        // TODO: Add a GSI on the stripeid field for O(1) lookups.
        const scanResult = await _dynamodb.send(new ScanCommand({
            TableName: 'Simple',
            FilterExpression: 'contains(#txt, :stripeid)',
            ExpressionAttributeNames: { '#txt': 'text' },
            ExpressionAttributeValues: { ':stripeid': `stripeid:${customerId}` }
        }));

        if (!scanResult.Items || scanResult.Items.length === 0) {
            logger.error(`No user profile data found for customer ID: ${customerId}`);
            return false;
        }

        const userData = scanResult.Items[0];
        logger.debug(`Found user profile data with ID: ${userData.id}`);

        let updatedText = userData.text;

        if (updatedText.includes('|Rank:')) {
            updatedText = updatedText.replace(/(\|Rank:)[^|]*/, `|Rank:${formattedRank}`);
        } else {
            updatedText += `|Rank:${formattedRank}`;
        }

        await _dynamodb.send(new PutCommand({
            TableName: 'Simple',
            Item: {
                ...userData,
                text: updatedText,
                updatedAt: new Date().toISOString()
            }
        }));

        logger.debug('Successfully updated user rank in database');
        return true;
    } catch (error) {
        logger.error('Error updating user rank:', error);
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
    
    logger.debug(`Found ${existingSubscriptions.data.length} existing subscriptions for customer`);
    
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
                logger.debug(`Product ${pid} matched plan: ${currentMembership}`);
                break;
            }
            // Test mode: look up product name to identify plan
            if (pid && testMode) {
                try {
                    const product = await s.products.retrieve(pid);
                    const planId = STRIPE_PRODUCT_MAP[product.name];
                    if (planId) {
                        currentMembership = planId;
                        logger.debug(`Test product "${product.name}" (${pid}) matched plan: ${currentMembership}`);
                        break;
                    }
                } catch (e) {
                    logger.warn(`Could not retrieve test product ${pid}:`, e.message);
                }
            }
        }
    }
    
    return currentMembership;
}

/**
 * List all active (non-cancelled) subscriptions for a customer.
 * Shared by getCurrentMembershipType, cancelActiveSubscriptions, and the
 * deferred-cancellation / reactivation paths below.
 * @param {string} customerId - Customer ID
 * @param {string} userId - User ID (selects test vs live Stripe instance)
 * @returns {Promise<Array>} Active subscription objects
 */
async function listActiveSubscriptions(customerId, userId) {
    const s = getStripe(userId);
    const existingSubscriptions = await s.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20
    });
    return existingSubscriptions.data.filter(sub =>
        ['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)
    );
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
        logger.debug(`Cancelling ${activeSubscriptions.length} active subscriptions`);
        
        for (const subscription of activeSubscriptions) {
            try {
                await s.subscriptions.cancel(subscription.id, { prorate: true });
                logger.debug(`Successfully cancelled subscription: ${subscription.id}`);
            } catch (cancelError) {
                logger.error(`Error cancelling subscription ${subscription.id}: ${cancelError.message}`);
            }
        }
    }
    
    // Clean up expired subscriptions
    const expiredSubscriptions = existingSubscriptions.data.filter(sub => 
        sub.status === 'incomplete_expired'
    );
    
    if (expiredSubscriptions.length > 0) {
        logger.debug(`Cleaning up ${expiredSubscriptions.length} expired subscriptions`);
        for (const expSub of expiredSubscriptions) {
            try {
                await s.subscriptions.cancel(expSub.id);
                logger.debug(`Cancelled expired subscription: ${expSub.id}`);
            } catch (delError) {
                logger.error(`Error deleting subscription ${expSub.id}:`, delError.message);
            }
        }
    }
    
    return true;
}

/**
 * Schedule all active subscriptions to cancel at the end of the current
 * billing period (cancel_at_period_end) instead of immediately. The user
 * keeps paid features they've already paid for until the period ends; Stripe
 * then fires customer.subscription.deleted, which the webhook uses to flip
 * their rank to Free.
 * @param {string} customerId - Customer ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of subscriptions scheduled for cancellation
 */
async function deferActiveSubscriptionsToPeriodEnd(customerId, userId) {
    const s = getStripe(userId);
    const activeSubscriptions = await listActiveSubscriptions(customerId, userId);
    let deferred = 0;

    for (const subscription of activeSubscriptions) {
        if (subscription.cancel_at_period_end) continue; // already scheduled
        try {
            await s.subscriptions.update(subscription.id, { cancel_at_period_end: true });
            logger.debug(`Scheduled subscription ${subscription.id} to cancel at period end`);
            deferred++;
        } catch (deferError) {
            logger.error(`Error scheduling cancellation for subscription ${subscription.id}: ${deferError.message}`);
        }
    }

    return deferred;
}

/**
 * Un-cancel a subscription that was scheduled to cancel at period end. Used
 * when a user downgrades and then re-upgrades within the same billing period,
 * so they resume the existing subscription instead of stacking a second,
 * overlapping one (which would double-bill).
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated subscription
 */
async function reactivateSubscription(subscriptionId, userId) {
    const s = getStripe(userId);
    return await s.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
}

/**
 * Get or create price ID for membership.
 * @param {string} membershipType - Membership type ('pro')
 * @param {number|null} customPrice - Custom price (optional; unused for fixed plans)
 * @param {string} userId - User ID (selects test vs live Stripe instance)
 * @param {string} billingInterval - 'month' or 'year'
 * @returns {Promise<string>} Price ID
 */
async function getOrCreatePriceId(membershipType, customPrice = null, userId, billingInterval = 'month') {
    const interval = billingInterval === 'year' ? 'year' : 'month';
    const annual = interval === 'year';
    const testMode = isTestMode(userId);

    // ── env-var overrides (test keys checked first when in test mode) ──
    const envKey = annual
        ? (testMode ? 'TEST_STRIPE_PRO_ANNUAL_PRICE_ID' : 'STRIPE_PRO_ANNUAL_PRICE_ID')
        : (testMode ? 'TEST_STRIPE_PRO_PRICE_ID' : 'STRIPE_PRO_PRICE_ID');

    if (membershipType === 'pro' && process.env[envKey]) {
        return process.env[envKey];
    }

    // Check in-memory cache (test mode only; live mode always lists prices)
    if (testMode) {
        const cacheKey = annual ? 'pro_annual' : membershipType;
        if (testPriceCache[cacheKey]) {
            logger.debug(`Using cached test price for ${membershipType} (${interval}): ${testPriceCache[cacheKey]}`);
            return testPriceCache[cacheKey];
        }
    }

    const s = getStripe(userId);

    // ── Live mode: look up by hardcoded product ID, matching the interval ──
    if (!testMode) {
        const productId = PLAN_TO_STRIPE_PRODUCT[membershipType];
        if (!productId) {
            throw new Error('Invalid membership type');
        }
        const prices = await s.prices.list({ product: productId, active: true, limit: 100 });
        const matchingPrice = prices.data.find(p => p.recurring?.interval === interval);
        if (!matchingPrice) {
            throw new Error(`No ${interval}ly pricing available for product ${productId}`);
        }
        logger.debug(`Using price ID: ${matchingPrice.id} for ${membershipType} (${productId}, ${interval})`);
        return matchingPrice.id;
    }

    // ── Test mode: find or create product & price ──
    const productName = 'Pro Membership';
    const unitAmount = annual ? 14400 : 1500; // $15/mo or $144/yr in cents

    // Search for existing test product by name
    const products = await s.products.list({ limit: 100, active: true });
    let testProduct = products.data.find(p => p.name === productName);

    if (!testProduct) {
        logger.debug(`Creating test product: ${productName}`);
        testProduct = await s.products.create({ name: productName });
    }

    // Look for an existing active recurring price at this amount + interval
    const prices = await s.prices.list({ product: testProduct.id, active: true, limit: 100 });
    let matchingPrice = prices.data.find(
        p => p.unit_amount === unitAmount && p.recurring?.interval === interval
    );

    if (!matchingPrice) {
        logger.debug(`Creating test price for ${productName}: $${unitAmount / 100}/${interval}`);
        matchingPrice = await s.prices.create({
            product: testProduct.id,
            unit_amount: unitAmount,
            currency: 'usd',
            recurring: { interval },
        });
    }

    logger.debug(`Using test price ID: ${matchingPrice.id} for ${membershipType} (${testProduct.id}, ${interval})`);
    testPriceCache[annual ? 'pro_annual' : membershipType] = matchingPrice.id;
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
    const idempotencyKey = `sub_${customerId}_${priceId}_${Date.now()}`;
    const subscription = await s.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
            save_default_payment_method: 'on_subscription',
            payment_method_types: ['card', 'link', 'cashapp', 'venmo']
        },
        expand: ['latest_invoice.payment_intent'],
    }, { idempotencyKey });
    
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
    listActiveSubscriptions,
    cancelActiveSubscriptions,
    deferActiveSubscriptionsToPeriodEnd,
    reactivateSubscription,
    getOrCreatePriceId,
    createSubscription
};
