// deleteData.js

const AWS = require('aws-sdk');
const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');

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

        await dynamodb.delete(params).promise();

        res.status(200).json({ id: dataId });
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = { deleteData };