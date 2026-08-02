// updateData.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);
const { logger } = require('../utils/logger');

// @desc    Put Data
// @route   PUT /api/data/:id
// @access  Private
const putData = asyncHandler(async (req, res) => {
    await checkIP(req);
    logger.debug('Update Data Request:', req.body);

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    logger.debug('User:', req.user);
    logger.debug('req.params.id:', req.params.id);

    try {
        const dataId = req.params.id;

        // First, find the item using the same pattern as getData.js which works
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: "id = :searchId",
            ExpressionAttributeValues: {
                ":searchId": dataId
            }
        };

        logger.debug('DynamoDB scan params:', JSON.stringify(scanParams, null, 2));
        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        logger.debug('DynamoDB scan result count:', scanResult.Items ? scanResult.Items.length : 0);

        if (!scanResult.Items || scanResult.Items.length === 0) {
            logger.debug('No items found via scan');
            res.status(404);
            throw new Error('Data item not found');
        }

        const item = scanResult.Items[0];
        logger.debug('Found item via scan');

        // Make sure the logged in user matches the data creator. Records without a
        // "Creator:" tag (e.g. user account rows created during registration) must
        // NOT be silently allowed through — previously this check was skipped
        // entirely for such items, letting any authenticated user overwrite
        // arbitrary rows (including other users' account records) just by
        // guessing/obtaining their DynamoDB id. Deny by default instead.
        if (item.text && item.text.includes('Creator:')) {
            const dataCreator = item.text.substring(item.text.indexOf("Creator:") + 8, item.text.indexOf("Creator:") + 8 + 24);
            if (dataCreator !== req.user.id) {
                res.status(401);
                logger.error('User not authorized');
                throw new Error('User not authorized');
            }
        } else {
            res.status(401);
            logger.error('Cannot update item without ownership information');
            throw new Error('User not authorized');
        }

        // Use a simple approach that works with the existing table structure
        // Just update the item directly using put (which will overwrite if it exists)
        const newItem = {
            ...item, // Keep all existing data
            text: req.body.text, // Update the text
            updatedAt: new Date().toISOString() // Update timestamp
        };

        const putParams = {
            TableName: 'Simple',
            Item: newItem
        };

        await dynamodb.send(new PutCommand(putParams));

        logger.debug('Updated data:', newItem);
        res.status(200).json(newItem);
    } catch (error) {
        logger.error('Error during data update:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to update data in DynamoDB' });
        }
    }
});

module.exports = { putData };