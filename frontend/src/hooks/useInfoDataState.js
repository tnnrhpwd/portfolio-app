import { useState } from 'react';

/**
 * Custom hook to manage all state variables for InfoData component
 * @returns {Object} State variables and their setters
 */
export const useInfoDataState = () => {
  const [chosenData, setChosenData] = useState(null);
  const [showDeleteDataConfirmation, setShowDeleteDataConfirmation] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMethod, setOcrMethod] = useState('xai-vision');
  const [ocrModel, setOcrModel] = useState('grok-4');
  const [llmProvider, setLlmProvider] = useState('xai');
  const [llmModel, setLlmModel] = useState('grok-4');
  const [editedDataText, setEditedDataText] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);

  return {
    // Chosen data
    chosenData,
    setChosenData,
    
    // Delete confirmation
    showDeleteDataConfirmation,
    setShowDeleteDataConfirmation,
    
    // Comments
    commentText,
    setCommentText,
    comments,
    setComments,
    commentsLoading,
    setCommentsLoading,
    
    // OCR settings
    ocrLoading,
    setOcrLoading,
    ocrMethod,
    setOcrMethod,
    ocrModel,
    setOcrModel,
    llmProvider,
    setLlmProvider,
    llmModel,
    setLlmModel,
    
    // Editing
    editedDataText,
    setEditedDataText,
    
    // File upload
    showFileUpload,
    setShowFileUpload,
  };
};
