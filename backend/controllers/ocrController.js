// ocrController.js - Handles OCR extraction from images

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { checkIP } = require('../utils/accessData.js');
const { trackApiUsage, canMakeApiCall } = require('../utils/apiUsageTracker.js');

// LLM Providers
require('dotenv').config();
let openaiClient, anthropicClient, googleClient;

// Initialize LLM clients
async function initializeLLMClients() {
    if (!openaiClient) {
        const { OpenAI } = require('openai');
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_KEY
        });
    }
    // Add other LLM clients here when needed
    // anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
    // googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
}

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// OCR Provider Functions
async function processWithGoogleVision(imageData, model = 'default') {
    // Google Vision API implementation
    // This would require setting up Google Cloud credentials and Vision API
    try {
        console.log('Processing with Google Vision API, model:', model);
        
        // Placeholder for Google Vision API call
        // const vision = require('@google-cloud/vision');
        // const client = new vision.ImageAnnotatorClient();
        // const request = { image: { content: imageData } };
        // const [result] = await client.textDetection(request);
        
        // For now, return mock data
        return {
            extractedText: "Mock OCR result from Google Vision API",
            confidence: 0.95,
            provider: 'google-vision',
            model: model
        };
    } catch (error) {
        console.error('Google Vision API error:', error);
        throw new Error(`Google Vision API failed: ${error.message}`);
    }
}

async function processWithAzureOCR(imageData, model = 'default') {
    // Azure Computer Vision API implementation
    try {
        console.log('Processing with Azure Computer Vision, model:', model);
        
        // Placeholder for Azure Computer Vision API call
        // const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
        // const { ApiKeyCredentials } = require('@azure/ms-rest-js');
        
        // For now, return mock data
        return {
            extractedText: "Mock OCR result from Azure Computer Vision",
            confidence: 0.92,
            provider: 'azure-ocr',
            model: model
        };
    } catch (error) {
        console.error('Azure Computer Vision error:', error);
        throw new Error(`Azure Computer Vision failed: ${error.message}`);
    }
}

async function processWithAWSTextract(imageData, model = 'default') {
    // AWS Textract implementation
    try {
        console.log('Processing with AWS Textract, model:', model);
        
        // Placeholder for AWS Textract API call
        // const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
        
        // For now, return mock data
        return {
            extractedText: "Mock OCR result from AWS Textract",
            confidence: 0.88,
            provider: 'aws-textract',
            model: model
        };
    } catch (error) {
        console.error('AWS Textract error:', error);
        throw new Error(`AWS Textract failed: ${error.message}`);
    }
}

async function processWithTesseract(imageData, model = 'default') {
    // Tesseract.js implementation for local OCR
    try {
        console.log('Processing with Tesseract (local), model:', model);
        
        // This would require tesseract.js
        // const Tesseract = require('tesseract.js');
        // const { data: { text } } = await Tesseract.recognize(Buffer.from(imageData, 'base64'));
        
        // For now, return mock data with realistic handwriting detection
        const mockTexts = [
            "9:00 AM - Planning launch strategy\n10:30 AM - Team meeting\n11:00 AM - Code review\n2:00 PM - Client call",
            "8:30 Meeting prep\n9:00 Stand-up meeting\n10:15 Development work\n12:00 Lunch break\n1:00 PM Documentation",
            "Morning: Research competitor analysis\nAfternoon: Product design review\nEvening: Performance optimization",
            "Tasks:\n- Fix bug #123\n- Update documentation\n- Review pull requests\n- Prepare presentation"
        ];
        
        const randomText = mockTexts[Math.floor(Math.random() * mockTexts.length)];
        
        return {
            extractedText: randomText,
            confidence: 0.85,
            provider: 'tesseract',
            model: model
        };
    } catch (error) {
        console.error('Tesseract error:', error);
        throw new Error(`Tesseract failed: ${error.message}`);
    }
}

