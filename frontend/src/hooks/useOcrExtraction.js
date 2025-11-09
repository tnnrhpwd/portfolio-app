import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

/**
 * Custom hook to handle OCR extraction from images
 * @param {Object} chosenData - The current data item
 * @param {Function} setChosenData - Function to update chosen data
 * @param {Object} user - The current user
 * @param {Object} ocrSettings - OCR configuration settings
 * @param {Function} setOcrLoading - Function to update OCR loading state
 * @returns {Object} OCR handlers
 */
export const useOcrExtraction = (chosenData, setChosenData, user, ocrSettings, setOcrLoading) => {
  const navigate = useNavigate();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

  const { ocrMethod, ocrModel, llmProvider, llmModel } = ocrSettings;

  // Handle OCR extraction with S3 URLs
  const handleOcrExtraction = async () => {
    if (!chosenData?._id || !chosenData?.files || chosenData.files.length === 0) {
      toast.error('No images found to process');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    setOcrLoading(true);
    
    try {
      // Find the first image file
      const imageFile = chosenData.files.find(file => 
        file.fileType?.startsWith('image/') || file.contentType?.startsWith('image/')
      );
      
      if (!imageFile) {
        toast.error('No image files found to process');
        return;
      }

      // Create the OCR request payload using S3 URL
      const ocrRequestData = {
        imageUrl: imageFile.publicUrl || imageFile.s3Url,  // Use S3 URL instead of base64
        s3Key: imageFile.s3Key,
        fileName: imageFile.fileName || imageFile.filename,
        fileType: imageFile.fileType || imageFile.contentType,
        method: ocrMethod,
        model: ocrModel,
        llmProvider: llmProvider,
        llmModel: llmModel,
        dataId: chosenData._id
      };

      console.log('OCR Request:', { 
        ...ocrRequestData, 
        imageUrl: ocrRequestData.imageUrl ? 'URL provided' : 'No URL' 
      });

      // Call the backend OCR endpoint
      const response = await fetch('/api/data/ocr-extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify(ocrRequestData)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OCR processing failed: ${response.status} - ${errorData}`);
      }

      const ocrResult = await response.json();
      
      // Update the database item with OCR results using separate endpoint
      const updateResponse = await fetch(`/api/data/ocr-update/${chosenData._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          ocrText: ocrResult.extractedText,
          originalText: chosenData.data
        })
      });

      if (!updateResponse.ok) {
        throw new Error(`Failed to update item with OCR results: ${updateResponse.status}`);
      }

      const updateResult = await updateResponse.json();
      
      // Update the chosenData to reflect the changes including timestamp
      const now = new Date().toISOString();
      setChosenData({
        ...chosenData,
        data: updateResult.updatedItem.text || updateResult.updatedItem.data || chosenData.data,
        updatedAt: now
      });

      toast.success('OCR extraction completed successfully!', { autoClose: toastDuration });
      
    } catch (error) {
      console.error('Error extracting OCR:', error);
      toast.error(`Failed to extract text: ${error.message}`);
    } finally {
      setOcrLoading(false);
    }
  };

  return {
    handleOcrExtraction,
  };
};
