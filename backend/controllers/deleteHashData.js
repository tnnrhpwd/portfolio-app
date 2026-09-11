// deleteHashData.js

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { invalidateStorageUsage } = require('../utils/storageTracker');

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
const { getStripe } = require('../utils/stripeInstance.js');
const { extractCustomerId } = require('../services/stripeService.js');

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteHashData = asyncHandler(async (req, res) => {
    const routeParamId = req.params.id;
    logger.debug(`[DELETEHASH] Attempting to delete item with id from route: ${routeParamId}`);

    try {
        await checkIP(req);
        // const id = req.params.id; // Already defined as routeParamId
        // logger.debug("delete id=" + routeParamId); // Already logged

        // Check for user
        if (!req.user) {
            res.status(401);
            throw new Error('User not found.');
        }

        // Retrieve the item from DynamoDB
        // CRITICAL: Ensure the Key definition below matches your DynamoDB 'Simple' table's primary key schema.
        // Check AWS Console for 'Simple' table: Partition Key name/type and Sort Key name/type (if any).
        let item; // Declare item here
        let createdAtValue;

        // Look the item up by its partition key. The previous `Scan` with an
        // `id` filter only ever examined the table's first 1 MB (the same trap
        // postData.js' paginatedScan() exists for), so any record past that
        // boundary answered "Data not found." and could not be deleted at all.
        // `Query` addresses the partition key directly: exact, and O(1) instead
        // of scanning the whole table on every delete.
        try {
            const queryResult = await dynamodb.send(new QueryCommand({
                TableName: 'Simple',
                KeyConditionExpression: 'id = :id',
                ExpressionAttributeValues: { ':id': routeParamId }
            }));
            if (queryResult.Items && queryResult.Items.length > 0) {
                item = queryResult.Items[0];
                createdAtValue = queryResult.Items[0].createdAt;
            } else {
                logger.debug(`[DELETEHASH] Item with id ${routeParamId} not found during scan.`);
                res.status(400);
                throw new Error('Data not found.');
            }
        } catch (scanError) {
            logger.error(`[DELETEHASH] Item lookup failed for id: ${routeParamId}`, scanError);
            res.status(500).json({
                error: `Item lookup failed: ${scanError.message}`,
                code: scanError.code,
                details: "The partition-key Query failed. Verify DynamoDB table name ('Simple'), region, and IAM permissions.",
                awsRequestId: scanError.requestId
            });
            return;
        }

        const getParams = {
            TableName: 'Simple',
            // `Simple` uses a composite key: `id` (partition) + `createdAt`
            // (sort). The sort value has to be read back off the row itself,
            // which is why it was fetched above before addressing the item.
            Key: {
                id: routeParamId,
                createdAt: createdAtValue
            }
        };
        // logger.debug('Attempting to get item with params:', JSON.stringify(getParams, null, 2)); // Logged by minimal test

        try {
            const getItemResult = await dynamodb.send(new GetCommand(getParams));
            item = getItemResult.Item;
        } catch (getError) {
            logger.error('Error getting item (after minimal test passed or was skipped):', getError);
            res.status(500).json({ 
                error: `Failed to get data from DynamoDB (main logic): ${getError.message}`,
                code: getError.code,
                details: 'The `Key` provided (e.g., {"id":"value"}) does not match the primary key schema of the `Simple` table in DynamoDB. Please verify the table schema (Partition Key and any Sort Key names/types) in the AWS console and update the Key object in the backend code accordingly.',
                awsRequestId: getError.requestId
            });
            return;
        }

        if (!item) {
            res.status(400);
            throw new Error('Data not found.');
        }

        // Extract the creator ID from the item's text attribute, up to the next
        // `|` delimiter — IDs vary in length (legacy 24-char ObjectIds vs new
        // 32-char crypto hex IDs).
        const creatorMatch = item.text.match(/(?:^|\|)Creator:([^|]+)/);
        const dataCreator = creatorMatch ? creatorMatch[1].trim() : '';

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
                id: routeParamId,
                createdAt: item ? item.createdAt : null
            }
        };
        logger.debug('Attempting to delete item with params:', JSON.stringify(deleteParams, null, 2)); // Diagnostic log

        try {
            await dynamodb.send(new DeleteCommand(deleteParams));

            // The deleted item counted toward this user's storage, so the
            // cached figure has to be re-derived on the next read.
            invalidateStorageUsage(req.user.id);
            res.status(200).json({ id: routeParamId });
        } catch (deleteError) {
            logger.error('Error deleting data:', deleteError);
            res.status(500).json({ error: 'Failed to delete data' });
        }
    } catch (error) {
        logger.error('Error deleting data (outer try-catch):', error);
        // Ensure a consistent error structure if it's not a DynamoDB specific error initially
        const errorMessage = error.message || 'An unexpected error occurred during deletion.';
        const statusCode = error.statusCode || 500;
        // Add more detail to the error response if it's a ValidationException from the get/delete operations
        if (error.code === 'ValidationException' || (error.originalError && error.originalError.code === 'ValidationException')) {
             res.status(statusCode).json({ 
                error: `DynamoDB Validation Error (outer catch): ${error.message}`,
                code: error.code,
                details: 'The `Key` provided for get/delete does not match the primary key schema of the `Simple` table. Verify the table schema (Partition Key and any Sort Key names/types) in the AWS console and update the backend code.',
                awsRequestId: error.requestId
            });
        } else {
            res.status(statusCode).json({ error: errorMessage });
        }
    }
});

// DELETE: Delete a payment method
const deletePaymentMethod = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const s = getStripe(req.user?.id);
    const ownCustomerId = extractCustomerId(req.user?.text || '');
    if (!ownCustomerId) {
        res.status(403);
        throw new Error('Unauthorized: no payment customer on record.');
    }
    const pm = await s.paymentMethods.retrieve(id);
    if (!pm || pm.customer !== ownCustomerId) {
        res.status(403);
        throw new Error('Unauthorized: you can only detach your own payment methods.');
    }
    await s.paymentMethods.detach(id);
    res.status(200).json({ id });
});

// DETELE: Delete a customer
const deleteCustomer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Ownership check: the target Stripe customer must be the caller's own.
    const ownCustomerId = extractCustomerId(req.user?.text || '');
    if (!ownCustomerId || ownCustomerId !== id) {
        res.status(403);
        throw new Error('Unauthorized: you can only delete your own payment customer.');
    }
    const s = getStripe(req.user?.id);
    await s.customers.del(id);
    res.status(200).json({ id });
});

module.exports = { deleteHashData, deletePaymentMethod, deleteCustomer }; // Export the controller functions