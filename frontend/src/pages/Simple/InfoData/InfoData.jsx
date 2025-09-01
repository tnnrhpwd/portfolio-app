import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import { toast } from 'react-toastify'; // visible error notifications
import { deleteData, getData, getPublicData, resetDataSlice, createData } from '../../../features/data/dataSlice';
import DeleteView from '../../../components/Simple/DeleteView/DeleteView';
import DataResult from '../../../components/Simple/DataResult/DataResult';
import Spinner from '../../../components/Spinner/Spinner';
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
            result = await dispatch(getData({ data: { text: id } })).unwrap();
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
        
        // Since comments are public, always try to fetch them
        // Try private first (if logged in), then public as backup
        try {
          if (user) {
            await dispatch(getData({ data: { text: commentSearchQuery } })).unwrap();
          } else {
            await dispatch(getPublicData({ data: { text: commentSearchQuery } })).unwrap();
          }
        } catch (error) {
          // If private fetch fails, try public fetch as backup
          console.log('Trying public data as backup for comments');
          await dispatch(getPublicData({ data: { text: commentSearchQuery } })).unwrap();
        }
      } catch (error) {
        console.error('Error fetching comments:', error);
      } finally {
        setCommentsLoading(false);
      }
    };

    fetchComments();
  }, [chosenData?._id, dispatch, user]);

  // Process comments when data changes (separate from main data processing)
  useEffect(() => {
    if (data.data && chosenData?._id) {
      console.log('=== DEBUG: Processing comments data ===');
      const commentData = data.data.filter(item => {
        const itemData = typeof item.data === 'string' ? item.data : item.data?.text || '';
        return itemData.includes(`Comment:${chosenData._id}`);
      });
      
      console.log('Found comments:', commentData.length);
      setComments(commentData);
    }
  }, [data.data, chosenData?._id]);

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
      
      // Refresh comments - since comments are public, try both private and public data sources
      const commentSearchQuery = `Comment:${chosenData._id}`;
      try {
        if (user) {
          await dispatch(getData({ data: { text: commentSearchQuery } })).unwrap();
        } else {
          await dispatch(getPublicData({ data: { text: commentSearchQuery } })).unwrap();
        }
      } catch (error) {
        // If private fetch fails, try public fetch as backup
        console.log('Trying public data as backup for comments');
        await dispatch(getPublicData({ data: { text: commentSearchQuery } })).unwrap();
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

  return (
    <>
      <Header />
      <div className="infodata">
        <button className='infodata-back-button' onClick={() => navigate('/plans')}>Back to /plans</button>
        {user && chosenData && (
          <div className='infodata-delete'>
            {(user._id === chosenData.userID || user.id === chosenData.userID) && (
            <button className='infodata-delete-button' onClick={handleShowDeleteData}>
                Delete Data
            </button>
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
                    Data Content (Click to select all):
                  </label>
                  <textarea
                    id="dataTextArea"
                    className='infodata-data-textarea'
                    value={chosenData.data}
                    readOnly
                    onClick={(e) => e.target.select()}
                  />
                </div>
                {chosenData.files && chosenData.files.map((file, index) => (
                  <div key={chosenData._id + "attachments" + index} className='infodata-data-attachments'>
                    {file.contentType.startsWith('image/') && (
                        <img src={`data:${file.contentType};base64,${file.data}`} alt={file.filename} className='infodata-data-attachments-img'/>
                    )}
                    {file.contentType.startsWith('video/') && (
                        <video controls >
                        <source src={`data:${file.contentType};base64,${file.data}`} type={file.contentType} className='infodata-data-attachments-vid'/>
                        Your browser does not support the video tag.
                        </video>
                    )}
                    {!file.contentType.startsWith('image/') && !file.contentType.startsWith('video/') && (
                        <div className='infodata-data-attachments-other'>
                        <p>Attachment: {file.filename}</p>
                        <p>Type: {file.contentType}</p>
                        </div>
                    )}
                  </div>
                ))}
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