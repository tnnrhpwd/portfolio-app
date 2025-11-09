import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { deleteData, updateData } from '../../../features/data/dataSlice';
import DeleteView from '../../../components/Simple/DeleteView/DeleteView';
import Spinner from '../../../components/Spinner/Spinner';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';

// Custom hooks
import { useInfoDataState } from '../../../hooks/useInfoDataState';
import { useInfoDataFetch } from '../../../hooks/useInfoDataFetch';
import { useCommentsManagement } from '../../../hooks/useCommentsManagement';
import { useFileOperations } from '../../../hooks/useFileOperations';
import { useOcrExtraction } from '../../../hooks/useOcrExtraction';

// UI Components
import DataContentEditor from '../../../components/InfoData/DataContentEditor';
import DateInformationSection from '../../../components/InfoData/DateInformationSection';
import FileUploadSection from '../../../components/InfoData/FileUploadSection';
import OcrExtractionSection from '../../../components/InfoData/OcrExtractionSection';
import AttachedFilesSection from '../../../components/InfoData/AttachedFilesSection';
import CommentsSection from '../../../components/InfoData/CommentsSection';

// Utilities
import { processDataArray } from '../../../utils/infoDataUtils';
import { validateUpdate } from '../../../utils/validationUtils';

import './InfoData.css';

