// deleteData.js

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteHashData = asyncHandler(async (req, res) => {
    const routeParamId = req.params.id;
    console.log(`[DELETEHASH] Attempting to delete item with id from route: ${routeParamId}`);

    // --- Minimal GetItem Test ---
    try {
        console.log(`[DELETEHASH_TEST] Performing minimal getItem test for id: ${routeParamId}`);

        // Scan the table to find the item with the given id
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: 'id = :id',
            ExpressionAttributeValues: {
                ':id': routeParamId
            }
        };

        let createdAtValue;
        try {
            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            if (scanResult.Items && scanResult.Items.length > 0) {
                createdAtValue = scanResult.Items[0].createdAt;
            } else {
                console.log(`[DELETEHASH_TEST] Minimal GetItem Test: Item with id ${routeParamId} not found during scan.`);
                // If item not found, set createdAtValue to null or a default value
                createdAtValue = null;
            }
        } catch (scanError) {
            console.error(`[DELETEHASH_TEST] Minimal GetItem Test: Scan operation failed for id: ${routeParamId}`, scanError);
            res.status(500).json({
                error: `Minimal GetItem Test: Scan operation failed: ${scanError.message}`,
                code: scanError.code,
                details: "The scan operation failed. Verify DynamoDB table name ('Simple'), region, and that the primary key is solely 'id' (String) with no sort key. Also check IAM permissions.",
                awsRequestId: scanError.requestId
            });
            return;
        }

        const testGetParams = {
            TableName: 'Simple',
            Key: {
                id: routeParamId,
                createdAt: createdAtValue // Use the createdAt value from the scan
            }
        };

        console.log('[DELETEHASH_TEST] Minimal GetItem Test Params:', JSON.stringify(testGetParams, null, 2));
        const testItemResult = await dynamodb.send(new GetCommand(testGetParams));
        console.log('[DELETEHASH_TEST] Minimal GetItem Test Result:', JSON.stringify(testItemResult, null, 2));

        if (!testItemResult.Item) {
            console.log(`[DELETEHASH_TEST] Minimal GetItem Test: Item with id ${routeParamId} not found.`);
        } else {
            console.log(`[DELETEHASH_TEST] Minimal GetItem Test: Successfully fetched item with id ${routeParamId}.`);
        }
    } catch (minGetError) {
        console.error(`[DELETEHASH_TEST] Minimal GetItem Test FAILED for id: ${routeParamId}`, minGetError);
        // If this minimal test fails with ValidationException, the issue is very fundamental.
        // Double-check Table Name, Region, and that 'id' (String) is the *only* part of the primary key.
        res.status(500).json({
            error: `Minimal GetItem Test FAILED: ${minGetError.message}`,
            code: minGetError.code,
            details: "This basic GetItem operation failed. Verify DynamoDB table name ('Simple'), region, and that the primary key is solely 'id' (String) with no sort key. Also check IAM permissions.",
            awsRequestId: minGetError.requestId
        });
        return;
    }
    // --- End of Minimal GetItem Test ---

    try {
        await checkIP(req);
        // const id = req.params.id; // Already defined as routeParamId
        // console.log("delete id=" + routeParamId); // Already logged

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

        // Scan the table to find the item with the given id
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: 'id = :id',
            ExpressionAttributeValues: {
                ':id': routeParamId
            }
        };

        try {
            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            if (scanResult.Items && scanResult.Items.length > 0) {
                item = scanResult.Items[0];
                createdAtValue = scanResult.Items[0].createdAt;
            } else {
                console.log(`[DELETEHASH] Item with id ${routeParamId} not found during scan.`);
                res.status(400);
                throw new Error('Data not found.');
            }
        } catch (scanError) {
            console.error(`[DELETEHASH] Scan operation failed for id: ${routeParamId}`, scanError);
            res.status(500).json({
                error: `Scan operation failed: ${scanError.message}`,
                code: scanError.code,
                details: "The scan operation failed. Verify DynamoDB table name ('Simple'), region, and that the primary key is solely 'id' (String) with no sort key. Also check IAM permissions.",
                awsRequestId: scanError.requestId
            });
            return;
        }

        const getParams = {
            TableName: 'Simple',
            Key: {
                id: routeParamId, // This assumes 'id' (String) is the Partition Key
                createdAt: createdAtValue // Need to grab the createdAt value to delete
            }
        };
        // console.log('Attempting to get item with params:', JSON.stringify(getParams, null, 2)); // Logged by minimal test

        try {
            const getItemResult = await dynamodb.send(new GetCommand(getParams));
            item = getItemResult.Item;
        } catch (getError) {
            console.error('Error getting item (after minimal test passed or was skipped):', getError);
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
        // CRITICAL: Ensure this Key definition also matches your DynamoDB 'Simple' table's primary key schema.
        const deleteParams = {
            TableName: 'Simple',
            Key: {
                id: routeParamId, // This assumes 'id' (String) is the Partition Key
                createdAt: item ? item.createdAt : null //Need to grab the createdAt value to delete
            }
        };
        console.log('Attempting to delete item with params:', JSON.stringify(deleteParams, null, 2)); // Diagnostic log

        try {
            await dynamodb.send(new DeleteCommand(deleteParams));
            res.status(200).json({ id: routeParamId });
        } catch (deleteError) {
            console.error('Error deleting data:', deleteError);
            res.status(500).json({ error: 'Failed to delete data' });
        }
    } catch (error) {
        console.error('Error deleting data (outer try-catch):', error);
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