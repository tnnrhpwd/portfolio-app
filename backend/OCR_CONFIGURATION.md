# OCR Backend Configuration Guide

This document explains how to configure the production OCR backend for your application.

## Overview

The OCR backend now supports multiple providers with OpenAI Vision as the default production method. The system includes automatic fallbacks to ensure reliability.

## Default Production Configuration

**Primary Method**: OpenAI Vision API (gpt-4o)
- Uses your existing `OPENAI_KEY`
- Excellent for handwritten notes and complex layouts  
- Automatic fallback to Tesseract if OpenAI fails

**Fallback Method**: Tesseract.js (Local)
- No API keys required
- Works offline
- Good for printed text

## Environment Variables

### Required (Already configured)
```bash
OPENAI_KEY=your_openai_api_key_here
```

### Optional OCR Providers

#### Google Cloud Vision API
```bash
# Path to your service account key file
GOOGLE_CLOUD_KEY_FILE=/path/to/your/google-cloud-credentials.json
```

#### Azure Computer Vision
```bash
AZURE_COMPUTER_VISION_KEY=your_azure_key_here
AZURE_COMPUTER_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
```

#### AWS Textract (Future)
```bash
AWS_ACCESS_KEY_ID=your_aws_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
```

## Installation

1. **Install Dependencies**:
   ```bash
   cd backend
   node install-ocr-deps.js
   ```

2. **Restart your backend server**:
   ```bash
   npm run dev
   ```

## OCR Method Priority

1. **openai-vision** (Default/Recommended)
   - Models: gpt-4o, gpt-4o-mini, gpt-4-turbo
   - Best for: Handwritten notes, complex layouts, context understanding
   - Fallback: Tesseract

2. **google-vision** 
   - Requires: GOOGLE_CLOUD_KEY_FILE
   - Best for: High-accuracy printed text
   - Fallback: OpenAI Vision

3. **azure-ocr**
   - Requires: AZURE_COMPUTER_VISION_KEY + AZURE_COMPUTER_VISION_ENDPOINT  
   - Best for: Document processing, batch operations
   - Fallback: OpenAI Vision

4. **tesseract**
   - No API keys required
   - Best for: Offline processing, privacy-sensitive content
   - Fallback: OpenAI Vision

5. **aws-textract** (Placeholder for future implementation)
   - Requires: AWS credentials
   - Best for: Form processing, table extraction

## LLM Post-Processing

After OCR extraction, the text is automatically enhanced using your selected LLM provider:

- **OpenAI**: o1-mini (default), gpt-4o, etc.
- **Anthropic**: Claude models (requires ANTHROPIC_KEY)
- **Google**: Gemini models (requires GOOGLE_AI_KEY)

The LLM enhancement:
- Corrects OCR errors
- Formats time entries and tasks
- Extracts actionable items
- Organizes content for productivity analysis

## Usage Tracking

- All API calls are tracked for billing and limits
- OpenAI Vision calls count toward your OpenAI usage limits
- LLM post-processing is separate from OCR usage

## Troubleshooting

### Common Issues

1. **"OCR processing failed"**
   - Check your OPENAI_KEY is valid
   - Verify image is properly encoded in base64
   - Check server logs for specific error details

2. **"No text detected"**
   - Image quality may be too low
   - Try a different OCR method
   - Ensure image contains readable text

3. **"API usage limit reached"**
   - Check your OpenAI account billing
   - Usage limits are configured in apiUsageTracker.js

### Performance Tips

- **gpt-4o**: Best quality, slower, more expensive
- **gpt-4o-mini**: Good quality, faster, cheaper
- **Tesseract**: Free, works offline, good for printed text
- **Google Vision**: Very accurate, requires setup

## Security Notes

- All OCR processing happens server-side
- Images are not stored permanently  
- API keys should be kept secure in environment variables
- Consider using Google Cloud or Azure for sensitive documents (data residency)

## Future Enhancements

- AWS Textract implementation
- Batch OCR processing
- Custom model fine-tuning
- Enhanced table detection
- Multi-language support

---

Need help? Check the server logs or contact the development team.