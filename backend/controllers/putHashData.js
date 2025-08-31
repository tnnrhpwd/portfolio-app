// updateData.js

const asyncHandler = require('express-async-handler');
require('dotenv').config();
const { checkIP } = require('../utils/accessData.js');
const { getPaymentMethods } = require('./getHashData.js');
const { sendEmail } = require('../utils/emailService.js');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

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
        // Debug: log the exact parameter we're trying to use
        console.log('Attempting to get item with id:', req.params.id);
        console.log('id type:', typeof req.params.id);
        console.log('id length:', req.params.id.length);

        // Check if this is a bug report close action
        if (req.body.action === 'close_bug_report') {
            console.log('Processing bug report closure');
            await closeBugReportHandler(req, res);
            return;
        }

        // Try using scan instead of get, like the working controllers
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: "id = :searchId",
            ExpressionAttributeValues: {
                ":searchId": req.params.id
            }
        };

        let item;
        try {
            console.log('Using scan instead of get...');
            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            console.log('Scan result count:', scanResult.Items ? scanResult.Items.length : 0);
            
            if (!scanResult.Items || scanResult.Items.length === 0) {
                console.log('No items found via scan');
                res.status(404).json({ error: 'Data item not found' });
                return;
            }
            
            item = scanResult.Items[0];
            console.log('Found item via scan');
        } catch (scanError) {
            console.error('Error scanning item:', scanError);
            res.status(500).json({ error: 'Failed to get data from DynamoDB' });
            return;
        }

        if (!item) {
            res.status(400);
            console.error('Data input not found');
            throw new Error('Data input not found');
        }

        // Make sure the logged in user matches the data user
        const dataCreator = item.text.substring(item.text.indexOf("Creator:") + 8, item.text.indexOf("Creator:") + 8 + 24);
        if (dataCreator !== req.user.id) {
            res.status(401);
            console.error('User not authorized');
            throw new Error('User not authorized');
        }

        // Skip payment method check if text is 'free' or if it's Net chat content
        if (req.body.text.toLowerCase() === 'free' || req.body.text.includes('|Net:')) {
            await updateDataHolder(req, res, item);
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
            await updateDataHolder(req, res, item);
        });
    } catch (error) {
        console.error('Error during data update:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

const updateDataHolder = async (req, res, item) => {
    // Check if this is a Net chat update (contains |Net: content)
    if (req.body.text.includes('|Net:')) {
        console.log('Processing Net chat update');
        
        // For Net chats, replace the entire text content
        const updatedText = req.body.text;
        console.log('Updated Net chat text:', updatedText);

        // Use put operation to update the item
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...item, // Keep all existing data
                text: updatedText, // Update the text
                updatedAt: new Date().toISOString() // Update timestamp
            }
        };

        try {
            await dynamodb.send(new PutCommand(putParams));
            const updatedItem = putParams.Item;
            console.log('Net chat updated successfully');
            res.status(200).json(updatedItem);
        } catch (error) {
            console.error('Error updating Net chat in DynamoDB:', error);
            res.status(500).json({ error: 'Failed to update Net chat in DynamoDB' });
        }
        return;
    }

    // Original logic for subscription plan updates
    // Extract current rank for email notification
    let currentRank = 'Free';
    const rankMatch = item.text.match(/\|Rank:([^|]+)/);
    if (rankMatch && rankMatch[1]) {
        currentRank = rankMatch[1].trim();
    }

    // Update subscription plan
    const updatedText = item.text.includes('|Rank:')
        ? item.text.replace(/(\|Rank:)(Free|Flex|Premium)/, `$1${req.body.text}`)
        : `${item.text}|Rank:${req.body.text}`;

    console.log('Updated text:', updatedText);

    // Use put operation instead of update since we're working with scan results
    const putParams = {
        TableName: 'Simple',
        Item: {
            ...item, // Keep all existing data
            text: updatedText, // Update the text
            updatedAt: new Date().toISOString() // Update timestamp
        }
    };

    try {
        await dynamodb.send(new PutCommand(putParams));
        const updatedItem = putParams.Item;

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

        res.status(200).json(updatedItem);
    } catch (error) {
        console.error('Error updating data in DynamoDB:', error);
        res.status(500).json({ error: 'Failed to update data in DynamoDB' });
    }
};

// Handle bug report closure with resolution text
const closeBugReportHandler = async (req, res) => {
    const { resolutionText } = req.body;
    const reportId = req.params.id;

    console.log('Closing bug report with ID:', reportId);
    console.log('Resolution text:', resolutionText);

    try {
        // Find the bug report
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: "id = :searchId",
            ExpressionAttributeValues: {
                ":searchId": reportId
            }
        };

        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        
        if (!scanResult.Items || scanResult.Items.length === 0) {
            console.log('Bug report not found');
            res.status(404).json({ error: 'Bug report not found' });
            return;
        }

        const item = scanResult.Items[0];

        // Check if this is actually a bug report
        if (!item.text || !item.text.includes('Bug:') || !item.text.includes('Status:')) {
            res.status(400).json({ error: 'Item is not a bug report' });
            return;
        }

        // Check if user is admin or the creator of the bug report
        const isAdmin = req.user.id === '6770a067c725cbceab958619';
        let isCreator = false;
        
        if (item.text.includes('Creator:')) {
            const creatorMatch = item.text.match(/Creator:([^|]+)/);
            if (creatorMatch) {
                const creatorId = creatorMatch[1].trim();
                isCreator = creatorId === req.user.id || creatorId === req.user.email;
            }
        }

        if (!isAdmin && !isCreator) {
            res.status(403).json({ error: 'Not authorized to close this bug report' });
            return;
        }

        // Update the bug report text to mark as closed and add resolution
        let updatedText = item.text;
        
        // Update status to Closed
        updatedText = updatedText.replace(/Status:([^|]+)/, 'Status:Closed');
        
        // Add resolution text
        const timestamp = new Date().toISOString();
        const resolvedBy = isAdmin ? `Admin (${req.user.email || req.user.id})` : `User (${req.user.email || req.user.id})`;
        
        // Add resolution information to the bug report
        updatedText += `|Resolution:${resolutionText}|ResolvedBy:${resolvedBy}|ResolvedAt:${timestamp}`;

        // Update the item in DynamoDB
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...item,
                text: updatedText,
                updatedAt: timestamp
            }
        };

        await dynamodb.send(new PutCommand(putParams));
        console.log('Bug report closed successfully');
        
        res.status(200).json({
            success: true,
            message: 'Bug report closed successfully',
            updatedItem: putParams.Item
        });

    } catch (error) {
        console.error('Error closing bug report:', error);
        res.status(500).json({ error: 'Failed to close bug report' });
    }
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