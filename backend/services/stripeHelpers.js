const stripe = require('stripe')(process.env.STRIPE_KEY);

/**
 * Validates a Stripe customer ID by attempting to retrieve it from Stripe
 * @param {string} customerId - The Stripe customer ID to validate
 * @returns {Promise<{isValid: boolean, customer?: Object, error?: string}>}
 */
const validateStripeCustomerId = async (customerId) => {
    try {
        if (!customerId || customerId.trim() === '') {
            return {
                isValid: false,
                error: 'Customer ID is empty or null'
            };
        }

        const customer = await stripe.customers.retrieve(customerId);
        
        return {
            isValid: true,
            customer: customer
        };
    } catch (stripeError) {
        return {
            isValid: false,
            error: stripeError.message || 'Unknown Stripe error',
            stripeError: stripeError
        };
    }
};

/**
 * Extracts and validates a Stripe customer ID from user data text
 * @param {string} userText - The user data text containing stripeid
 * @returns {Promise<{isValid: boolean, customerId?: string, customer?: Object, error?: string}>}
 */
const extractAndValidateCustomerId = async (userText) => {
    try {
        // Extract customer ID using regex
        const stripeIdMatch = userText.match(/\|stripeid:([^|]*)/);
        
        if (!stripeIdMatch) {
            return {
                isValid: false,
                error: 'No stripeid found in user data'
            };
        }
        
        const customerId = stripeIdMatch[1];
        
        if (!customerId || customerId.trim() === '') {
            return {
                isValid: false,
                error: 'Stripe customer ID is empty'
            };
        }
        
        // Validate the customer ID with Stripe
        const validation = await validateStripeCustomerId(customerId);
        
        return {
            isValid: validation.isValid,
            customerId: customerId,
            customer: validation.customer,
            error: validation.error,
            stripeError: validation.stripeError
        };
    } catch (error) {
        return {
            isValid: false,
            error: `Error processing user data: ${error.message}`
        };
    }
};

/**
 * Finds or creates a Stripe customer for a given email and name
 * @param {string} email - Customer email
 * @param {string} name - Customer name
 * @returns {Promise<{success: boolean, customer?: Object, wasExisting?: boolean, error?: string}>}
 */
const findOrCreateCustomer = async (email, name) => {
    try {
        // First, check if a customer with this email already exists in Stripe
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });
        
        if (existingCustomers.data.length > 0) {
            // Use the existing customer
            return {
                success: true,
                customer: existingCustomers.data[0],
                wasExisting: true
            };
        } else {
            // Create new Stripe customer if none exists
            const newCustomer = await stripe.customers.create({ email, name });
            return {
                success: true,
                customer: newCustomer,
                wasExisting: false
            };
        }
    } catch (stripeError) {
        return {
            success: false,
            error: stripeError.message || 'Unknown Stripe error',
            stripeError: stripeError
        };
    }
};

module.exports = {
    validateStripeCustomerId,
    extractAndValidateCustomerId,
    findOrCreateCustomer
};
