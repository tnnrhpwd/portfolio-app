// utils/stripeInstance.js
// Returns the appropriate Stripe instance (test or live) based on context.
// The test funnel controller creates a test user whose requests should go
// through Stripe test-mode so real customers are never affected.

const liveStripe = require('stripe')(process.env.STRIPE_KEY);
const testStripeKey = process.env.TEST_STRIPE_KEY;
const testStripe = testStripeKey ? require('stripe')(testStripeKey) : null;

/**
 * Get the Stripe instance for a given user ID.
 * If the user is the active test funnel user AND test keys are configured,
 * returns the test-mode Stripe instance. Otherwise returns the live instance.
 *
 * @param {string} [userId] - The requesting user's ID (from req.user.id)
 * @returns {import('stripe').Stripe}
 */
function getStripe(userId) {
  if (!testStripe || !userId) return liveStripe;

  // Lazy-require to avoid circular dependency at startup
  const { getTestUserId } = require('../controllers/testFunnelController');
  const activeTestUserId = getTestUserId();

  if (activeTestUserId && userId === activeTestUserId) {
    return testStripe;
  }
  return liveStripe;
}

/**
 * Check whether a given userId is currently the active test-funnel user.
 * @param {string} [userId]
 * @returns {boolean}
 */
function isTestMode(userId) {
  if (!testStripe || !userId) return false;
  const { getTestUserId } = require('../controllers/testFunnelController');
  const activeTestUserId = getTestUserId();
  return !!(activeTestUserId && userId === activeTestUserId);
}

module.exports = { getStripe, isTestMode, liveStripe, testStripe };
