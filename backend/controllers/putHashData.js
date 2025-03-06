// updateData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const Data = require('../models/dataModel.js');
const { checkIP } = require('../utils/accessData.js');

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

        const searchConditions = [
            { 'data.text': { $regex: `Creator:${req.user.id}`, $options: 'i' } },
            { 'data.text': { $regex: 'Payment:', $options: 'i' } }
        ];

        // Check for payment method
        const paymentMethods = await Data.find({ 
            $and: searchConditions
        });

        if (paymentMethods.length === 0) {
            console.error('No payment method found');
            res.status(200).json({ redirectToPay: true });
            return;
        }
        console.log('Payment methods:', paymentMethods[1]);
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
        res.status(200).json(updatedData);
    } catch (error) {
        console.error('Error during data update:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

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