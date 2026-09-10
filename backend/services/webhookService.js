const { liveStripe } = require('../utils/stripeInstance');
const { logger } = require('../utils/logger');

// Use the live Stripe instance for webhook processing (webhooks always come from live mode)
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
            logger.debug('Invoice payment succeeded:', invoice.id);
            return { success: true, message: 'Invoice payment succeeded' };
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            const customerId = invoice.customer;
            logger.error(`Invoice payment FAILED for customer ${customerId}:`, invoice.id);
            logger.error(`  Attempt count: ${invoice.attempt_count}`);
            logger.error(`  Next attempt: ${invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : 'none'}`);
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
            logger.debug(`Subscription updated for customer ${customerId}: status=${status}, product=${productId}`);

            // If subscription went past_due or unpaid, log a warning
            if (status === 'past_due' || status === 'unpaid') {
                logger.warn(`Subscription ${subscription.id} is now ${status} for customer ${customerId}`);
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
            logger.warn(`Subscription DELETED for customer ${customerId}:`, subscription.id);
            logger.warn(`  Cancellation reason: ${subscription.cancellation_details?.reason || 'unknown'}`);

            // Return info so the controller can downgrade the user
            return {
                success: true,
                message: 'Subscription deleted — user should be downgraded',
                action: 'subscription_deleted',
                customerId
            };
        }

        default:
            logger.debug(`Unhandled event type ${event.type}`);
            return { success: true, message: 'Event type not handled' };
    }
}

module.exports = {
    constructWebhookEvent,
    processWebhookEvent
};
