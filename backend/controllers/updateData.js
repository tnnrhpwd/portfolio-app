// updateData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const Data = require('../models/dataModel');
const { checkIP } = require('./accessData.js');

// @desc    Update Data
// @route   PUT /api/data/:id
// @access  Private
const updateData = asyncHandler(async (req, res) => {
    await checkIP(req);

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    console.log('User:', req.user);
    console.log('req.params.id:', req.params.id);

    try {
        const dataHolder = await Data.findById(req.params.id);
        if (!dataHolder) {
            res.status(400);
            console.error('Data input not found');
            throw new Error('Data input not found');
        }

        console.log('Data:', dataHolder);
        console.log('req.user.id:', req.user.id);

        // Make sure the logged in user matches the data user
        const ObjectId = require('mongoose').Types.ObjectId;
        if (!ObjectId(req.user.id).equals(dataHolder._id)) {
            if(!dataHolder.user && !dataHolder.user.toString() !== req.user.id) {
                res.status(401);
                console.error('User not authorized');
                throw new Error('User not authorized');
            }
        } 

        // Check for payment method
        const paymentMethods = await Data.find({ text: { $regex: `Creator:${req.user.id}.*Payment:` } });
        if (paymentMethods.length === 0) {
            console.error('No payment method found');
            res.status(200).json({ redirectToPay: true });
            return;
        }

        // Update subscription plan
        const updatedText = dataHolder.text.includes('|Rank:')
            ? dataHolder.text.replace(/(\|Rank:)(Free|Flex|Premium)/, `$1${req.body.text}`)
            : `${dataHolder.text} |Rank:${req.body.text}`;

        const updatedData = await Data.findByIdAndUpdate(req.params.id, { text: updatedText }, {
            new: true,
        });

        res.status(200).json(updatedData);
    } catch (error) {
        console.error('Error during data update:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

module.exports = { updateData };