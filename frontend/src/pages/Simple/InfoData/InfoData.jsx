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
      toast.success('Successfully received data.', { autoClose: toastDuration });
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
            }else{  
                await dispatch(getData({ data: { text: id } })).unwrap();
            }
        } catch (error) {
            console.error(error);
            toast.error(error.message);
        }
    };

    fetchData();

    return () => {
        dispatch(resetDataSlice());
    };
}, [dispatch, id]);

useEffect(() => {
    function handleAllOutputData(PlanObject) {
        if (!PlanObject) {
            console.log('PlanObject is undefined');
            return;
        }
        if (PlanObject.length === 0) {
            console.log('PlanObject is empty');
          } else {
            console.log(PlanObject);
          }
        let itemString = typeof PlanObject[0].data === 'string' ? PlanObject[0].data : PlanObject[0].data.text;
        let itemCreatedAt = PlanObject[0].createdAt;
        let itemUpdatedAt = PlanObject[0].updatedAt;
        console.log(PlanObject[0]);
        let itemID = PlanObject[0]._id;
        if (itemString.length > 500) {
          itemString = itemString.substring(0, 500) + '...';
        }
        const files = PlanObject[0].data.files || [];

        setChosenData({
            data: itemString,
            createdAt: itemCreatedAt,
            updatedAt: itemUpdatedAt,
            _id: itemID,
        });

    }
    if (data.data) {
      handleAllOutputData(data.data);
    }
  }, [data]);

//   useEffect(() => {
//     if (chosenData) {
//       const outputDataComponentArray = chosenData.data.map((selData, selDataIndex) => (
//         <DataResult key={"DataResult" + id + " " + selDataIndex} data={selData} />
//       ));
//       setImportedDatas(outputDataComponentArray);
//     }
//   }, [chosenData, id]);

  const handleSubmitNewData = (e) => {
    e.preventDefault();

    if (newData === '') {
      toast.error('Please enter your data first.', { autoClose: 1000 });
      return;
    }
    if (newData.length > 280) {
      toast.error('Please shorten your data to 280 characters.', { autoClose: 1000 });
      return;
    }

    const topic = chosenData._id;
    const data = newData;

    dispatch(createData({ topic, data }));

    setNewData('');

    toast.success('Data Submitted!', { autoClose: 1000 });
  };

  const handleDeleteData = () => {
    dispatch(deleteData(chosenData._id));
    toast.info('Your data has been deleted.', { autoClose: 2000 });
    navigate('/datas');
  };

  const handleShowDeleteData = (e) => {
    e.preventDefault();
    setShowDeleteDataConfirmation(!showDeleteDataConfirmation);
  };

    return (
        <>
            <Header />
            <div className="infodata">
                {user && (
                <div className='infodata-delete'>
                    {/* {user._id === chosenData.user && (
                    <button className='infodata-delete-button' onClick={handleShowDeleteData}>
                        Delete Data
                    </button>
                    )} */}
                </div>
                )}
                {showDeleteDataConfirmation && (
                <DeleteView view={true} delFunction={handleDeleteData} click={setShowDeleteDataConfirmation} type="data" id={chosenData._id} />
                )}
                <div className='infodata-data'>
                <div className='infodata-data-text'>
                    {chosenData &&
                        <div className='infodata-data-button-text'>{chosenData.data}</div>
                    }
                </div>
                </div>
            </div>      
            <Footer />
        </>
    );
}

export default InfoData;