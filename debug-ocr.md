# OCR Debugging Guide

## Current Error
```
:3000/api/data/ocr-extract:1   Failed to load resource: the server responded with a status of 500 (Internal Server Error)
InfoData.jsx:526  Error extracting OCR: Error: OCR processing failed: 500
```

## Step 1: Check Backend Environment Variables

The OCR controller requires these environment variables:
- `OPENAI_KEY` - OpenAI API key (primary OCR provider)
- `AWS_REGION` - AWS region for DynamoDB
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials

## Step 2: Check Backend Logs

Look for specific error messages in your backend console when the OCR endpoint is called.

## Step 3: Debug Request Data

The frontend is sending:
```javascript
{
  imageData: base64String,
  contentType: "image/jpeg" (or similar),
  filename: "filename.jpg",
  method: "openai-vision" (default),
  model: "gpt-4o" (default),
  llmProvider: undefined,
  llmModel: undefined
}
```

## Step 4: Common Issues & Solutions

### Issue 1: Missing OpenAI API Key
**Solution**: Add `OPENAI_KEY` to your backend `.env` file

### Issue 2: Invalid Image Data
**Solution**: Check if the base64 image data is properly formatted

### Issue 3: Authentication Token Issues
**Solution**: Check if the user token is valid and properly passed

### Issue 4: DynamoDB Connection Issues
**Solution**: Verify AWS credentials and region settings

## Step 5: Test with Minimal Request

Try testing with a simple API client (like Postman) with this payload:
```json
{
  "imageData": "valid_base64_image_data",
  "contentType": "image/jpeg",
  "filename": "test.jpg",
  "method": "openai-vision"
}
```

## Quick Fixes to Try:

1. **Add Error Logging**: Add console.error in the backend controller
2. **Check Environment**: Verify all required env vars are set
3. **Test API Keys**: Verify OpenAI API key is working
4. **Simplify Request**: Remove optional parameters (llmProvider, llmModel)