// updateData.js

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

// @desc    Put Data
// @route   PUT /api/data/:id
// @access  Private
const putData = asyncHandler(async (req, res) => {
    await checkIP(req);
    console.log('Update Data Request:', req.body);

    // Check for user
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    console.log('User:', req.user);
    console.log('req.params.id:', req.params.id);

    try {
        const dataId = req.params.id;

        const params = {
            TableName: 'Simple', 
            Key: {
                id: dataId // ID of the item to update
            },
            UpdateExpression: 'set text = :text, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':text': req.body.text,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await dynamodb.update(params).promise();

        console.log('Updated data:', result.Attributes);
        res.status(200).json(result.Attributes);
    } catch (error) {
        console.error('Error during data update:', error);
        res.status(500);
        throw new Error('Server error');
    }
});

module.exports = { putData };