import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import useFileUpload from './useFileUpload';

/**
 * Custom hook to manage file upload and deletion
 * @param {Object} chosenData - The current data item
 * @param {Function} setChosenData - Function to update chosen data
 * @param {Object} user - The current user
 * @returns {Object} File operation handlers
 */
export const useFileOperations = (chosenData, setChosenData, user) => {
  const navigate = useNavigate();
  const { deleteFile } = useFileUpload();

  // Handle file upload completion
  const handleFileUploadComplete = async (uploadResult) => {
    try {
      console.log('File upload completed:', uploadResult);
      
      if (uploadResult.success) {
        // Update the chosenData with new file information
        const newFile = {
          s3Key: uploadResult.s3Key,
          publicUrl: uploadResult.publicUrl,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
          fileType: uploadResult.fileType,
          uploadedAt: new Date().toISOString()
        };

        setChosenData(prev => ({
          ...prev,
          files: [...(prev.files || []), newFile]
        }));

        toast.success(`📁 File "${uploadResult.fileName}" uploaded and linked successfully!`);
      }
    } catch (error) {
      console.error('Error handling upload completion:', error);
      toast.error('Upload completed but failed to update display');
    }
  };

  // Handle file deletion
  const handleFileDelete = async (fileToDelete) => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      await deleteFile(fileToDelete.s3Key, chosenData._id);
      
      // Remove file from chosenData state
      setChosenData(prev => ({
        ...prev,
        files: prev.files.filter(file => file.s3Key !== fileToDelete.s3Key)
      }));
      
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  };

  return {
    handleFileUploadComplete,
    handleFileDelete,
  };
};