// LLM Post-processing function
async function postProcessWithLLM(ocrText, llmProvider, llmModel, userId) {
    try {
        console.log(`Post-processing OCR with ${llmProvider}:${llmModel}`);
        
        // Check if user can make LLM API call
        const canMakeCall = await canMakeApiCall(userId, 'openai'); // For now, use openai limits for all providers
        if (!canMakeCall.canMake) {
            console.log('LLM API call blocked:', canMakeCall.reason);
            return {
                error: 'API usage limit reached',
                reason: canMakeCall.reason,
                originalText: ocrText
            };
        }

        await initializeLLMClients();
        
        const prompt = `You are an AI assistant specialized in processing OCR-extracted text from productivity and action tracking images. 

The following text was extracted from an image using OCR:
"""
${ocrText}
"""

Please analyze and enhance this text for productivity tracking purposes by:
1. Correcting any obvious OCR errors or typos
2. Formatting time entries, meetings, and tasks clearly
3. Extracting actionable items and timeframes
4. Organizing the content in a structured, readable format
5. Adding context that would be useful for productivity analysis

Provide the enhanced text in a clear, structured format that would be valuable for action tracking and productivity analysis.`;

        let response, inputTokens, outputTokens, modelUsed;
        
        switch (llmProvider) {
            case 'openai':
                modelUsed = llmModel || 'o1-mini';
                response = await openaiClient.chat.completions.create({
                    model: modelUsed,
                    messages: [{ role: 'user', content: prompt }],
                    max_completion_tokens: 1000
                });
                
                inputTokens = response.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
                outputTokens = response.usage?.completion_tokens || Math.ceil(response.choices[0].message.content.length / 4);
                
                // Track usage
                await trackApiUsage(userId, 'openai', {
                    inputTokens: inputTokens,
                    outputTokens: outputTokens
                }, modelUsed);
                
                return {
                    enhancedText: response.choices[0].message.content,
                    provider: llmProvider,
                    model: modelUsed,
                    originalText: ocrText
                };
                
            case 'anthropic':
                // Placeholder for Anthropic implementation
                return {
                    enhancedText: `Enhanced by Anthropic ${llmModel}: ${ocrText}`,
                    provider: llmProvider,
                    model: llmModel,
                    originalText: ocrText
                };
                
            case 'google':
                // Placeholder for Google implementation  
                return {
                    enhancedText: `Enhanced by Google ${llmModel}: ${ocrText}`,
                    provider: llmProvider,
                    model: llmModel,
                    originalText: ocrText
                };
                
            default:
                throw new Error(`Unsupported LLM provider: ${llmProvider}`);
        }
        
    } catch (error) {
        console.error('LLM post-processing error:', error);
        return {
            error: `LLM processing failed: ${error.message}`,
            originalText: ocrText
        };
    }
}

