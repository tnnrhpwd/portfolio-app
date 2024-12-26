import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import PlanInput from '../../../components/Simple/PlanInput/PlanInput.jsx';
import PlanResult from '../../../components/Simple/PlanResult/PlanResult.jsx';
import Header from '../../../components/Header/Header.jsx';
import Footer from "../../../components/Footer/Footer.jsx";
import { toast } from 'react-toastify'; // visible error notifications
import { logout, getData, resetDataSlice } from '../../../features/data/dataSlice.js';
import './Plans.css';


function Plans() {
  const [showNewData, setShowNewData] = useState(false);
  const [showMyPlans, setShowMyPlans] = useState(false);
  const [myPlans, setMyPlans] = useState([]);
  const [showSavedPlans, setShowSavedPlans] = useState(false);
  const [savedPlans, setSavedPlans] = useState([]);
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
    if (!user) {
      // if no user, redirect to login
      navigate('/login');
    }
    if (dataIsSuccess) {
      // if data is successfully loaded, print success message
      toast.success('Successfully received plans.', { autoClose: toastDuration });
    }
    if (dataIsError) {
      if (dataMessage && dataMessage.includes('TokenExpiredError')) {
        toast.error('Session expired. Please log in again.', { autoClose: toastDuration });
        dispatch(logout());
        navigate('/login');
      } else {
        toast.error(dataMessage, { autoClose: 1000 });
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
    async function getMyData() {
      try {
        const searchStrings = ['|Plan:', '|Goal:', '|Action:'];
        await Promise.all(
          searchStrings.map((searchString) => dispatch(getData({ data: { text: searchString } })))
        );
      } catch (error) {
        console.error(error);
        toast.error(error.message);
      }
    }

    getMyData();
    return () => {
      dispatch(resetDataSlice());
    };
  }, [dispatch]);

  useEffect(() => {
    function handleAllOutputData(PlanStringArray) {
      var outputMyPlanArray = [];
      var outputSavedPlanArray = [];
      if (PlanStringArray.length === 0) {
        console.log('PlanStringArray is empty');
      } else {
        console.log(PlanStringArray);
      }
      PlanStringArray.forEach((itemarino, index) => {
        let itemString = typeof itemarino === 'object' ? itemarino.text : itemarino;
        let displayString = typeof itemarino === 'object' ? itemarino.fileName : itemarino;
        if (itemString.length > 500) {
          itemString = itemString.substring(0, 500) + '...';
        }
        if (typeof itemString === 'string' && itemString.includes(user._id) && !itemString.includes('Like:')) {
          outputMyPlanArray.push(
            <PlanResult
              key={'MyDataResult' + user.nickname + index}
              importPlanString={itemString}
              displayString={displayString}
            />
          );
        }
        if (typeof itemString === 'string' && itemString.includes(user._id) && itemString.includes('Like:')) {
          outputSavedPlanArray.push(
            <PlanResult
              key={'SavedDataResult' + user.nickname + index}
              importPlanString={itemString}
              displayString={displayString}
            />
          );
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
  function handleSavedPlansToggle() {
    setShowSavedPlans(!showSavedPlans);
    console.log(showSavedPlans);
  }

  return (
    <>
      <Header />
      <div className='planit-plans'>
        Plans
        <div className='planit-plans-text'>Every journey begins with a step.</div>
        <div className='planit-plans-create'>
          <div onClick={handleCreateDataToggle} className='planit-plans-create-text'>
            {showNewData ? 'Cancel Plan' : 'Create Plan'}
          </div>
          {user && (
            <div className='planit-plans-in'>
              {showNewData && <PlanInput />}
            </div>
          )}
        </div>

        <div className='planit-plans-my'>
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
        </div>
        <div className='planit-plans-saved'>
          <div onClick={handleSavedPlansToggle} className='planit-plans-saved-text'>
            Saved Plans
          </div>
          {showSavedPlans && (
            <div className='planit-plans-saved-out'>
              {savedPlans.length > 0 ? (
                <div className='planit-plans-saved-out-result'>{savedPlans}</div>
              ) : (
                <h3>You have not set any plans</h3>
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