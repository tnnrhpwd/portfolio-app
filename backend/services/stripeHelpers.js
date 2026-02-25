/**
 * @deprecated This module is a thin wrapper around stripeService.js for backward
 * compatibility. New code should import directly from stripeService.
 */
const {
    extractCustomerId,
    validateOrRecoverCustomer,
    createOrValidateCustomer,
} = require('./stripeService');
const { getStripe } = require('../utils/stripeInstance');

/**
 * Validates a Stripe customer ID by attempting to retrieve it from Stripe
 * @param {string} customerId - The Stripe customer ID to validate
 * @param {string} [userId] - Optional user ID for test/live mode selection
 * @returns {Promise<{isValid: boolean, customer?: Object, error?: string}>}
 */
const validateStripeCustomerId = async (customerId, userId) => {
    try {
        if (!customerId || customerId.trim() === '') {
            return { isValid: false, error: 'Customer ID is empty or null' };
        }
        const stripe = getStripe(userId);
        const customer = await stripe.customers.retrieve(customerId);
        return { isValid: true, customer };
    } catch (stripeError) {
        return { isValid: false, error: stripeError.message || 'Unknown Stripe error', stripeError };
    }
};

/**
 * Extracts and validates a Stripe customer ID from user data text.
 * Delegates extraction to stripeService.extractCustomerId.
 */
const extractAndValidateCustomerId = async (userText, userId) => {
    try {
        const customerId = extractCustomerId(userText);
        if (!customerId) {
            return { isValid: false, error: 'No stripeid found in user data' };
        }
        const validation = await validateStripeCustomerId(customerId, userId);
        return {
            isValid: validation.isValid,
            customerId,
            customer: validation.customer,
            error: validation.error,
            stripeError: validation.stripeError,
        };
    } catch (error) {
        return { isValid: false, error: `Error processing user data: ${error.message}` };
    }
};

/**
 * Find or create a Stripe customer.
 * Delegates to stripeService.validateOrRecoverCustomer when a customerId exists.
 */
const findOrCreateCustomer = async (email, name, userId) => {
    try {
        const stripe = getStripe(userId);
        const existing = await stripe.customers.list({ email, limit: 1 });
        if (existing.data.length > 0) {
            return { success: true, customer: existing.data[0], wasExisting: true };
        }
        const newCustomer = await stripe.customers.create({ email, name });
        return { success: true, customer: newCustomer, wasExisting: false };
    } catch (stripeError) {
        return { success: false, error: stripeError.message || 'Unknown Stripe error', stripeError };
    }
};

module.exports = {
    validateStripeCustomerId,
    extractAndValidateCustomerId,
    findOrCreateCustomer
};
