const { getStripe, liveStripe } = require('../utils/stripeInstance');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { getUserRankFromStripe, parseUserCredits, updateUserCredits } = require('../utils/apiUsageTracker.js');
const { CREDITS, PLAN_IDS, PLAN_NAMES, isSimpleTier, STRIPE_PRODUCT_IDS } = require('../constants/pricing');

// Use the live Stripe instance for webhook processing (webhooks always come from live mode)
// TODO: If you add test-mode webhook support, use getStripe() with appropriate context
const stripe = liveStripe;

/**
 * Handle Stripe webhook events
 * @param {Object} req - Express request object
 * @param {string} webhookSecret - Stripe webhook secret
 * @returns {Object} Event object
 */
function constructWebhookEvent(req, webhookSecret) {
    const sig = req.headers['stripe-signature'];
    
    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        return { success: true, event };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Process webhook event based on type
 * @param {Object} event - Stripe event object
 * @returns {Object} Processing result
 */
function processWebhookEvent(event) {
    switch (event.type) {
        case 'invoice.payment_succeeded': {
            const invoice = event.data.object;
            console.log('Invoice payment succeeded:', invoice.id);
            return { success: true, message: 'Invoice payment succeeded' };
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            const customerId = invoice.customer;
            console.error(`Invoice payment FAILED for customer ${customerId}:`, invoice.id);
            console.error(`  Attempt count: ${invoice.attempt_count}`);
            console.error(`  Next attempt: ${invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : 'none'}`);
            // After final attempt, Stripe will fire customer.subscription.deleted
            return {
                success: true,
                message: 'Invoice payment failed logged',
                action: 'payment_failed',
                customerId,
                attemptCount: invoice.attempt_count
            };
        }

        case 'customer.subscription.updated': {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            const status = subscription.status;
            const productId = subscription.items?.data?.[0]?.price?.product;
            console.log(`Subscription updated for customer ${customerId}: status=${status}, product=${productId}`);

            // If subscription went past_due or unpaid, log a warning
            if (status === 'past_due' || status === 'unpaid') {
                console.warn(`Subscription ${subscription.id} is now ${status} for customer ${customerId}`);
            }

            return {
                success: true,
                message: `Subscription updated: ${status}`,
                action: 'subscription_updated',
                customerId,
                status
            };
        }

        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            console.warn(`Subscription DELETED for customer ${customerId}:`, subscription.id);
            console.warn(`  Cancellation reason: ${subscription.cancellation_details?.reason || 'unknown'}`);

            // Return info so the controller can downgrade the user
            return {
                success: true,
                message: 'Subscription deleted — user should be downgraded',
                action: 'subscription_deleted',
                customerId
            };
        }

        default:
            console.log(`Unhandled event type ${event.type}`);
            return { success: true, message: 'Event type not handled' };
    }
}

/**
 * Validate custom limit parameters
 * @param {number} customLimit - Custom limit amount
 * @returns {Object} Validation result
 */
function validateCustomLimit(customLimit) {
    if (!customLimit || typeof customLimit !== 'number' || customLimit < CREDITS[PLAN_IDS.SIMPLE].minLimit) {
        return {
            valid: false,
            error: `Invalid custom limit. Must be at least $${CREDITS[PLAN_IDS.SIMPLE].minLimit.toFixed(2)}.`
        };
    }
    return { valid: true };
}

/**
 * Verify user is Simple (top-tier) member
 * @param {string} userId - User ID
 * @returns {boolean} True if Simple member
 */
async function verifySimpleMembership(userId) {
    try {
        const userRank = await getUserRankFromStripe(userId);
        return isSimpleTier(userRank);
    } catch (error) {
        console.error('Failed to get user rank from Stripe:', error);
        throw new Error('Unable to verify membership status');
    }
}

/**
 * Calculate price difference and process payment if needed
 * @param {number} currentLimit - Current limit
 * @param {number} newLimit - New limit
 * @param {string} stripeCustomerId - Stripe customer ID
 * @param {string} frontendUrl - Frontend URL for redirects
 * @returns {Object} Payment result
 */
async function processLimitIncrease(currentLimit, newLimit, stripeCustomerId, frontendUrl) {
    const limitDifference = newLimit - currentLimit;
    
    console.log(`Current limit: $${currentLimit.toFixed(2)}, New limit: $${newLimit.toFixed(2)}, Difference: $${limitDifference.toFixed(2)}`);
    
    if (limitDifference <= 0) {
        return { success: false, error: 'No increase detected' };
    }
    
    try {
        const crypto = require('crypto');
        const idempotencyKey = `limit_${stripeCustomerId}_${Math.round(newLimit * 100)}_${Date.now()}`;
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(limitDifference * 100),
            currency: 'usd',
            customer: stripeCustomerId,
            description: `Simple plan limit increase from $${currentLimit.toFixed(2)} to $${newLimit.toFixed(2)}`,
            automatic_payment_methods: {
                enabled: true,
            },
            confirm: true,
            return_url: frontendUrl
        }, { idempotencyKey });
        
        console.log('Payment processed successfully for limit increase:', paymentIntent.id);
        return { success: true, paymentIntent, limitDifference };
    } catch (paymentError) {
        console.error('Payment processing error:', paymentError);
        throw new Error(`Payment failed: ${paymentError.message}`);
    }
}

/**
 * Update subscription for new limit
 * @param {string} subscriptionId - Subscription ID
 * @param {number} newLimit - New limit
 * @returns {boolean} Success status
 */