// @desc    Extract text from image using OCR
// @route   POST /api/data/ocr-extract  
// @access  Private
const extractOCR = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    // Check for user authentication
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const { imageData, contentType, filename, method, model, llmProvider, llmModel } = req.body;
    
    if (!imageData) {
        res.status(400);
        throw new Error('No image data provided');
    }

    if (!contentType || !contentType.startsWith('image/')) {
        res.status(400);
        throw new Error('Invalid content type. Must be an image');
    }

    console.log(`OCR extraction request - Method: ${method}, Model: ${model}, File: ${filename}`);
    
    try {
        let ocrResult;
        
        // Route to appropriate OCR provider
        switch (method) {
            case 'google-vision':
                ocrResult = await processWithGoogleVision(imageData, model);
                break;
            case 'azure-ocr':
                ocrResult = await processWithAzureOCR(imageData, model);
                break;
            case 'aws-textract':
                ocrResult = await processWithAWSTextract(imageData, model);
                break;
            case 'tesseract':
            default:
                ocrResult = await processWithTesseract(imageData, model);
                break;
        }
        
        // Post-process with LLM if provider is specified
        let finalResult = ocrResult;
        if (llmProvider && llmProvider !== 'none') {
            console.log(`Starting LLM post-processing with ${llmProvider}:${llmModel}`);
            const llmResult = await postProcessWithLLM(
                ocrResult.extractedText, 
                llmProvider, 
                llmModel, 
                req.user.id
            );
            
            if (llmResult.error) {
                // If LLM processing fails, still return OCR results with error info
                finalResult = {
                    ...ocrResult,
                    llmError: llmResult.error,
                    llmReason: llmResult.reason
                };
            } else {
                // Merge LLM results with OCR results
                finalResult = {
                    ...ocrResult,
                    extractedText: llmResult.enhancedText,
                    originalOcrText: ocrResult.extractedText,
                    llmProvider: llmResult.provider,
                    llmModel: llmResult.model
                };
            }
        }
        
        // Add metadata to the result
        const response = {
            ...finalResult,
            filename: filename,
            contentType: contentType,
            processedAt: new Date().toISOString(),
            userId: req.user.id
        };
        
        console.log(`OCR processing completed - Provider: ${finalResult.provider}, Confidence: ${finalResult.confidence}`);
        if (llmProvider && !finalResult.llmError) {
            console.log(`LLM enhancement completed - Provider: ${llmProvider}, Model: ${llmModel}`);
        }
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('OCR extraction error:', error);
        res.status(500).json({ error: `OCR processing failed: ${error.message}` });
    }
});

// @desc    Update data item with OCR results
// @route   PUT /api/data/ocr-update/:id
// @access  Private  
const updateWithOCR = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    // Check for user authentication
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const itemId = req.params.id;
    const { ocrText, originalText } = req.body;
    
    if (!ocrText) {
        res.status(400);
        throw new Error('No OCR text provided');
    }

    console.log(`OCR update request for item: ${itemId}`);
    
    try {
        // First, scan for the item to verify ownership and get current data
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: 'id = :itemId',
            ExpressionAttributeValues: {
                ':itemId': itemId
            }
        };

        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        
        if (!scanResult.Items || scanResult.Items.length === 0) {
            res.status(404);
            throw new Error('Data item not found');
        }

        const item = scanResult.Items[0];
        
        // Check ownership
        if (item.text && item.text.includes('Creator:')) {
            const dataCreator = item.text.substring(item.text.indexOf("Creator:") + 8, item.text.indexOf("Creator:") + 8 + 24);
            if (dataCreator !== req.user.id) {
                res.status(401);
                throw new Error('User not authorized to update this item');
            }
        }

        // Update the text with OCR results
        // Find the Action: field and append OCR text
        let updatedText = item.text;
        
        // Look for |Action: pattern and insert OCR text
        const actionMatch = updatedText.match(/(\|Action:)([^|]*?)(\||$)/);
        if (actionMatch) {
            // If there's already text in Action field, append OCR text
            const existingActionText = actionMatch[2];
            const newActionText = existingActionText.trim() ? 
                `${existingActionText.trim()}\n\nRich Action Data Extracted:\n${ocrText}` : 
                `Rich Action Data Extracted:\n${ocrText}`;
            
            updatedText = updatedText.replace(
                actionMatch[0], 
                `${actionMatch[1]}${newActionText}${actionMatch[3] ? actionMatch[3] : ''}`
            );
        } else {
            // If no Action field exists, add one
            updatedText += `|Action:Rich Action Data Extracted:\n${ocrText}`;
        }

        // Update the item in DynamoDB
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...item,
                text: updatedText,
                updatedAt: new Date().toISOString()
            }
        };

        await dynamodb.send(new PutCommand(putParams));

        console.log(`Successfully updated item ${itemId} with OCR results`);
        
        res.status(200).json({
            success: true,
            message: 'Item updated with OCR results',
            updatedItem: putParams.Item
        });
        
    } catch (error) {
        console.error('Error updating item with OCR:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to update item: ${error.message}` });
        }
    }
});

module.exports = {
    extractOCR,
    updateWithOCR
};