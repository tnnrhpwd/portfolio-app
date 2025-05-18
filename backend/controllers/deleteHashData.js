// deleteData.js

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteHashData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
        const id = req.params.id;
        console.log("delete id=" + id);

        // Check for user
        if (!req.user) {
            res.status(401);
            throw new Error('User not found.');
        }

        // Retrieve the item from DynamoDB
        const getParams = {
            TableName: 'Simple',
            Key: {
                id: id
            }
        };

        let item;
        try {
            const getItemResult = await dynamodb.get(getParams).promise();
            item = getItemResult.Item;
        } catch (getError) {
            console.error('Error getting item:', getError);
            res.status(500).json({ error: 'Failed to get data from DynamoDB' });
            return;
        }

        if (!item) {
            res.status(400);
            throw new Error('Data not found.');
        }

        // Extract the creator ID from the item's text attribute
        const dataCreator = item.text.substring(item.text.indexOf("Creator:") + 8, item.text.indexOf("Creator:") + 8 + 24);

        // Check for owner
        if (!dataCreator) {
            res.status(401);
            throw new Error('Data creator not found.');
        }

        // Make sure the logged in user matches the data creator
        if (dataCreator !== req.user.id) {
            res.status(401);
            throw new Error('User not authorized.');
        }

        // Delete the item from DynamoDB
        const deleteParams = {
            TableName: 'Simple',
            Key: {
                id: id
            }
        };

        try {
            await dynamodb.delete(deleteParams).promise();
            res.status(200).json({ id });
        } catch (deleteError) {
            console.error('Error deleting data:', deleteError);
            res.status(500).json({ error: 'Failed to delete data' });
        }
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE: Delete a payment method
const deletePaymentMethod = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await stripe.paymentMethods.detach(id);
    res.status(200).json({ id });
});

// DETELE: Delete a customer
const deleteCustomer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await stripe.customers.del(id);
    res.status(200).json({ id });
});

module.exports = { deleteHashData, deletePaymentMethod, deleteCustomer }; // Export the controller functions