require('dotenv').config();
const asyncHandler = require('express-async-handler');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// @desc    Get membership pricing from Stripe
// @route   GET /api/data/membership-pricing
// @access  Public (pricing can be viewed by anyone)
const getMembershipPricing = asyncHandler(async (req, res) => {
    try {
        console.log('Fetching membership pricing from Stripe...');
        
        // Define the membership types and their corresponding product names
        const membershipTypes = [
            { 
                id: 'free', 
                name: 'Free Tier', 
                productName: null, // No Stripe product for free tier
                price: 0,
                currency: 'usd',
                interval: 'month'
            },
            { 
                id: 'flex', 
                name: 'Flex Membership', 
                productName: 'Flex Membership' 
            },
            { 
                id: 'premium', 
                name: 'Premium Membership', 
                productName: 'Premium Membership' 
            }
        ];
        
        const pricingData = [];
        
        // Fetch all active products from Stripe
        const products = await stripe.products.list({
            active: true,
            limit: 100
        });
        
        console.log(`Found ${products.data.length} active products in Stripe`);
        
        for (const membershipType of membershipTypes) {
            if (membershipType.id === 'free') {
                // Free tier doesn't have a Stripe product, use hardcoded values
                pricingData.push({
                    id: membershipType.id,
                    name: membershipType.name,
                    price: 0,
                    currency: 'usd',
                    interval: 'month',
                    priceId: null,
                    productId: null,
                    description: 'Experience the basics with zero commitment',
                    features: [
                        'Limited API calls – perfect for exploring our services',
                        'Simple, real-time dashboard',
                        'Community support forum',
                    ],
                    quota: { calls: '1,000 calls/month' }
                });
                continue;
            }
            
            // Find the product in Stripe
            const product = products.data.find(p => p.name === membershipType.productName);
            
            if (!product) {
                console.warn(`Product not found in Stripe: ${membershipType.productName}`);
                // Add placeholder data for missing products
                pricingData.push({
                    id: membershipType.id,
                    name: membershipType.name,
                    price: null,
                    currency: 'usd',
                    interval: 'month',
                    priceId: null,
                    productId: null,
                    description: product?.description || 'Product pricing not available',
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
                console.warn(`No active prices found for product: ${membershipType.productName}`);
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
            
            // Add membership-specific features and descriptions
            let features = [];
            let description = '';
            let quota = null;
            
            if (membershipType.id === 'flex') {
                description = 'Pay only for what you use';
                features = [
                    'Usage-based pricing – enjoy a baseline quota then pay per call',
                    'Strategic planning tools for scaling efficiently',
                    'Enhanced analytics dashboard for smarter decision-making',
                ];
                quota = {
                    baseCalls: '10,000 calls/month',
                    overageRate: '$0.001 per additional call',
                };
            } else if (membershipType.id === 'premium') {
                description = 'Power users and enterprises: maximize efficiency and savings';
                features = [
                    'Significantly reduced per-usage rates – save up to 30% on volume',
                    'Set your monthly maximum with predictability in billing',
                    'Priority AI processing for rapid execution',
                    'Advanced analytics with detailed data insights',
                    'Dedicated support channel with direct expert access',
                    'Exclusive early access to innovative, cutting-edge features',
                ];
            }
            
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
