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
    try {
        console.log('Processing with Google Vision API, model:', model);
        
        if (process.env.GOOGLE_CLOUD_KEY_FILE) {
            const vision = require('@google-cloud/vision');
            const client = new vision.ImageAnnotatorClient({
                keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE
            });
            
            const request = { 
                image: { content: Buffer.from(imageData, 'base64') },
                features: [
                    { type: 'TEXT_DETECTION' },
                    { type: 'DOCUMENT_TEXT_DETECTION' }
                ]
            };
            
            const [result] = await client.annotateImage(request);
            const textAnnotations = result.textAnnotations;
            
            if (textAnnotations && textAnnotations.length > 0) {
                const extractedText = textAnnotations[0].description;
                const confidence = textAnnotations[0].confidence || 0.9;
                
                return {
                    extractedText: extractedText,
                    confidence: confidence,
                    provider: 'google-vision',
                    model: model
                };
            } else {
                return {
                    extractedText: "No text detected in image",
                    confidence: 0.0,
                    provider: 'google-vision',
                    model: model
                };
            }
        } else {
            console.log('Google Vision API credentials not configured, using OpenAI Vision as fallback');
            return await processWithOpenAIVision(imageData, model);
        }
        
    } catch (error) {
        console.error('Google Vision API error:', error);
        console.log('Falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
    }
}

async function processWithOpenAIVision(imageData, model = 'gpt-4o') {
    // OpenAI Vision API implementation - Production default
    try {
        console.log('Processing with OpenAI Vision API, model:', model);
        
        await initializeLLMClients();
        
        if (!openaiClient) {
            throw new Error('OpenAI client not initialized');
        }
        
        const response = await openaiClient.chat.completions.create({
            model: model || 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Extract all text from this image. Focus on handwritten notes, printed text, schedules, tasks, and any productivity-related content. Maintain the original structure and formatting as much as possible. If there are time entries, meetings, or action items, preserve their format.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageData}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        });
        
        const extractedText = response.choices[0]?.message?.content || 'No text detected';
        
        return {
            extractedText: extractedText,
            confidence: 0.95, // OpenAI Vision is generally very accurate
            provider: 'openai-vision',
            model: model || 'gpt-4o',
            usage: response.usage
        };
        
    } catch (error) {
        console.error('OpenAI Vision API error:', error);
        throw new Error(`OpenAI Vision failed: ${error.message}`);
    }
}

async function processWithAzureOCR(imageData, model = 'default') {
    // Azure Computer Vision API implementation
    try {
        console.log('Processing with Azure Computer Vision, model:', model);
        
        if (process.env.AZURE_COMPUTER_VISION_KEY && process.env.AZURE_COMPUTER_VISION_ENDPOINT) {
            const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
            const { ApiKeyCredentials } = require('@azure/ms-rest-js');
            
            const computerVisionClient = new ComputerVisionClient(
                new ApiKeyCredentials({ 
                    inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_COMPUTER_VISION_KEY } 
                }),
                process.env.AZURE_COMPUTER_VISION_ENDPOINT
            );
            
            const imageBuffer = Buffer.from(imageData, 'base64');
            const readResult = await computerVisionClient.readInStream(imageBuffer);
            
            // Get operation ID from the operation URL
            const operationId = readResult.operationLocation.split('/').slice(-1)[0];
            
            // Wait for the operation to complete
            let result;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                result = await computerVisionClient.getReadResult(operationId);
            } while (result.status === 'running' || result.status === 'notStarted');
            
            if (result.status === 'succeeded') {
                let extractedText = '';
                for (const page of result.analyzeResult.readResults) {
                    for (const line of page.lines) {
                        extractedText += line.text + '\n';
                    }
                }
                
                return {
                    extractedText: extractedText.trim(),
                    confidence: 0.92,
                    provider: 'azure-ocr',
                    model: model
                };
            } else {
                throw new Error('Azure OCR operation failed');
            }
        } else {
            console.log('Azure Computer Vision credentials not configured, using OpenAI Vision as fallback');
            return await processWithOpenAIVision(imageData, model);
        }
        
    } catch (error) {
        console.error('Azure Computer Vision error:', error);
        console.log('Falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
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
        
        const Tesseract = require('tesseract.js');
        
        // Configure Tesseract options based on model
        let tesseractOptions = {
            logger: m => console.log(m) // Optional logging
        };
        
        switch (model) {
            case 'handwriting':
                tesseractOptions.tessedit_char_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?:;-/() \n';
                break;
            case 'document':
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.SINGLE_BLOCK;
                break;
            case 'table':
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.SINGLE_UNIFORM_BLOCK;
                break;
            default:
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.AUTO;
        }
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // Perform OCR
        const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, 'eng', tesseractOptions);
        
        return {
            extractedText: text.trim(),
            confidence: confidence / 100, // Tesseract returns confidence as 0-100, normalize to 0-1
            provider: 'tesseract',
            model: model
        };
        
    } catch (error) {
        console.error('Tesseract error:', error);
        
        // Fallback to OpenAI Vision if Tesseract fails
        console.log('Tesseract failed, falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
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
            case 'openai-vision':
            default:
                ocrResult = await processWithOpenAIVision(imageData, model);
                break;
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