async function updateSubscriptionLimit(subscriptionId, newLimit) {
    if (!subscriptionId) {
        console.log('No subscription ID found, skipping subscription update');
        return false;
    }
    
    try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const productId = subscription.items.data[0]?.price?.product;

        // Reuse an existing active price at this amount if one exists on the product,
        // otherwise create a new one. This avoids accumulating orphaned Price objects.
        let matchingPrice = null;
        if (productId) {
            const existingPrices = await stripe.prices.list({
                product: productId,
                active: true,
                limit: 50,
            });
            matchingPrice = existingPrices.data.find(
                p => p.unit_amount === Math.round(newLimit * 100) && p.recurring?.interval === 'month'
            );
        }

        if (!matchingPrice) {
            matchingPrice = await stripe.prices.create({
                currency: 'usd',
                unit_amount: Math.round(newLimit * 100),
                recurring: { interval: 'month' },
                product: productId || undefined,
                ...(productId ? {} : {
                    product_data: {
                        name: `Simple Membership - $${newLimit.toFixed(2)} Monthly Limit`
                    }
                }),
            });
            console.log(`Created new price ${matchingPrice.id} for $${newLimit.toFixed(2)}/month`);
        } else {
            console.log(`Reusing existing price ${matchingPrice.id} for $${newLimit.toFixed(2)}/month`);
        }
        
        await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: subscription.items.data[0].id,
                price: matchingPrice.id,
            }],
            proration_behavior: 'none'
        });
        
        console.log(`Updated subscription to monthly charge of $${newLimit.toFixed(2)}`);
        return true;
    } catch (subscriptionError) {
        console.error('Error updating subscription:', subscriptionError);
        return false;
    }
}

/**
 * Update user credits in database
 * @param {Object} dynamodb - DynamoDB client
 * @param {Object} user - User object
 * @param {Object} creditsData - Credits data
 * @returns {boolean} Success status
 */
async function saveUserCredits(dynamodb, user, creditsData) {
    const updatedText = updateUserCredits(user.text, creditsData);
    
    const putParams = {
        TableName: 'Simple',
        Item: {
            ...user,
            text: updatedText,
            updatedAt: new Date().toISOString()
        }
    };
    
    try {
        await dynamodb.send(new PutCommand(putParams));
        console.log('Custom limit updated successfully in database');
        return true;
    } catch (error) {
        console.error('Error saving user credits:', error);
        return false;
    }
}

/**
 * Process custom limit update - orchestrates the entire flow
 * @param {Object} req - Express request object
 * @param {Object} dynamodb - DynamoDB client
 * @returns {Object} Result object
 */
async function processCustomLimitUpdate(req, dynamodb) {
    const { customLimit } = req.body;
    
    // Validate custom limit
    const validation = validateCustomLimit(customLimit);
    if (!validation.valid) {
        const error = new Error(validation.error);
        error.statusCode = 400;
        throw error;
    }
    
    // Verify Simple membership
    const isSimple = await verifySimpleMembership(req.user.id);
    if (!isSimple) {
        const error = new Error('Custom limits are only available for Simple members');
        error.statusCode = 403;
        throw error;
    }
    
    // Get current credits data
    const userText = req.user.text || '';
    let creditsData = parseUserCredits(userText);
    
    const currentLimit = creditsData.customLimit || CREDITS[PLAN_IDS.SIMPLE].defaultLimit;
    const limitDifference = customLimit - currentLimit;
    
    if (limitDifference === 0) {
        const error = new Error('Custom limit is the same as current limit');
        error.statusCode = 400;
        throw error;
    }
    
    if (limitDifference > 0) {
        // User is increasing their limit - charge and add credits
        const stripeCustomerId = userText.match(/stripeCustomerId:([^|]+)/)?.[1];
        if (!stripeCustomerId) {
            const error = new Error('No Stripe customer ID found');
            error.statusCode = 400;
            throw error;
        }
        
        const frontendUrl = process.env.FRONTEND_URL || 
                           (process.env.NODE_ENV === 'production' ? 'https://www.sthopwood.com' : 'http://localhost:3000') + 
                           '/profile';
        
        const paymentResult = await processLimitIncrease(currentLimit, customLimit, stripeCustomerId, frontendUrl);
        
        if (!paymentResult.success) {
            const error = new Error(paymentResult.error);
            error.statusCode = 400;
            throw error;
        }
        
        // Add credits immediately
        creditsData.customLimit = customLimit;
        creditsData.availableCredits = (creditsData.availableCredits || 0) + limitDifference;
        
        // Update subscription
        const subscriptionId = userText.match(/subscriptionId:([^|]+)/)?.[1];
        await updateSubscriptionLimit(subscriptionId, customLimit);
        
        console.log(`Custom limit increased from $${currentLimit.toFixed(2)} to $${customLimit.toFixed(2)}`);
        console.log(`Added $${limitDifference.toFixed(4)} in credits immediately`);
    } else {
        // User is decreasing their limit - adjust for next billing cycle
        creditsData.customLimit = customLimit;
        console.log(`Custom limit decreased from $${currentLimit.toFixed(2)} to $${customLimit.toFixed(2)}`);
        console.log('Next billing cycle will reflect the lower amount');
    }
    
    // Save to database
    await saveUserCredits(dynamodb, req.user, creditsData);
    
    return {
        success: true,
        message: limitDifference > 0 
            ? `Custom limit increased to $${customLimit.toFixed(2)}. Credits added immediately.`
            : `Custom limit updated to $${customLimit.toFixed(2)}. Next billing cycle will reflect the new amount.`,
        newLimit: customLimit,
        availableCredits: creditsData.availableCredits,
        limitChange: limitDifference,
        immediateCredits: Math.max(0, limitDifference)
    };
}

module.exports = {
    constructWebhookEvent,
    processWebhookEvent,
    validateCustomLimit,
    verifySimpleMembership,
    processLimitIncrease,
    updateSubscriptionLimit,
    saveUserCredits,
    processCustomLimitUpdate
};
