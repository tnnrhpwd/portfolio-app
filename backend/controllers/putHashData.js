// updateData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const Data = require('../models/dataModel.js');
const { checkIP } = require('../utils/accessData.js');
const { getPaymentMethods } = require('./getHashData.js');
const { sendEmail } = require('../utils/emailService.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);

// @desc    Update Data
// @route   PUT /api/data/:id
// @access  Private
const putHashData = asyncHandler(async (req, res) => {
    await checkIP(req);
    console.log('Update Data Request:', req.body);

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    // console.log('User:', req.user);
    console.log('req.params.id:', req.params.id);

    try {
        const dataHolder = await Data.findById(req.params.id);
        if (!dataHolder) {
            res.status(400);
            console.error('Data input not found');
            throw new Error('Data input not found');
        }

        // console.log('Data:', dataHolder);
        console.log('req.user.id:', req.user.id);

        // Make sure the logged in user matches the data user
        const ObjectId = require('mongoose').Types.ObjectId;
        if (!ObjectId(req.user.id).equals(dataHolder._id)) {
            if (!dataHolder.user || dataHolder.user.toString() !== req.user.id) {
                res.status(401);
                console.error('User not authorized');
                throw new Error('User not authorized');
            }
        }

        // Skip payment method check if text is 'free'
        if (req.body.text.toLowerCase() === 'free') {
            await updateDataHolder(req, res, dataHolder);
            return;
        }

        // Set the flag to indicate this call is from putHashData
        req.fromPutHashData = true;
        
        // Check for payment method
        await getPaymentMethods(req, res, async () => {
            const paymentMethods = req.paymentMethods;
            if (!paymentMethods || paymentMethods.length === 0) {
                console.error('No payment method found');
                res.status(200).json({ redirectToPay: true });
                return;
            }
            console.log('Payment methods:', paymentMethods.length);
            await updateDataHolder(req, res, dataHolder);
        });
    } catch (error) {
        console.error('Error during data update:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

const updateDataHolder = async (req, res, dataHolder) => {
    // Extract current rank for email notification
    let currentRank = 'Free';
    const rankMatch = dataHolder.data.text.match(/\|Rank:([^|]+)/);
    if (rankMatch && rankMatch[1]) {
        currentRank = rankMatch[1].trim();
    }
    
    // Update subscription plan
    const updatedText = dataHolder.data.text.includes('|Rank:')
        ? dataHolder.data.text.replace(/(\|Rank:)(Free|Flex|Premium)/, `$1${req.body.text}`)
        : `${dataHolder.data.text}|Rank:${req.body.text}`;

    console.log('Updated text:', updatedText);
    dataHolder.data.text = updatedText;

    const updatedData = await Data.findByIdAndUpdate(req.params.id, { 'data.text': updatedText }, {
        new: true,
    });
    console.log('Updated data:', updatedData);
    
    // Send email notification if rank was changed and we have an email address
    if (currentRank.toLowerCase() !== req.body.text.toLowerCase()) {
        // Extract email address from user data
        const emailMatch = updatedText.match(/Email:([^|]+)/);
        if (emailMatch && emailMatch[1]) {
            const userEmail = emailMatch[1].trim();
            
            try {
                if (req.body.text.toLowerCase() === 'free') {
                    // Downgrade to free plan
                    await sendEmail(userEmail, 'subscriptionCancelled', {
                        plan: currentRank,
                        userData: { text: updatedText }
                    });
                } else if (currentRank.toLowerCase() === 'free') {
                    // New subscription
                    await sendEmail(userEmail, 'subscriptionCreated', {
                        plan: req.body.text,
                        userData: { text: updatedText }
                    });
                } else {
                    // Plan change
                    await sendEmail(userEmail, 'subscriptionUpdated', {
                        oldPlan: currentRank,
                        newPlan: req.body.text,
                        userData: { text: updatedText }
                    });
                }
                console.log(`Subscription email sent to ${userEmail}`);
            } catch (error) {
                console.error('Failed to send subscription update email:', error);
                // Don't fail the operation if email sending fails
            }
        }
    }
    
    res.status(200).json(updatedData);
};

// PUT: Update A customer
const updateCustomer = asyncHandler(async (req, res) => {
    const { id, email, name } = req.body;
    const customer = await stripe.customers.update(id, { email, name });
    res.status(200).json(customer);
});

// PUT: Update a payment method
const putPaymentMethod = asyncHandler(async (req, res) => {
    const { paymentMethodId, customerId } = req.body;

    try {
        const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        res.status(200).json(paymentMethod);
    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

module.exports = { putHashData, updateCustomer, putPaymentMethod }; // Export the controller functions