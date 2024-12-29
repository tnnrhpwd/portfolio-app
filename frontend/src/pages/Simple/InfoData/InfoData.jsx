import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import { toast } from 'react-toastify'; // visible error notifications
import { createData, deleteData, getData, getPublicData, resetDataSlice } from '../../../features/data/dataSlice';
import DeleteView from '../../../components/Simple/DeleteView/DeleteView';
import Spinner from '../../../components/Spinner/Spinner';
import DataResult from '../../../components/Simple/DataResult/DataResult';
import './InfoData.css';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';

function InfoData() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const [chosenData, setChosenData] = useState(null);
  const [importedDatas, setImportedDatas] = useState([]);
  const [newData, setNewData] = useState('');
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
      const fetchData = async () => {
        try {
          if (!user) {
            await dispatch(getPublicData({ data: { text: id } })).unwrap();
          } else {
            await dispatch(getData({ data: { text: id } })).unwrap();
          }
        } catch (error) {
          console.error(error);
          toast.error(error.message);
          navigate('/plans');
        }
      };
  
      fetchData();
  
      return () => {
        dispatch(resetDataSlice());
      };
    }, [dispatch, id, navigate, user]);

  useEffect(() => {
    function handleAllOutputData(PlanObject) {
      if (!PlanObject || PlanObject.length === 0) {
        console.log('PlanObject is undefined or empty.');
        toast.error(`This ID query ${id} is not in our records. Navigating to /plans.`, { autoClose: toastDuration });
        navigate('/plans');
        return;
      } else {
        console.log(PlanObject);
      }
      let itemString = typeof PlanObject[0].data === 'string' ? PlanObject[0].data : PlanObject[0].data.text;
      let itemUserID = itemString.match(/Creator:([a-f0-9]{24})\|/)[1] || '';
      let itemCreatedAt = PlanObject[0].createdAt;
      let itemUpdatedAt = PlanObject[0].updatedAt;
      console.log(PlanObject[0]);
      let itemID = PlanObject[0]._id;
      let itemFileContentType = PlanObject[0].data.files[0] ? PlanObject[0].data.files[0].contentType : '';
      let itemFileData = PlanObject[0].data.files[0] ? PlanObject[0].data.files[0].data : '';
      let itemFileName = PlanObject[0].data.files[0] ? PlanObject[0].data.files[0].filename : '';

      setChosenData({
        data: itemString,
        userID: itemUserID,
        createdAt: itemCreatedAt,
        updatedAt: itemUpdatedAt,
        _id: itemID,
        fileContentType: itemFileContentType,
        fileData: itemFileData,
        fileName: itemFileName,
      });
    }
    if (data.data) {
      handleAllOutputData(data.data);
    }
  }, [data]);

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
            {user._id === chosenData.userID && (
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
          <div className='infodata-data-text'>
            {chosenData && (<div>
                <div className='infodata-data-button-text'>
                    {chosenData.data}
                </div>
                {chosenData.fileName && <div key={chosenData._id + "attachments1"} className='infodata-data-attachments'>
                    {chosenData.fileContentType.startsWith('image/') && (
                        <img src={`data:${chosenData.fileContentType};base64,${chosenData.fileData}`} alt={chosenData.fileName} className='infodata-data-attachments-img'/>
                    )}
                    {chosenData.fileContentType.startsWith('video/') && (
                        <video controls >
                        <source src={`data:${chosenData.fileContentType};base64,${chosenData.fileData}`} type={chosenData.fileContentType} className='infodata-data-attachments-vid'/>
                        Your browser does not support the video tag.
                        </video>
                    )}
                    {!chosenData.fileContentType.startsWith('image/') && !chosenData.fileContentType.startsWith('video/') && (
                        <div className='infodata-data-attachments-other'>
                        <p>Attachment: {chosenData.fileName}</p>
                        <p>Type: {chosenData.fileContentType}</p>
                        </div>
                    )}
                </div>}
            </div>)}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default InfoData;