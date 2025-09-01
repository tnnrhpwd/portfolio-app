import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import { toast } from 'react-toastify'; // visible error notifications
import { deleteData, getData, getPublicData, resetDataSlice } from '../../../features/data/dataSlice';
import DeleteView from '../../../components/Simple/DeleteView/DeleteView';
import Spinner from '../../../components/Spinner/Spinner';
import './InfoData.css';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';

function InfoData() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const [chosenData, setChosenData] = useState(null);
  const [showDeleteDataConfirmation, setShowDeleteDataConfirmation] = useState(false);
  const navigate = useNavigate();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const loadingStartTime = useRef(null);

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

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
        console.log(`Attempting to fetch data for ID: ${id.length > 50 ? id.substring(0, 50) + "..." : id}`);
        console.log(`User status: ${user ? 'logged in' : 'not logged in'}`);
        
        try {
          if (!user) {
            console.log('Fetching public data...');
            await dispatch(getPublicData({ data: { text: id } })).unwrap();
          } else {
            console.log('Fetching private data...');
            await dispatch(getData({ data: { text: id } })).unwrap();
          }
        } catch (error) {
          if (!isCancelled) {
            const errorMsg = error.message || 'Unknown error';
            const truncatedError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + "..." : errorMsg;
            console.error('Error fetching data:', truncatedError);
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
      if (!PlanObject || PlanObject.length === 0) {
        console.log(`This ID query ${id} is not in our records.`);
        toast.error(`This ID query ${id} is not in our records.`, { autoClose: toastDuration });
        // navigate('/plans');
        return;
      } else {
        // Truncate console log to 100 characters
        const dataPreview = JSON.stringify(PlanObject).length > 100 
          ? JSON.stringify(PlanObject).substring(0, 100) + "..."
          : JSON.stringify(PlanObject);
        console.log('PlanObject preview:', dataPreview);
      }
      let itemString = typeof PlanObject[0].data === 'string' ? PlanObject[0].data : PlanObject[0].data.text;
      // Handle both MongoDB ObjectIds (24 chars) and DynamoDB IDs (32 chars)
      let itemUserID = '';
      const mongoIdMatch = itemString.match(/Creator:([a-f0-9]{24})\|/);
      const dynamoIdMatch = itemString.match(/Creator:([a-f0-9]{32})\|/);
      if (mongoIdMatch) {
        itemUserID = mongoIdMatch[1];
      } else if (dynamoIdMatch) {
        itemUserID = dynamoIdMatch[1];
      }
      
      let itemCreatedAt = PlanObject[0].createdAt;
      let itemUpdatedAt = PlanObject[0].updatedAt;
      // Truncate individual item console log
      const itemPreview = JSON.stringify(PlanObject[0]).length > 100 
        ? JSON.stringify(PlanObject[0]).substring(0, 100) + "..."
        : JSON.stringify(PlanObject[0]);
      console.log('Item preview:', itemPreview);
      let itemID = PlanObject[0]._id || PlanObject[0].id; // Handle both MongoDB _id and DynamoDB id
      let itemFiles = PlanObject[0].data?.files || PlanObject[0].files || [];

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
      handleAllOutputData(data.data);
    }
  }, [data, id, toastDuration]);

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
                    style={{
                      width: '100%',
                      minHeight: '200px',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                      resize: 'vertical',
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word'
                    }}
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
      </div>
      <Footer />
    </>
  );
}

export default InfoData;