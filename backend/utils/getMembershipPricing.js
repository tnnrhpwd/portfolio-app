require('dotenv').config();
const asyncHandler = require('express-async-handler');
const { liveStripe: stripe } = require('../utils/stripeInstance');
const { PLAN_IDS, PLAN_NAMES, STRIPE_PRODUCT_MAP, PLAN_TO_STRIPE_PRODUCT, FEATURES, DESCRIPTIONS, QUOTAS } = require('../constants/pricing');

// ── In-memory cache for pricing data (avoids Stripe API calls on every page view) ──
let pricingCache = { data: null, timestamp: 0 };
const PRICING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// @desc    Get membership pricing from Stripe
// @route   GET /api/data/membership-pricing
// @access  Public (pricing can be viewed by anyone)
const getMembershipPricing = asyncHandler(async (req, res) => {
const { logger } = require('./logger');
    try {
        // Return cached data if still fresh
        if (pricingCache.data && Date.now() - pricingCache.timestamp < PRICING_CACHE_TTL) {
            logger.debug('Returning cached membership pricing');
            return res.status(200).json({ success: true, data: pricingCache.data });
        }

        logger.debug('Fetching membership pricing from Stripe...');
        
        // Define the membership types and their corresponding Stripe product IDs
        const membershipTypes = [
            { 
                id: PLAN_IDS.FREE, 
                name: PLAN_NAMES[PLAN_IDS.FREE], 
                stripeProductId: null, // No Stripe product for free tier
                price: 0,
                currency: 'usd',
                interval: 'month'
            },
            { 
                id: PLAN_IDS.PRO, 
                name: PLAN_NAMES[PLAN_IDS.PRO], 
                stripeProductId: PLAN_TO_STRIPE_PRODUCT[PLAN_IDS.PRO]
            }
        ];
        
        const pricingData = [];
        
        for (const membershipType of membershipTypes) {
            if (membershipType.id === PLAN_IDS.FREE) {
                // Free tier doesn't have a Stripe product, use centralized values
                pricingData.push({
                    id: membershipType.id,
                    name: membershipType.name,
                    price: 0,
                    currency: 'usd',
                    interval: 'month',
                    priceId: null,
                    productId: null,
                    description: DESCRIPTIONS[PLAN_IDS.FREE],
                    features: FEATURES[PLAN_IDS.FREE],
                    quota: { calls: QUOTAS[PLAN_IDS.FREE] }
                });
                continue;
            }
            
            // Retrieve the product directly by ID (1 API call instead of listing all)
            let product;
            try {
                product = await stripe.products.retrieve(membershipType.stripeProductId);
            } catch (err) {
                logger.warn(`Could not retrieve Stripe product ${membershipType.stripeProductId}: ${err.message}`);
            }
            
            if (!product) {
                logger.warn(`Product not found in Stripe: ${membershipType.stripeProductId}`);
                // Add placeholder data for missing products
                pricingData.push({
                    id: membershipType.id,
                    name: membershipType.name,
                    price: null,
                    currency: 'usd',
                    interval: 'month',
                    priceId: null,
                    productId: null,
                    error: 'Product not found in Stripe'
                });
                continue;
            }
            
            // Get the prices for this product
            const prices = await stripe.prices.list({
                product: product.id,
                active: true,
                limit: 100
            });
            
            if (prices.data.length === 0) {
                logger.warn(`No active prices found for product: ${membershipType.stripeProductId}`);
                pricingData.push({
                    id: membershipType.id,
                    name: membershipType.name,
                    price: null,
                    currency: 'usd',
                    interval: 'month',
                    priceId: null,
                    productId: product.id,
                    description: product.description || 'Pricing not available',
                    error: 'No active prices found'
                });
                continue;
            }
            
            // Separate recurring prices by cadence so the checkout can offer a
            // monthly/annual choice when both exist. Monthly is the default;
            // fall back to any price if no monthly price is configured.
            const recurringPrices = prices.data.filter(
                p => p.recurring?.interval === 'month' || p.recurring?.interval === 'year'
            );
            const monthly = recurringPrices.find(p => p.recurring.interval === 'month');
            const annual = recurringPrices.find(p => p.recurring.interval === 'year');
            const primaryPrice = monthly || recurringPrices[0] || prices.data[0];
            
            // Add membership-specific features and descriptions from centralized config
            let features = FEATURES[membershipType.id] || [];
            let description = DESCRIPTIONS[membershipType.id] || '';
            let quota = { calls: QUOTAS[membershipType.id] || 'N/A' };

            const intervals = [];
            if (monthly) {
                intervals.push({ interval: 'month', price: monthly.unit_amount, currency: monthly.currency, priceId: monthly.id });
            }
            if (annual) {
                intervals.push({ interval: 'year', price: annual.unit_amount, currency: annual.currency, priceId: annual.id });
            }

            pricingData.push({
                id: membershipType.id,
                name: membershipType.name,
                price: primaryPrice.unit_amount, // Amount in cents
                currency: primaryPrice.currency,
                interval: primaryPrice.recurring?.interval || 'month',
                priceId: primaryPrice.id,
                productId: product.id,
                description: description || product.description || '',
                features: features,
                quota: quota,
                intervals
            });
            
            logger.debug(`Added pricing for ${membershipType.name}: ${primaryPrice.unit_amount} ${primaryPrice.currency}/${primaryPrice.recurring?.interval || 'month'}`);
        }
        
        logger.debug('Successfully fetched membership pricing');

        // Cache the result
        pricingCache = { data: pricingData, timestamp: Date.now() };

        res.status(200).json({
            success: true,
            data: pricingData
        });
        
    } catch (error) {
        logger.error('Error fetching membership pricing:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch membership pricing',
            message: error.message
        });
    }
});

module.exports = { getMembershipPricing };
