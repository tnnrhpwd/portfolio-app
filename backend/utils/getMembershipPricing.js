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
    try {
        // Return cached data if still fresh
        if (pricingCache.data && Date.now() - pricingCache.timestamp < PRICING_CACHE_TTL) {
            console.log('Returning cached membership pricing');
            return res.status(200).json({ success: true, data: pricingCache.data });
        }

        console.log('Fetching membership pricing from Stripe...');
        
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
            },
            { 
                id: PLAN_IDS.SIMPLE, 
                name: PLAN_NAMES[PLAN_IDS.SIMPLE], 
                stripeProductId: PLAN_TO_STRIPE_PRODUCT[PLAN_IDS.SIMPLE]
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
                console.warn(`Could not retrieve Stripe product ${membershipType.stripeProductId}: ${err.message}`);
            }
            
            if (!product) {
                console.warn(`Product not found in Stripe: ${membershipType.stripeProductId}`);
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
                limit: 10
            });
            
            if (prices.data.length === 0) {
                console.warn(`No active prices found for product: ${membershipType.stripeProductId}`);
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
            
            // Use the first active price (or you could add logic to select a specific price)
            const price = prices.data[0];
            
            // Add membership-specific features and descriptions from centralized config
            let features = FEATURES[membershipType.id] || [];
            let description = DESCRIPTIONS[membershipType.id] || '';
            let quota = { calls: QUOTAS[membershipType.id] || 'N/A' };

            pricingData.push({
                id: membershipType.id,
                name: membershipType.name,
                price: price.unit_amount, // Amount in cents
                currency: price.currency,
                interval: price.recurring?.interval || 'month',
                priceId: price.id,
                productId: product.id,
                description: description || product.description || '',
                features: features,
                quota: quota
            });
            
            console.log(`Added pricing for ${membershipType.name}: ${price.unit_amount} ${price.currency}/${price.recurring?.interval || 'month'}`);
        }
        
        console.log('Successfully fetched membership pricing');

        // Cache the result
        pricingCache = { data: pricingData, timestamp: Date.now() };

        res.status(200).json({
            success: true,
            data: pricingData
        });
        
    } catch (error) {
        console.error('Error fetching membership pricing:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch membership pricing',
            message: error.message
        });
    }
});

module.exports = { getMembershipPricing };
