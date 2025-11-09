import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import { toast } from 'react-toastify'; // visible error notifications
import { deleteData, getData, getPublicData, resetDataSlice, createData, updateData } from '../../../features/data/dataSlice';
import DeleteView from '../../../components/Simple/DeleteView/DeleteView';
import DataResult from '../../../components/Simple/DataResult/DataResult';
import CreatedAt from '../../../components/Simple/DataResult/CreatedAt';
import Spinner from '../../../components/Spinner/Spinner';
import FileUpload from '../../../components/FileUpload/FileUpload';
import useFileUpload from '../../../hooks/useFileUpload';
import './InfoData.css';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';

function InfoData() {
  const { id } = useParams();
  const dispatch = useDispatch();
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
  
  // File upload hook
  const { deleteFile } = useFileUpload();
  const navigate = useNavigate();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const loadingStartTime = useRef(null);

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

  // Debug logging on component mount and ID changes
  useEffect(() => {
    console.log('=== DEBUG: InfoData Component Mounted/Updated ===');
    console.log('ID from params:', id);
    console.log('ID type:', typeof id);
    console.log('ID length:', id ? id.length : 'N/A');
    console.log('User:', user ? 'logged in' : 'not logged in');
    console.log('Data state:', { data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage });
  }, [id, user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage]);

  // called on state changes
  useEffect(() => {
    if (dataIsSuccess) {
      // toast.success('Successfully received data.', { autoClose: toastDuration });
    }
    if (dataIsError) {
      toast.error(dataMessage, { autoClose: 8000 });
      console.error(dataMessage);
    }
  }, [dataIsError, dataIsSuccess, dataMessage, dispatch, navigate, toastDuration, user]);

  useEffect(() => {
    if (dataIsLoading) {
      loadingStartTime.current = Date.now();
    } else if (loadingStartTime.current && Date.now() - loadingStartTime.current > 5000) {
      toast.info('The server service takes about a minute to spin up. Please try again in a moment.', {
        autoClose: 3000,
      });
    }
  }, [dataIsLoading]);

  useEffect(() => {  
      let isCancelled = false;
      
      const fetchData = async () => {
        console.log('=== DEBUG: Starting data fetch ===');
        console.log(`Attempting to fetch data for ID: ${id.length > 50 ? id.substring(0, 50) + "..." : id}`);
        console.log(`User status: ${user ? 'logged in' : 'not logged in'}`);
        console.log('Full ID:', id);
        
        try {
          let result;
          if (!user) {
            console.log('Fetching public data...');
            result = await dispatch(getPublicData({ data: { text: id } })).unwrap();
          } else {
            console.log('Fetching private data...');
            try {
              // First try private data access
              result = await dispatch(getData({ data: { text: id } })).unwrap();
            } catch (privateError) {
              console.log('Private data access failed, trying public data as fallback...');
              // If private access fails, try public data as fallback
              try {
                result = await dispatch(getPublicData({ data: { text: id } })).unwrap();
                console.log('✅ Public fallback successful');
              } catch (publicError) {
                // Both failed, rethrow the original private error
                throw privateError;
              }
            }
          }
          console.log('✅ Fetch completed successfully');
          console.log('Result type:', typeof result);
          console.log('Result:', result);
        } catch (error) {
          if (!isCancelled) {
            const errorMsg = error.message || 'Unknown error';
            const truncatedError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + "..." : errorMsg;
            console.error('❌ Error fetching data:', truncatedError);
            console.error('Full error object:', error);
            toast.error(`Failed to fetch data: ${truncatedError}`);
          }
        }
      };
  
      if (id) {
        fetchData();
      }
  
      return () => {
        isCancelled = true;
        dispatch(resetDataSlice());
      };
    }, [dispatch, id, navigate, user]);

  useEffect(() => {
    function handleAllOutputData(PlanObject) {
      console.log('=== DEBUG: handleAllOutputData called ===');
      console.log('PlanObject type:', typeof PlanObject);
      console.log('PlanObject value:', PlanObject);
      console.log('PlanObject is array:', Array.isArray(PlanObject));
      console.log('PlanObject length:', PlanObject ? PlanObject.length : 'N/A');
      console.log('Current ID being searched:', id);
      console.log('dataIsLoading:', dataIsLoading);
      console.log('dataIsSuccess:', dataIsSuccess);
      
      // Only show error if we're not currently loading and we've tried to fetch
      if (!PlanObject || PlanObject.length === 0) {
        // Don't show error if we're still loading or haven't attempted to fetch yet
        if (!dataIsLoading && dataIsSuccess) {
          console.warn(`❌ No data found for ID: ${id} (after successful API call)`);
          console.log('This could mean:');
          console.log('1. The ID does not exist in the database');
          console.log('2. You do not have permission to access this data');
          console.log('3. The server returned empty results');
          toast.error(`No data found for ID: ${id.length > 20 ? id.substring(0, 20) + "..." : id}`, { autoClose: toastDuration });
        } else {
          console.log('⏳ Empty data detected but still loading or not yet attempted fetch');
        }
        return;
      } else {
        console.log('✅ Data found successfully');
        // Truncate console log to 100 characters
        const dataPreview = JSON.stringify(PlanObject).length > 100 
          ? JSON.stringify(PlanObject).substring(0, 100) + "..."
          : JSON.stringify(PlanObject);
        console.log('PlanObject preview:', dataPreview);
      }
      
      // Find the specific item that matches the URL ID parameter
      let targetItem = PlanObject.find(item => {
        const itemId = item._id || item.id;
        return itemId === id;
      });
      
      // If we didn't find an exact ID match, check if we got a comment about this ID
      if (!targetItem) {
        console.log('=== No exact ID match found, checking for comments about this ID ===');
        const commentAboutId = PlanObject.find(item => {
          const itemText = item.data?.text || item.text || '';
          // Check if this is a comment about our target ID
          return itemText.includes(`Comment:${id}|`);
        });
        
        if (commentAboutId) {
          console.log('Found comment about target ID, but target item not found');
          console.log('This suggests the original item may have been deleted or is not accessible');
          toast.error(`Original item ${id.substring(0, 10)}... not found. Only comments about it exist.`, { autoClose: toastDuration });
          
          // Display a message instead of crashing
          setChosenData({
            data: `Original item with ID ${id} not found. This item may have been deleted or you may not have permission to view it.`,
            userID: 'system',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _id: id,
            files: [],
          });
          return;
        }
      }
      
      if (!targetItem) {
        // console.error(`❌ No item found with ID: ${id}`);
        console.log('=== DEBUGGING: Available items analysis ===');
        console.log('Total items returned:', PlanObject.length);
        PlanObject.forEach((item, index) => {
          console.log(`Item ${index}:`);
          console.log('  - _id:', item._id);
          console.log('  - id:', item.id);
          console.log('  - text preview:', (item.text || item.data?.text || JSON.stringify(item.data) || 'No text found').substring(0, 100));
          console.log('  - full item keys:', Object.keys(item));
        });
        console.log('Search ID we are looking for:', id);
        console.log('=== END DEBUGGING ===');
        // toast.error(`Item with ID ${id.substring(0, 10)}... not found in results`, { autoClose: toastDuration });
        return;
      }
      
      console.log('✅ Found target item with matching ID');
      // Use targetItem instead of PlanObject[0]
      const selectedItem = targetItem;
      
      // Handle different data structures (direct text vs nested data object)
      let itemString;
      if (selectedItem.text) {
        // DynamoDB structure: direct text property
        itemString = selectedItem.text;
      } else if (selectedItem.data) {
        // MongoDB structure: data property (string or object)
        itemString = typeof selectedItem.data === 'string' ? selectedItem.data : selectedItem.data.text;
      } else {
        console.error('Unknown data structure:', selectedItem);
        return;
      }
      
      // Handle both MongoDB ObjectIds (24 chars) and DynamoDB IDs (32 chars)
      let itemUserID = '';
      const mongoIdMatch = itemString.match(/Creator:([a-f0-9]{24})\|/);
      const dynamoIdMatch = itemString.match(/Creator:([a-f0-9]{32})\|/);
      if (mongoIdMatch) {
        itemUserID = mongoIdMatch[1];
      } else if (dynamoIdMatch) {
        itemUserID = dynamoIdMatch[1];
      }
      
      let itemCreatedAt = selectedItem.createdAt;
      let itemUpdatedAt = selectedItem.updatedAt;
      // Truncate individual item console log
      const itemPreview = JSON.stringify(selectedItem).length > 100 
        ? JSON.stringify(selectedItem).substring(0, 100) + "..."
        : JSON.stringify(selectedItem);
      console.log('Item preview:', itemPreview);
      let itemID = selectedItem._id || selectedItem.id; // Handle both MongoDB _id and DynamoDB id
      
      // Handle different file structures
      let itemFiles = [];
      if (selectedItem.files) {
        // Direct files property
        itemFiles = selectedItem.files;
      } else if (selectedItem.data?.files) {
        // Nested in data object
        itemFiles = selectedItem.data.files;
      }

      setChosenData({
        data: itemString,
        userID: itemUserID,
        createdAt: itemCreatedAt,
        updatedAt: itemUpdatedAt,
        _id: itemID,
        files: itemFiles,
      });
    }
    if (data.data) {
      console.log('=== DEBUG: data.data changed ===');
      console.log('data.data type:', typeof data.data);
      console.log('data.data value:', data.data);
      console.log('data.data is array:', Array.isArray(data.data));
      console.log('Full data object:', data);
      handleAllOutputData(data.data);
    } else {
      console.log('=== DEBUG: No data.data found ===');
      console.log('data object:', data);
      console.log('data.data is:', data.data);
    }
  }, [data, id, toastDuration, dataIsLoading, dataIsSuccess]);

  // Fetch comments when chosenData is available
  useEffect(() => {
    const fetchComments = async () => {
      if (!chosenData?._id) return;
      
      setCommentsLoading(true);
      try {
        console.log('=== DEBUG: Fetching comments for ID:', chosenData._id);
        const commentSearchQuery = `Comment:${chosenData._id}`;
        
        // Fetch comments directly without using Redux to avoid state conflicts
        const queryData = JSON.stringify({ text: commentSearchQuery });
        const searchParams = new URLSearchParams({
          data: queryData
        });
        const response = await fetch(`/api/data/public?${searchParams}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('=== DEBUG: Comments fetch result:', result);
          
          // Process comments directly without affecting main data state
          if (result.data && Array.isArray(result.data)) {
            const commentData = result.data.filter(item => {
              const itemData = typeof item.data === 'string' ? item.data : item.data?.text || '';
              return itemData.includes(`Comment:${chosenData._id}`);
            });
            console.log('Found comments:', commentData.length);
            setComments(commentData);
          }
        }
      } catch (error) {
        console.error('Error fetching comments:', error);
      } finally {
        setCommentsLoading(false);
      }
    };

    fetchComments();
  }, [chosenData?._id]);

  // Comments are now fetched directly in the fetchComments useEffect above
  // This prevents conflicts with the main data.data state

  // Initialize editedDataText when chosenData loads
  useEffect(() => {
    if (chosenData && chosenData.data && !editedDataText) {
      setEditedDataText(chosenData.data);
      console.log('Initialized editedDataText with:', chosenData.data);
    }
  }, [chosenData, editedDataText]);

  // Handle comment submission
  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    
    if (!commentText.trim()) {
      toast.error('Please enter a comment');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    if (!chosenData?._id) {
      toast.error('Cannot add comment - missing data ID');
      return;
    }

    try {
      // Create comment with format: Comment:ParentID|CommentText|Public:true (comments are always public)
      const commentData = `Comment:${chosenData._id}|${commentText.trim()}|Public:true`;
      
      console.log('=== DEBUG: Creating comment ===');
      console.log('Comment data:', commentData);
      
      await dispatch(createData({ data: commentData })).unwrap();
      
      setCommentText('');
      toast.success('Comment added successfully!', { autoClose: toastDuration });
      
      // Refresh comments using direct fetch to avoid Redux state conflicts
      const commentSearchQuery = `Comment:${chosenData._id}`;
      try {
        const queryData = JSON.stringify({ text: commentSearchQuery });
        const searchParams = new URLSearchParams({ data: queryData });
        const response = await fetch(`/api/data/public?${searchParams}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.data && Array.isArray(result.data)) {
            const commentData = result.data.filter(item => {
              const itemData = typeof item.data === 'string' ? item.data : item.data?.text || '';
              return itemData.includes(`Comment:${chosenData._id}`);
            });
            setComments(commentData);
          }
        }
      } catch (error) {
        console.error('Error refreshing comments:', error);
      }
      
    } catch (error) {
      console.error('Error creating comment:', error);
      toast.error('Failed to add comment');
    }
  };

  const handleDeleteData = () => {
    dispatch(deleteData(chosenData._id));
    // toast.info('Your data has been deleted.', { autoClose: 2000 });
    navigate('/plans');
  };

  const handleShowDeleteData = (e) => {
    e.preventDefault();
    setShowDeleteDataConfirmation(!showDeleteDataConfirmation);
  };

  // Handle data update
  const handleUpdateData = async () => {
    const currentText = editedDataText || chosenData.data || '';
    
    if (!currentText.trim()) {
      toast.error('Please enter data to update');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    // Check if there are actually changes to save
    if (currentText === chosenData.data) {
      toast.info('No changes detected');
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

  return (
    <>
      <Header />
      <div className="infodata">
        {user && chosenData && (
          <div className='infodata-actions'>
            {(user._id === chosenData.userID || user.id === chosenData.userID) && (
              <>
                <button className='infodata-back-button' onClick={() => navigate('/plans')}> /plans</button>
                <button className='infodata-update-button' onClick={handleUpdateData}>Save</button>
                <button className='infodata-delete-button' onClick={handleShowDeleteData}>Delete</button>
              </>
            )}
          </div>
        )}
        {showDeleteDataConfirmation && (
          <DeleteView view={true} delFunction={handleDeleteData} click={setShowDeleteDataConfirmation} id={chosenData._id} />
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
            {chosenData && (<div>
                <div className='infodata-data-content'>
                  <label htmlFor="dataTextArea" className='infodata-data-label'>
                    Data Content (Always Editable):
                  </label>
                  <textarea
                    id="dataTextArea"
                    className="infodata-data-textarea infodata-data-textarea-editing"
                    value={editedDataText || chosenData.data || ''}
                    onChange={(e) => {
                      // console.log('Textarea onChange triggered, new value:', e.target.value);
                      setEditedDataText(e.target.value);
                      // console.log('Updated editedDataText to:', e.target.value);
                    }}
                    placeholder="Enter your data content here..."
                    rows={8}
                  />
                </div>

                {/* Date Information Section */}
                <div className='infodata-date-section'>
                  <h3 className='infodata-date-title'>
                    <span className='infodata-date-icon'>📅</span>
                    Date Information
                  </h3>
                  <div className='infodata-date-grid'>
                    <div className='infodata-date-item'>
                      <div className='infodata-date-label'>Created:</div>
                      <div className='infodata-date-value'>
                        {chosenData.createdAt ? (
                          <>
                            <CreatedAt createdAt={chosenData.createdAt} />
                            <span className='infodata-date-full'> ({new Date(chosenData.createdAt).toLocaleString()})</span>
                          </>
                        ) : (
                          <span className='infodata-date-unavailable'>Date unavailable</span>
                        )}
                      </div>
                    </div>
                    <div className='infodata-date-item'>
                      <div className='infodata-date-label'>Last Updated:</div>
                      <div className='infodata-date-value'>
                        {chosenData.updatedAt ? (
                          <>
                            <CreatedAt createdAt={chosenData.updatedAt} />
                            <span className='infodata-date-full'> ({new Date(chosenData.updatedAt).toLocaleString()})</span>
                          </>
                        ) : (
                          <span className='infodata-date-unavailable'>Date unavailable</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* File Upload Section */}
                {user && (user._id === chosenData.userID || user.id === chosenData.userID) && (
                  <div className='infodata-file-section'>
                    <div className='infodata-file-header'>
                      <h3>
                        <span>📁</span>
                        Upload Files
                      </h3>
                      <p>Add images, documents, or other files to this item</p>
                      <button
                        className='infodata-toggle-upload-btn'
                        onClick={() => setShowFileUpload(!showFileUpload)}
                        type="button"
                      >
                        {showFileUpload ? '🔽 Hide Upload' : '📤 Show Upload'}
                      </button>
                    </div>
                    
                    {showFileUpload && (
                      <div className='infodata-file-upload-container'>
                        <FileUpload
                          onUploadComplete={handleFileUploadComplete}
                          fileType="image"
                          dataId={chosenData._id}
                          multiple={true}
                          className="infodata-file-upload"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* OCR Extraction Section */}
                {user && chosenData.files && chosenData.files.some(file => 
                  file.contentType?.startsWith('image/') || file.fileType?.startsWith('image/')
                ) && (
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
                            onChange={(e) => {
                              setOcrMethod(e.target.value);
                              // Auto-set appropriate model for each method
                              if (e.target.value === 'openai-vision') {
                                setOcrModel('gpt-4o');
                              } else if (e.target.value === 'xai-vision') {
                                setOcrModel('grok-4');
                              } else {
                                setOcrModel('default');
                              }
                            }}
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
                            onChange={(e) => setOcrModel(e.target.value)}
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
                            onChange={(e) => {
                              setLlmProvider(e.target.value);
                              // Reset model to default when provider changes
                              if (e.target.value === 'openai') {
                                setLlmModel('o1-mini');
                              } else if (e.target.value === 'xai') {
                                setLlmModel('grok-4');
                              } else if (e.target.value === 'anthropic') {
                                setLlmModel('claude-3-sonnet');
                              } else if (e.target.value === 'google') {
                                setLlmModel('gemini-pro');
                              }
                            }}
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
                            onChange={(e) => setLlmModel(e.target.value)}
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
                          onClick={handleOcrExtraction}
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
                )}

                {/* Files Section */}
                {chosenData.files && chosenData.files.length > 0 && (
                  <div className='infodata-files-section'>
                    <h3>
                      <span>📎</span>
                      Attached Files ({chosenData.files.length})
                    </h3>
                    <div className='infodata-files-grid'>
                      {chosenData.files.map((file, index) => {
                        // Handle both old base64 files and new S3 files
                        const isS3File = file.s3Key && file.publicUrl;
                        const fileType = file.fileType || file.contentType;
                        const fileName = file.fileName || file.filename;
                        const fileUrl = isS3File 
                          ? file.publicUrl 
                          : `data:${file.contentType};base64,${file.data}`;

                        return (
                          <div key={chosenData._id + "attachments" + index} className='infodata-file-item'>
                            <div className='infodata-file-preview'>
                              {fileType?.startsWith('image/') && (
                                <img 
                                  src={fileUrl} 
                                  alt={fileName} 
                                  className='infodata-file-img'
                                  onError={(e) => {
                                    console.error('Image failed to load:', fileUrl);
                                    e.target.style.display = 'none';
                                  }}
                                />
                              )}
                              {fileType?.startsWith('video/') && (
                                <video controls className='infodata-file-video'>
                                  <source src={fileUrl} type={fileType} />
                                  Your browser does not support the video tag.
                                </video>
                              )}
                              {!fileType?.startsWith('image/') && !fileType?.startsWith('video/') && (
                                <div className='infodata-file-icon'>
                                  {fileType?.includes('pdf') ? '📄' : 
                                   fileType?.includes('text') ? '📝' : 
                                   fileType?.includes('json') ? '🗂️' : 
                                   fileType?.includes('document') ? '📋' : 
                                   fileType?.includes('spreadsheet') ? '📊' : '📁'}
                                </div>
                              )}
                            </div>
                            
                            <div className='infodata-file-info'>
                              <div className='infodata-file-name'>{fileName}</div>
                              <div className='infodata-file-type'>{fileType}</div>
                              {file.fileSize && (
                                <div className='infodata-file-size'>
                                  {(file.fileSize / 1024 / 1024).toFixed(2)} MB
                                </div>
                              )}
                              {isS3File && (
                                <div className='infodata-file-storage'>☁️ Cloud Storage</div>
                              )}
                            </div>
                            
                            <div className='infodata-file-actions'>
                              {isS3File && (
                                <a 
                                  href={file.publicUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className='infodata-file-action-btn infodata-file-view-btn'
                                  title="View file"
                                >
                                  👁️
                                </a>
                              )}
                              {user && (user._id === chosenData.userID || user.id === chosenData.userID) && isS3File && (
                                <button 
                                  onClick={() => handleFileDelete(file)}
                                  className='infodata-file-action-btn infodata-file-delete-btn'
                                  title="Delete file"
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>)}
          </div>
        </div>

        {/* Comments Section */}
        {chosenData && (
          <div className='infodata-comments-section'>
            <div className='infodata-comments-header'>
              <h3 className='infodata-comments-title'>
                <span className='infodata-comments-icon'>💬</span>
                Comments ({comments.length})
              </h3>
            </div>

            {/* Comment Input */}
            {user && (
              <div className='infodata-comment-input-section'>
                <form onSubmit={handleCommentSubmit} className='infodata-comment-form'>
                  <div className='infodata-comment-input-group'>
                    <label htmlFor="commentTextArea" className='infodata-comment-label'>
                      Add a comment:
                    </label>
                    <textarea
                      id="commentTextArea"
                      className='infodata-comment-textarea'
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Share your thoughts, ask questions, or provide additional context..."
                      rows={3}
                    />
                  </div>
                  <div className='infodata-comment-actions'>
                    <button 
                      type="submit" 
                      className='infodata-comment-submit'
                      disabled={!commentText.trim()}
                    >
                      <span className="btn-icon">💬</span>
                      <span className="btn-text">Post Comment</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Comments List */}
            <div className='infodata-comments-list'>
              {commentsLoading && (
                <div className='infodata-comments-loading'>
                  <Spinner />
                  <p>Loading comments...</p>
                </div>
              )}

              {!commentsLoading && comments.length === 0 && (
                <div className='infodata-comments-empty'>
                  <div className='infodata-comments-empty-icon'>💭</div>
                  <p className='infodata-comments-empty-text'>No comments yet</p>
                  <p className='infodata-comments-empty-subtext'>
                    {user ? 'Be the first to share your thoughts!' : 'Log in to join the conversation'}
                  </p>
                </div>
              )}

              {!commentsLoading && comments.length > 0 && (
                <>
                  {comments.map((comment, index) => {
                    // Extract comment data and metadata
                    const commentData = typeof comment.data === 'string' ? comment.data : comment.data?.text || '';
                    
                    // Extract user ID from comment data
                    let commentUserID = '';
                    const mongoIdMatch = commentData.match(/Creator:([a-f0-9]{24})\|/);
                    const dynamoIdMatch = commentData.match(/Creator:([a-f0-9]{32})\|/);
                    if (mongoIdMatch) {
                      commentUserID = mongoIdMatch[1];
                    } else if (dynamoIdMatch) {
                      commentUserID = dynamoIdMatch[1];
                    }

                    // Extract comment text (everything after Comment:ParentID|)
                    const commentTextMatch = commentData.match(/Comment:[a-f0-9]+\|(.+)$/);
                    const displayCommentText = commentTextMatch ? commentTextMatch[1] : commentData;

                    // Clean comment text for DataResult display
                    const cleanCommentText = displayCommentText.replace(/Creator:.*?\|/, '').trim();

                    return (
                      <div key={`comment-${comment._id || comment.id}-${index}`} className='infodata-comment-item'>
                        <DataResult
                          importPlanString={cleanCommentText}
                          updatedAtData={comment.updatedAt || comment.createdAt}
                          itemID={chosenData._id}
                          files={comment.files || []}
                          userName={`User ${commentUserID.substring(0, 8)}`}
                          userBadge="Silver" // Comments get silver badge
                        />
                        <div className='infodata-comment-meta'>
                          <span className='infodata-comment-type'>💬 Comment</span>
                          <span className='infodata-comment-reply'>
                            Click above to reply or view nested comments
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Login prompt for non-users */}
            {!user && (
              <div className='infodata-comment-login-prompt'>
                <div className='infodata-comment-login-content'>
                  <span className='infodata-comment-login-icon'>🔐</span>
                  <p>Want to join the conversation?</p>
                  <button 
                    className='infodata-comment-login-btn'
                    onClick={() => navigate('/login')}
                  >
                    Log in to comment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

export default InfoData;