function InfoData() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Get root style for toast duration
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

  // Get Redux state
  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

  // Initialize all state with custom hook
  const state = useInfoDataState();
  const {
    chosenData,
    setChosenData,
    showDeleteDataConfirmation,
    setShowDeleteDataConfirmation,
    commentText,
    setCommentText,
    comments,
    commentsLoading,
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
    editedDataText,
    setEditedDataText,
    showFileUpload,
    setShowFileUpload,
  } = state;

  // Use data fetching hook
  const dataState = { data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage };
  useInfoDataFetch(id, user, dataState, setChosenData);

  // Use comments management hook
  const { handleCommentSubmit } = useCommentsManagement(
    chosenData,
    user,
    {
      commentText,
      setCommentText,
      comments: state.comments,
      setComments: state.setComments,
      setCommentsLoading: state.setCommentsLoading,
    }
  );

  // Use file operations hook
  const { handleFileUploadComplete, handleFileDelete } = useFileOperations(
    chosenData,
    setChosenData,
    user
  );

  // Use OCR extraction hook
  const { handleOcrExtraction } = useOcrExtraction(
    chosenData,
    setChosenData,
    user,
    { ocrMethod, ocrModel, llmProvider, llmModel },
    setOcrLoading
  );

  // Process data when it arrives from Redux
  useEffect(() => {
    if (data.data) {
      console.log('=== DEBUG: data.data changed ===');
      console.log('data.data type:', typeof data.data);
      console.log('data.data is array:', Array.isArray(data.data));
      
      const processed = processDataArray(data.data, id, toastDuration);
      if (processed) {
        setChosenData(processed);
      }
    } else {
      console.log('=== DEBUG: No data.data found ===');
    }
  }, [data, id, toastDuration, setChosenData]);

  // Initialize editedDataText when chosenData loads
  useEffect(() => {
    if (chosenData && chosenData.data && !editedDataText) {
      setEditedDataText(chosenData.data);
      console.log('Initialized editedDataText with:', chosenData.data);
    }
  }, [chosenData, editedDataText, setEditedDataText]);

  // Handle delete data
  const handleDeleteData = () => {
    dispatch(deleteData(chosenData._id));
    navigate('/plans');
  };

  // Handle show delete confirmation
  const handleShowDeleteData = (e) => {
    e.preventDefault();
    setShowDeleteDataConfirmation(!showDeleteDataConfirmation);
  };

  // Handle data update
  const handleUpdateData = async () => {
    const currentText = editedDataText || chosenData.data || '';
    
    const validation = validateUpdate(currentText, chosenData.data);
    
    if (!validation.isValid) {
      if (validation.hasChanges === false) {
        toast.info(validation.error);
      } else {
        toast.error(validation.error);
      }
      return;
    }

    if (!validation.hasChanges) {
      toast.info('No changes detected');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    try {
      const updatePayload = {
        id: chosenData._id,
        data: { text: currentText }
      };

      await dispatch(updateData(updatePayload)).unwrap();
      
      // Update local chosenData state to reflect changes including timestamp
      const now = new Date().toISOString();
      setChosenData(prev => ({
        ...prev,
        data: currentText,
        updatedAt: now
      }));
      
      toast.success('Data updated successfully!', { autoClose: toastDuration });
    } catch (error) {
      console.error('Error updating data:', error);
      toast.error(`Failed to update data: ${error.message}`);
    }
  };

  // Handle OCR method change
  const handleOcrMethodChange = (method) => {
    setOcrMethod(method);
    // Auto-set appropriate model for each method
    if (method === 'openai-vision') {
      setOcrModel('gpt-4o');
    } else if (method === 'xai-vision') {
      setOcrModel('grok-4');
    } else {
      setOcrModel('default');
    }
  };

  // Handle LLM provider change
  const handleLlmProviderChange = (provider) => {
    setLlmProvider(provider);
    // Reset model to default when provider changes
    if (provider === 'openai') {
      setLlmModel('o1-mini');
    } else if (provider === 'xai') {
      setLlmModel('grok-4');
    } else if (provider === 'anthropic') {
      setLlmModel('claude-3-sonnet');
    } else if (provider === 'google') {
      setLlmModel('gemini-pro');
    }
  };

  // Check if current user is owner
  const isOwner = user && chosenData && (user._id === chosenData.userID || user.id === chosenData.userID);

  return (
    <>
      <Header />
      <div className="infodata">
        {user && chosenData && (
          <div className='infodata-actions'>
            {isOwner && (
              <>
                <button className='infodata-back-button' onClick={() => navigate('/plans')}> /plans</button>
                <button className='infodata-update-button' onClick={handleUpdateData}>Save</button>
                <button className='infodata-delete-button' onClick={handleShowDeleteData}>Delete</button>
              </>
            )}
          </div>
        )}
        
        {showDeleteDataConfirmation && (
          <DeleteView 
            view={true} 
            delFunction={handleDeleteData} 
            click={setShowDeleteDataConfirmation} 
            id={chosenData._id} 
          />
        )}
        
        <div className='infodata-data'>
          {dataIsLoading && (
            <div className='infodata-loading'>
              <Spinner />
              <p>Loading data...</p>
            </div>
          )}
          
          {!dataIsLoading && !chosenData && (
            <div className='infodata-no-data'>
              <p>No data found for ID: {id}</p>
              <p>Please check the URL or try a different ID.</p>
            </div>
          )}
          
          <div className='infodata-data-text'>
            {chosenData && (
              <div>
                <DataContentEditor
                  value={editedDataText || chosenData.data || ''}
                  onChange={setEditedDataText}
                  isOwner={isOwner}
                />

                <DateInformationSection
                  createdAt={chosenData.createdAt}
                  updatedAt={chosenData.updatedAt}
                />
                
                <FileUploadSection
                  showUpload={showFileUpload}
                  onToggle={() => setShowFileUpload(!showFileUpload)}
                  onUploadComplete={handleFileUploadComplete}
                  dataId={chosenData._id}
                  isOwner={isOwner}
                />

                <OcrExtractionSection
                  files={chosenData.files}
                  isOwner={isOwner}
                  ocrLoading={ocrLoading}
                  ocrMethod={ocrMethod}
                  ocrModel={ocrModel}
                  llmProvider={llmProvider}
                  llmModel={llmModel}
                  onMethodChange={handleOcrMethodChange}
                  onModelChange={setOcrModel}
                  onLlmProviderChange={handleLlmProviderChange}
                  onLlmModelChange={setLlmModel}
                  onExtract={handleOcrExtraction}
                />

                <AttachedFilesSection
                  files={chosenData.files}
                  onFileDelete={handleFileDelete}
                  isOwner={isOwner}
                  dataId={chosenData._id}
                />
              </div>
            )}
          </div>
        </div>

        <CommentsSection
          chosenData={chosenData}
          user={user}
          comments={comments}
          commentsLoading={commentsLoading}
          commentText={commentText}
          onCommentTextChange={setCommentText}
          onCommentSubmit={handleCommentSubmit}
        />
      </div>
      <Footer />
    </>
  );
}

export default InfoData;
