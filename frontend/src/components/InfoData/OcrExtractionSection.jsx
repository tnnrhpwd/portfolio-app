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
              <option value="azure-ocr">Azure Computer Vision</option>
              <option value="aws-textract">AWS Textract</option>
              <option value="tesseract">Tesseract (Local, Default)</option>
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
              <option value="default">Default</option>
              <option value="handwriting">Handwriting Enhanced</option>
              <option value="document">Document Text</option>
              <option value="table">Table Detection</option>
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
              <option value="deepseek">DeepSeek (Default)</option>
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
              <option value="deepseek-chat">DeepSeek-V3 Chat (Default)</option>
              <option value="deepseek-reasoner">DeepSeek-R1 Reasoner</option>
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
