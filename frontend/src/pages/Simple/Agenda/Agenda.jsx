import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'              // redirect the user
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import ActionInput from '../../../components/Simple/ActionInput/ActionInput';
import ActionResult from '../../../components/Simple/ActionResult/ActionResult';
import { toast } from 'react-toastify'                        // visible error notifications
// import Spinner from './../../components/Spinner/Spinner.jsx'
import { getData, resetDataSlice } from '../../../features/data/dataSlice.js'
// import BuildPlanObjectArray from '../../components/BuildPlanitObjectArray.js';
import './Agenda.css';
import Header from '../../../components/Header/Header.jsx';

function Agenda() {
  const [ showCreateAction, setShowCreateAction ] = useState(false)
  const [ showMyActions, setShowMyActions ] = useState(false)
  const [ showCalendar, setShowCalendar ] = useState(false)
  // const [ planitObjectArray, setPlanitObjectArray ] = useState([]);
  const [ myActions, setMyActions ] = useState([])
  const navigate = useNavigate() // initialization
  const dispatch = useDispatch() // initialization
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  
  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(     // select values from state
  (state) => state.data
)

  // called on state changes
  useEffect(() => {
    if (!user || user === null) {            // if no user, redirect to login
      toast.error("Please log in in to save data.")
    }

    if (dataIsError) {
      if (dataMessage && !dataMessage.includes('token')) {
          toast.error(dataMessage, { autoClose: toastDuration });
        }
  }

    async function getMyData(){
      try {
        dispatch(getData({ 
          data: "Action:", 
        })); // dispatch connects to the store, then retrieves the datas.
      } catch (error) {
        console.error(error);
        toast.error(error);
      }
    }

    getMyData()
    return () => {    // reset the plans when state changes
      dispatch(resetDataSlice()) // dispatch connects to the store, then reset state values( dataMessage, isloading, iserror, and issuccess )
    }
  }, [])

  useEffect(() => {
    function handleAllOutputActions(){ 
      var outputMyActionsArray = [];

      data.data.forEach( (item) => {
        outputMyActionsArray.push(<ActionResult selAction={item}/>)
      });

      setMyActions(outputMyActionsArray)
    }
    if((myActions.length === 0) && (data.data)){
      handleAllOutputActions();
    }
  }, [data.data, myActions.length])

  const toggleShowCreateAction = () => {
    if(showCreateAction){setShowCreateAction(false)}
    else if(!showCreateAction){setShowCreateAction(true)}
  }
  const toggleShowMyActions = () => {
    if(showMyActions){setShowMyActions(false)}
    else if(!showMyActions){setShowMyActions(true)}
  }
  const toggleShowCalendar = () => {
    if(showCalendar){setShowCalendar(false)}
    else if(!showCalendar){setShowCalendar(true)}
  }

  return (<>
    <Header/>
    <div className='agenda'>
        <div className='agenda-title'>
          Agenda
        </div>
        <div className='agenda-descr'>
          Dream bigger.
        </div><br/>

        <div className='agenda-create'>
          <div className='agenda-selection' onClick={toggleShowCreateAction}> Record Action </div>
          { (showCreateAction) &&
            <div>
              <ActionInput/>
            </div>
          }
        </div><br/>

        <div className='agenda-my'>
          <div className='agenda-selection' onClick={toggleShowMyActions}> My Actions </div>
          { (showMyActions) &&
            <div>
              { myActions }
            </div>
          }
        </div><br/>

        <div className='agenda-calen'>
          <div className='agenda-selection' onClick={toggleShowCalendar}> My Calendar </div>
          { (showCalendar) &&
            <div>hi</div>
          }
        </div>
    </div>
  </>)
}

export default Agenda