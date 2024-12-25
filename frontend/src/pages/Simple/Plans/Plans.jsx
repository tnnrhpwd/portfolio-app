import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'              // redirect the user
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import PlanInput from '../../../components/Simple/PlanInput/PlanInput.jsx';
import PlanResult from '../../../components/Simple/PlanResult/PlanResult.jsx';
import { toast } from 'react-toastify'                        // visible error notifications
import Spinner from '../../../components/Spinner/Spinner.jsx'
import { logout, getData, resetDataSlice } from '../../../features/data/dataSlice.js'
import './Plans.css';
import Header from '../../../components/Header/Header.jsx';

function Plans() {
  const [ showNewData, setShowNewData] = useState(false);
  const [ showMyPlans, setShowMyPlans ] = useState(false);
  const [ myPlans, setMyPlans ] = useState([])
  const [ showSavedPlans, setShowSavedPlans ] = useState(false)
  const [ savedPlans, setSavedPlans ] = useState([])
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  let loadingStartTime = null;

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(     // select values from state
  (state) => state.data
  )

  // called on state changes
  useEffect(() => {
    if (!user) {            // if no user, redirect to login
      navigate('/login') 
    }
    if (dataIsSuccess) {    // if data is successfully loaded, print success message
      toast.success(dataMessage, { autoClose: toastDuration });
    }
    if (dataIsError) {
      if (dataMessage && dataMessage.includes('TokenExpiredError')) {
        toast.error("Session expired. Please log in again.", { autoClose: 3000 });
        dispatch(logout());
        navigate('/login');
      } else {
        toast.error(dataMessage, { autoClose: 1000 });
        console.error(dataMessage);
      }
    }
  }, [dataIsError, dataMessage, dispatch, navigate, user])

      useEffect(() => {
          if (dataIsLoading) {
              loadingStartTime = Date.now();
          }
      }, [dataIsLoading]);
  
      useEffect(() => {
          if (dataIsLoading && loadingStartTime && Date.now() - loadingStartTime > 5000) {
              toast.info("The server service takes about a minute to spin up. Please try again in a moment.", { autoClose: 3000 });
          }
      },  [dataIsLoading, loadingStartTime]);
      

  useEffect(() => {
    async function getMyData() {
      try {
        const searchStrings = ["|Plan:", "|Goal:", "|Action:"];
        searchStrings.forEach(searchString => {
            dispatch(getData({ data: { text: searchString } })); // dispatch connects to the store, then retrieves the data.
        });
      } catch (error) {
        console.error(error);
        toast.error(error);
      }
    }

    getMyData()
    return () => {    // reset the data when state changes
      dispatch(resetDataSlice()) // dispatch connects to the store, then reset state values( dataMessage, isloading, iserror, and issuccess )
    }
  }, [dispatch])

  useEffect(() => {
    function handleAllOutputData(PlanStringArray) {
        var outputMyPlanArray = [];
        var outputSavedPlanArray = [];
        if (PlanStringArray.length === 0) {
            console.log("PlanStringArray is empty");
        } else {
            console.log(PlanStringArray);
        }
        PlanStringArray.forEach((itemarino) => {
            let itemString = typeof itemarino === 'object' ? itemarino.text : itemarino;
            let displayString = typeof itemarino === 'object' ? itemarino.fileName : itemarino;
            if (itemString.length > 500) {
                itemString = itemString.substring(0, 500) + '...';
            }
            if (typeof itemString === 'string' && itemString.includes(user._id) && !itemString.includes('Like:')) {
                outputMyPlanArray.push(
                    <PlanResult
                        key={"MyDataResult" + user.nickname}
                        importPlanString={itemString}
                        displayString={displayString}
                    />
                );
            }
            if (typeof itemString === 'string' && itemString.includes(user._id) && itemString.includes('Like:')) {
                outputSavedPlanArray.push(
                    <PlanResult
                        key={"SavedDataResult" + user.nickname}
                        importPlanString={itemString}
                        displayString={displayString}
                    />
                );
            }
        });
        setMyPlans(outputMyPlanArray); 
        setSavedPlans(outputSavedPlanArray); 
    }
    if(data.data){ handleAllOutputData(data.data); }
  }, [data, user]);

  function handleCreateDataToggle(){
    if(showNewData){setShowNewData(false)}
    else if(!showNewData){setShowNewData(true)}
  }
  function handleMyPlansToggle(){
    if(showMyPlans){setShowMyPlans(false)}
    else if(!showMyPlans){setShowMyPlans(true)}
  }
  function handleSavedPlansToggle(){
    if(showSavedPlans){setShowSavedPlans(false)}
    else if(!showSavedPlans){setShowSavedPlans(true)}
    console.log(showSavedPlans)
  }

  return (<>
    <Header/>
    <div className='planit-plans'>
      Plans
      <div className='planit-plans-text'>
        Every journey begins with a step.
      </div>
      <div  className='planit-plans-create' >
        
        <div onClick={handleCreateDataToggle} className='planit-plans-create-text'>
          {
            showNewData ? "Cancel Plan":"Create Plan"
          }
        
        </div>
        { ( user ) &&
          <div className='planit-plans-in'>
            {(showNewData) &&
              <PlanInput />
            }

          </div>
        }
      </div>

      <div className='planit-plans-my'>
        <div onClick={handleMyPlansToggle} className="planit-plans-my-text">
          My Plans
        </div>
      
        { showMyPlans &&
          <div className='planit-plans-my-out'>
            { ( myPlans.length > 0 ) ? (
              <div className='planit-plans-my-out-result'>
                { myPlans }
              </div>
             ) : ( 
              <h3>You have not set any plans</h3>
            )} 
          </div>
        }
      </div>
      <div className='planit-plans-saved'>
        <div onClick={handleSavedPlansToggle} className="planit-plans-saved-text">
          Saved Plans
        </div>
        { showSavedPlans &&
          <div className='planit-plans-saved-out'>
            { ( savedPlans.length > 0 ) ? (
              <div className='planit-plans-saved-out-result'>
                { savedPlans }
              </div>
            ) : (
              <h3>You have not set any plans</h3>
            )}
          </div>
        }
      </div>
    </div>
  </>
  )
}

export default Plans