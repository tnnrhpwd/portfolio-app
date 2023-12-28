import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'              // redirect the user
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import PlanInput from '../../../components/Simple/PlanInput/PlanInput.jsx';
import PlanResult from '../../../components/Simple/PlanResult/PlanResult.jsx';
import { toast } from 'react-toastify'                        // visible error notifications
import Spinner from '../../../components/Spinner/Spinner.jsx'
import { getData, resetDataSlice } from '../../../features/data/dataSlice.js'
import './Plans.css';
import Header from '../../../components/Header/Header.jsx';

function Plans() {
  const [ showNewData, setShowNewData] = useState(false);
  const [ showMyPlans, setShowMyPlans ] = useState(false);
  const [ myPlans, setMyPlans ] = useState([])
  const [ showSavedPlans, setShowSavedPlans ] = useState(false)
  const [ savedPlans, setSavedPlans ] = useState([])
  // const [ dataObjectArray, setDataObjectArray ] = useState([]);

  const navigate = useNavigate() // initialization
  const dispatch = useDispatch() // initialization

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(     // select values from state
  (state) => state.data
  )

  // called on state changes
  useEffect(() => {
    if (!user) {            // if no user, redirect to login
      navigate('/login') 
    }
    if (dataIsError) {
      toast.error(dataMessage) // print error to toast errors

    }

    async function getMyData(){
      try {
        dispatch(getData({ 
          data: "Plan:", 
        })); // dispatch connects to the store, then retrieves the datas.
      } catch (error) {
        console.error(error);
        toast.error(error);
      }
    }

    getMyData()
    return () => {    // reset the data when state changes
      dispatch(resetDataSlice()) // dispatch connects to the store, then reset state values( dataMessage, isloading, iserror, and issuccess )
    }
  }, [dataIsError, dataMessage, dispatch, navigate, user])

  useEffect(() => {
    function handleAllOutputData(PlanStringArray){ 
      var outputMyPlanArray = []; var outputSavedPlanArray = [];

      PlanStringArray.forEach((itemarino) => {
        if (itemarino.includes(user._id) && !itemarino.includes('Like:')) {
          outputMyPlanArray.push(
            <PlanResult
              key={"MyDataResult" + user.nickname}
              importPlanString={itemarino}
            />
          );
        }
      
        if (itemarino.includes(user._id) && itemarino.includes('Like:')) {
          outputSavedPlanArray.push(
            <PlanResult
              key={"SavedDataResult" + user.nickname}
              importPlanString={itemarino}
            />
          );
        }
      });

      setMyPlans(outputMyPlanArray); setSavedPlans(outputSavedPlanArray); 
    }

    if(data.data){handleAllOutputData(data.data);}
  }, [data, user])

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

  // if(dataObjectArray.length > 0){
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
  // }else{return <Spinner/>}
}

export default Plans