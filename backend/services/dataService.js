const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

// Configure AWS DynamoDB Client
const awsClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(awsClient);

/**
 * Validate and process uploaded files
 * @param {Array} files - Array of multer file objects
 * @returns {Array} Processed files data
 */
function validateAndProcessFiles(files) {
    if (!files || files.length === 0) {
        return [];
    }

    console.log('Processing files:', files.length);
    
    const maxFileSize = 300 * 1024; // 300KB per file
    const maxTotalSize = 350 * 1024; // 350KB total
    
    // Validate individual file sizes
    const oversizedFiles = files.filter(file => file.size > maxFileSize);
    if (oversizedFiles.length > 0) {
        const fileNames = oversizedFiles.map(f => f.originalname).join(', ');
        console.log('Files rejected - too large:', fileNames);
        const error = new Error(`Files too large: ${fileNames}. Maximum size is 300KB per file.`);
        error.statusCode = 413;
        throw error;
    }
    
    // Validate total size
    const totalFileSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalFileSize > maxTotalSize) {
        console.log('Files rejected - total size too large:', Math.round(totalFileSize/1024), 'KB');
        const error = new Error(`Total file size (${Math.round(totalFileSize/1024)}KB) exceeds limit of 350KB.`);
        error.statusCode = 413;
        throw error;
    }
    
    // Process files to base64
    const filesData = files.map(file => ({
        filename: file.originalname,
        contentType: file.mimetype,
        data: file.buffer.toString('base64')
    }));
    
    console.log('Files processed successfully:', filesData.length);
    return filesData;
}

/**
 * Parse request body to extract text content, action group object, and files
 * @param {Object} req - Express request object
 * @param {Array} processedFiles - Already processed files from multer
 * @returns {Object} Parsed data containing textContent, actionGroupObjectContent, filesData
 */
function parseRequestData(req, processedFiles = []) {
    let textContent;
    let actionGroupObjectContent;
    let filesData = processedFiles;

    const isMultipart = req.headers['content-type'] && 
                       req.headers['content-type'].startsWith('multipart/form-data');

    if (isMultipart) {
        // Handle multipart/form-data
        textContent = req.body.data || req.body.Text;
        console.log('Extracted textContent from FormData:', textContent);

        // Parse ActionGroupObject
        if (req.body.ActionGroupObject) {
            if (typeof req.body.ActionGroupObject === 'string') {
                try {
                    actionGroupObjectContent = JSON.parse(req.body.ActionGroupObject);
                } catch (e) {
                    console.warn('Failed to parse ActionGroupObject from multipart form field. Value:', req.body.ActionGroupObject);
                    actionGroupObjectContent = null;
                }
            } else {
                actionGroupObjectContent = req.body.ActionGroupObject;
            }
        }
        
        // Parse Files field if no files were uploaded via multer
        if (filesData.length === 0 && req.body.Files && typeof req.body.Files === 'string') {
            try {
                const parsedFilesField = JSON.parse(req.body.Files);
                if (Array.isArray(parsedFilesField)) {
                    filesData = parsedFilesField;
                }
            } catch (e) {
                console.warn('Failed to parse "Files" field from multipart form data.');
            }
        }
    } else {
        // Handle application/json
        if (req.body.text) {
            textContent = req.body.text;
            actionGroupObjectContent = req.body.ActionGroupObject;
            if (Array.isArray(req.body.Files) && filesData.length === 0) {
                filesData = req.body.Files;
            }
        } else if (req.body.data) {
            let jsonDataPayload = req.body.data;
            
            // Parse data if it's a string
            if (typeof jsonDataPayload === 'string') {
                try {
                    jsonDataPayload = JSON.parse(jsonDataPayload);
                } catch (e) {
                    // If it's a string but not JSON, assume it's the text content itself
                    textContent = jsonDataPayload;
                    jsonDataPayload = null;
                }
            }

            if (jsonDataPayload) {
                textContent = jsonDataPayload.Text;
                actionGroupObjectContent = jsonDataPayload.ActionGroupObject;
                if (Array.isArray(jsonDataPayload.Files) && filesData.length === 0) {
                    filesData = jsonDataPayload.Files;
                }
            }
        } else {
            const error = new Error('Please provide either a data field or text field for application/json. req: ' + JSON.stringify(req.body));
            error.statusCode = 400;
            throw error;
        }
    }

    console.log('Final textContent:', textContent);
    console.log('Final actionGroupObjectContent:', actionGroupObjectContent);
    console.log('Final filesData:', filesData);

    if (!textContent) {
        console.error('Text content validation failed - textContent is empty or undefined');
        const error = new Error('Text content is missing or could not be determined from the request.');
        error.statusCode = 400;
        throw error;
    }

    return { textContent, actionGroupObjectContent, filesData };
}

/**
 * Create and save a DynamoDB item
 * @param {string} userId - User ID
 * @param {string} textContent - Text content
 * @param {Object} actionGroupObjectContent - Action group object
 * @param {Array} filesData - Files data
 * @returns {Object} Created DynamoDB item
 */
async function createDynamoDBItem(userId, textContent, actionGroupObjectContent, filesData) {
    console.log('Creating DynamoDB item...');
    
    const params = {
        TableName: 'Simple',
        Item: {
            id: crypto.randomBytes(16).toString("hex"),
            text: `Creator:${userId}|` + textContent,
            ActionGroupObject: actionGroupObjectContent,
            files: filesData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };

    // Validate item size
    const itemSizeBytes = JSON.stringify(params.Item).length;
    const maxDynamoDBSize = 400 * 1024; // 400KB DynamoDB limit
    
    console.log('DynamoDB params:', {
        TableName: params.TableName,
        itemKeys: Object.keys(params.Item),
        textLength: params.Item.text?.length,
        filesCount: params.Item.files?.length || 0,
        totalItemSize: Math.round(itemSizeBytes / 1024) + 'KB'
    });

    if (itemSizeBytes > maxDynamoDBSize) {
        console.error('Item size exceeds DynamoDB limit:', Math.round(itemSizeBytes/1024), 'KB > 400KB');
        const error = new Error(`Item size (${Math.round(itemSizeBytes/1024)}KB) exceeds DynamoDB limit of 400KB. Please reduce file sizes or content.`);
        error.statusCode = 413;
        throw error;
    }

    try {
        console.log('Sending to DynamoDB...');
        await dynamodb.send(new PutCommand(params));
        console.log('DynamoDB write successful');
        return params.Item;
    } catch (error) {
        console.error('=== DynamoDB Error ===');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Full error:', error);
        const err = new Error('Failed to create data: ' + error.message);
        err.statusCode = 500;
        throw err;
    }
}

module.exports = {
    validateAndProcessFiles,
    parseRequestData,
    createDynamoDBItem,
    dynamodb
};
