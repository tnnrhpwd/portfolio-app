import React from 'react';
import { useNavigate } from 'react-router-dom';
import Spinner from '../Spinner/Spinner';

/**
 * OCR extraction controls component
 * @param {Object} props - Component props
 */
const OcrExtractionSection = ({
  files,
  isOwner,
  ocrLoading,
  ocrMethod,
  ocrModel,
  llmProvider,
  llmModel,
  onMethodChange,
  onModelChange,
  onLlmProviderChange,
  onLlmModelChange,
  onExtract
}) => {
  const navigate = useNavigate();

  // Only show if there are image files
  const hasImages = files && files.some(file => 
    file.contentType?.startsWith('image/') || file.fileType?.startsWith('image/')
  );

  if (!isOwner || !hasImages) return null;

  return (
    <div className='infodata-ocr-section'>
      <div className='infodata-ocr-header'>
        <h3>Extract Rich Action Data</h3>
        <p>Process images to extract text and time data for productivity tracking</p>
        <p style={{ fontSize: '0.9em', color: 'var(--text-color-accent)', marginTop: '8px' }}>
          Using: {ocrMethod} + {llmProvider}:{llmModel} for enhanced processing
        </p>
      </div>
      
      <div className='infodata-ocr-controls'>
        <div className='infodata-ocr-dropdowns'>
          <div className='infodata-ocr-dropdown-group'>
            <label htmlFor="ocrMethod">OCR Method:</label>
            <select 
              id="ocrMethod"
              value={ocrMethod} 
              onChange={(e) => onMethodChange(e.target.value)}
              disabled={ocrLoading}
            >
              <option value="xai-vision">XAI Grok Vision (Default)</option>
              <option value="openai-vision">OpenAI Vision</option>
              <option value="google-vision">Google Vision API</option>
              <option value="azure-ocr">Azure Computer Vision</option>
              <option value="aws-textract">AWS Textract</option>
              <option value="tesseract">Tesseract (Local)</option>
            </select>
          </div>
          
          <div className='infodata-ocr-dropdown-group'>
            <label htmlFor="ocrModel">OCR Model:</label>
            <select 
              id="ocrModel"
              value={ocrModel} 
              onChange={(e) => onModelChange(e.target.value)}
              disabled={ocrLoading}
            >
              {ocrMethod === 'xai-vision' ? (
                <>
                  <option value="grok-4">Grok 4 (Default)</option>
                  <option value="grok-4-fast-reasoning">Grok 4 Fast Reasoning</option>
                </>
              ) : ocrMethod === 'openai-vision' ? (
                <>
                  <option value="gpt-4o">GPT-4o (Recommended)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (Faster)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </>
              ) : (
                <>
                  <option value="default">Default</option>
                  <option value="handwriting">Handwriting Enhanced</option>
                  <option value="document">Document Text</option>
                  <option value="table">Table Detection</option>
                </>
              )}
            </select>
          </div>

          <div className='infodata-ocr-dropdown-group'>
            <label htmlFor="llmProvider">LLM Provider:</label>
            <select 
              id="llmProvider"
              value={llmProvider} 
              onChange={(e) => onLlmProviderChange(e.target.value)}
              disabled={ocrLoading}
            >
              <option value="xai">XAI (Grok) - Default</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
            </select>
          </div>

          <div className='infodata-ocr-dropdown-group'>
            <label htmlFor="llmModel">LLM Model:</label>
            <select 
              id="llmModel"
              value={llmModel} 
              onChange={(e) => onLlmModelChange(e.target.value)}
              disabled={ocrLoading}
            >
              {llmProvider === 'openai' && (
                <>
                  <option value="o1-mini">o1-mini (Default)</option>
                  <option value="o1-preview">o1-preview</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </>
              )}
              {llmProvider === 'xai' && (
                <>
                  <option value="grok-4">Grok 4 (Default)</option>
                  <option value="grok-4-fast-reasoning">Grok 4 Fast Reasoning</option>
                </>
              )}
              {llmProvider === 'anthropic' && (
                <>
                  <option value="claude-3-sonnet">Claude 3 Sonnet (Default)</option>
                  <option value="claude-3-opus">Claude 3 Opus</option>
                  <option value="claude-3-haiku">Claude 3 Haiku</option>
                  <option value="claude-2.1">Claude 2.1</option>
                </>
              )}
              {llmProvider === 'google' && (
                <>
                  <option value="gemini-pro">Gemini Pro (Default)</option>
                  <option value="gemini-pro-vision">Gemini Pro Vision</option>
                  <option value="gemini-ultra">Gemini Ultra</option>
                </>
              )}
            </select>
          </div>
        </div>
        
        <div className='infodata-ocr-buttons'>
          <button 
            className='infodata-ocr-extract-btn'
            onClick={onExtract}
            disabled={ocrLoading}
          >
            {ocrLoading ? (
              <>
                <Spinner />
                <span>Extracting...</span>
              </>
            ) : (
              <>
                <span>🔍</span>
                <span>Extract Rich Action Data</span>
              </>
            )}
          </button>
          
          <button 
            className='infodata-ocr-extract-btn'
            onClick={() => navigate('/InfoPlanner')}
            style={{
              background: 'linear-gradient(45deg, var(--fg-orange), var(--fg-pink))'
            }}
          >
            <span>📋</span>
            <span>How to Use Paper Planner</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OcrExtractionSection;
