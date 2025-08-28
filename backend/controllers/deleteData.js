// deleteData.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
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

// @desc    Delete data
// @route   DELETE /api/data/:id
// @access  Private
const deleteData = asyncHandler(async (req, res) => {
    try {
        await checkIP(req);
        const dataId = req.params.id;

        const params = {
            TableName: 'Simple', 
            Key: {
                id: dataId // ID of the item to delete
            }
        };

        await dynamodb.send(new DeleteCommand(params));

        res.status(200).json({ id: dataId });
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = { deleteData };