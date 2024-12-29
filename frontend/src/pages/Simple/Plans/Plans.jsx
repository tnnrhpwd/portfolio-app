import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import DataInput from '../../../components/Simple/DataInput/DataInput.jsx';
import DataResult from '../../../components/Simple/DataResult/DataResult.jsx';
import Header from '../../../components/Header/Header.jsx';
import Footer from "../../../components/Footer/Footer.jsx";
import { toast } from 'react-toastify'; // visible error notifications
import { logout, getData, getPublicData, resetDataSlice } from '../../../features/data/dataSlice.js';
import './Plans.css';

function Plans() {
  const [showNewData, setShowNewData] = useState(false);
  const [showMyPlans, setShowMyPlans] = useState(false);
  const [showPublicPlans, setShowPublicPlans] = useState(true);
  const [myPlans, setMyPlans] = useState([]);
  const [showSavedPlans, setShowSavedPlans] = useState(false);
  const [savedPlans, setSavedPlans] = useState([]);
  const [publicPlans, setPublicPlans] = useState([]);
  const [sortOrder, setSortOrder] = useState('createdate-desc');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const loadingStartTime = useRef(null);

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

  // called on state changes
  useEffect(() => {
    if (dataIsSuccess) {
      // toast.success('Successfully received plans.', { autoClose: toastDuration });
    }
    if (dataIsError) {
      if (dataMessage && (dataMessage.includes('TokenExpiredError') || dataMessage.includes('token') || dataMessage.includes('Not authorized'))) {
        // Handle token errors
      } else {
        toast.error(dataMessage, { autoClose: 8000 });
        console.error(dataMessage);
      }
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
    let stopLoading = false;

    async function getMyData() {
      try {
        const searchStrings = ['|Plan:', '|Goal:', '|Action:'];
        for (const searchString of searchStrings) {
          if (stopLoading) break;
          await dispatch(getData({ data: { text: searchString } })).unwrap();
        }
      } catch (error) {
        if(error.includes('TokenExpiredError') || error.includes('Not authorized') || error.includes('User not found')) {
          dispatch(logout());
          navigate('/login');
        }
        console.error(error);
        toast.error(error.message);
        stopLoading = true;
      }
    }

    async function getThePublicData() {
      try {
        const searchStrings = ['|Plan:', '|Goal:', '|Action:'];
        for (const searchString of searchStrings) {
          if (stopLoading) break;
          await dispatch(getPublicData({ data: { text: searchString } })).unwrap();
        }
      } catch (error) {
        console.error(error);
        toast.error(error.message);
        stopLoading = true;
      }
    }

    if (user) {
      getMyData();
    } else {
      getThePublicData();
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [dispatch, user]);

  useEffect(() => {
    function handleAllOutputData(PlanStringArray) {
      if (!PlanStringArray) {
        console.log('PlanStringArray is undefined');
        return;
      }

      var outputMyPlanArray = [];
      var outputSavedPlanArray = [];
      var outputPublicPlanArray = [];

      if (PlanStringArray.length === 0) {
        console.log('PlanStringArray is empty');
      } else {
        console.log(PlanStringArray);
      }

      const processPlanArray = (itemIDData, itemCreatedAtData, itemUpdatedAtData, itemString, files, index, array) => {
        const fileType = files[0] ? files[0].contentType : '';
        const fileName = files[0] ? files[0].filename : '';
        const fileData = files[0] ? files[0].data : '';

        array.push(
          <DataResult
            key={`${array === outputMyPlanArray ? 'MyDataResult' : 'SavedDataResult'}${"user.nickname"}${index}${1}`}
            importPlanString={itemString}
            fileName={fileName}
            fileType={fileType}
            fileData={fileData}
            updatedAtData={itemUpdatedAtData}
            createdAtData={itemCreatedAtData}
            itemID={itemIDData}
          />
        );
      };

      PlanStringArray.forEach((itemarino, index) => {
        let itemString = typeof itemarino.data === 'string' ? itemarino.data : itemarino.data.text;
        let itemCreatedAt = itemarino.createdAt;
        let itemUpdatedAt = itemarino.updatedAt;
        let itemID = itemarino._id;
        if (itemString.length > 500) {
          itemString = itemString.substring(0, 500) + '...';
        }

        const files = itemarino.data.files || [];

        if (typeof itemString === 'string') {
          if ((user) && itemString.includes(user._id)) processPlanArray(itemID, itemCreatedAt, itemUpdatedAt, itemString, files, index, outputMyPlanArray);
          if (itemString.includes('Like:')) processPlanArray(itemID, itemCreatedAt, itemUpdatedAt, itemString, files, index, outputSavedPlanArray);
          if (itemString.includes('|Public:true')) processPlanArray(itemID, itemCreatedAt, itemUpdatedAt, itemString, files, index, outputPublicPlanArray);
        }
      });

      // Sort the plans based on the selected sort order
      const sortPlans = (plans) => {
        switch (sortOrder) {
          case 'itemstring-asc':
            return plans.sort((a, b) => a.props.importPlanString.localeCompare(b.props.importPlanString));
          case 'itemstring-desc':
            return plans.sort((a, b) => b.props.importPlanString.localeCompare(a.props.importPlanString));
          case 'createdate-asc':
            return plans; // Default order from MongoDB
          case 'createdate-desc':
            return plans.reverse(); // Inverted order from MongoDB
          default:
            return plans;
        }
      };

      setMyPlans(sortPlans(outputMyPlanArray));
      setSavedPlans(sortPlans(outputSavedPlanArray));
      setPublicPlans(sortPlans(outputPublicPlanArray));
    }
    if (data.data) {
      handleAllOutputData(data.data);
    }
  }, [data, user, sortOrder]);

  function handleCreateDataToggle() {
    setShowNewData(!showNewData);
  }
  function handleMyPlansToggle() {
    setShowMyPlans(!showMyPlans);
  }
  function handlePublicPlansToggle() {
    setShowPublicPlans(!showPublicPlans);
  }
  function handleSavedPlansToggle() {
    setShowSavedPlans(!showSavedPlans);
  }
  function handleLogin() {
    dispatch(logout());
    navigate('/login');  
  }

  return (
    <>
      <Header />
      <div className='planit-plans'>
        Plans
        <div className='planit-plans-text'>Every journey begins with a step.</div>
        {user && 
          <div className='planit-plans-create'>
            <div onClick={handleCreateDataToggle} className='planit-plans-create-text'>
              {showNewData ? 'Cancel Plan' : 'Create Plan'}
            </div>
              <div className='planit-plans-in'>
                {showNewData && <DataInput />}
              </div>
          </div>
        }

        {!user && 
          <div className='planit-plans-create'>
            <div onClick={handleLogin} className='planit-plans-create-text'>
              Log in to create a post
            </div>
          </div>
        }

        {user && <div className='planit-plans-my'>
          <div onClick={handleMyPlansToggle} className='planit-plans-my-text'>
            My Plans
          </div>

          {showMyPlans && (
            <div className='planit-plans-my-out'>
                      
              <div className='planit-plans-my-out-sort'>
                <label htmlFor='sortOrder'>Sort by: </label>
                <select
                  id='sortOrder'
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value='itemstring-asc'>Item String Ascending</option>
                  <option value='itemstring-desc'>Item String Descending</option>
                  <option value='createdate-asc'>Create Date Ascending</option>
                  <option value='createdate-desc'>Create Date Descending</option>
                </select>
              </div>

              {myPlans.length > 0 ? (
                <div className='planit-plans-my-out-result'>{myPlans}</div>
              ) : (
                <h3>You have not set any plans</h3>
              )}
            </div>
          )}
        </div>}
        <div className='planit-plans-saved'>
          <div onClick={handlePublicPlansToggle} className='planit-plans-saved-text'>
            Public Plans
          </div>
          {showPublicPlans && (
            <div className='planit-plans-saved-out'>
              {publicPlans.length > 0 ? (
                <div className='planit-plans-saved-out-result'>{publicPlans}</div>
              ) : (
                <h3>Please wait about a minute for the backend to startup.</h3>
              )}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Plans;