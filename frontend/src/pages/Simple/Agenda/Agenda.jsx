import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'              // redirect the user
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import ActionInput from '../../../components/SimpleAction/ActionInput/ActionInput';
import ActionResult from '../../../components/SimpleAction/ActionResult/ActionResult';
import { toast } from 'react-toastify'                        // visible error notifications
// import Spinner from './../../components/Spinner/Spinner.jsx'
import { getData, resetDataSlice } from '../../../features/data/dataSlice.js'
// import BuildPlanObjectArray from '../../components/BuildPlanitObjectArray.js';
import './Agenda.css';

function Agenda() {
  const [ showCreateAction, setShowCreateAction ] = useState(false)
  const [ showMyActions, setShowMyActions ] = useState(false)
  const [ showCalendar, setShowCalendar ] = useState(false)
  // const [ planitObjectArray, setPlanitObjectArray ] = useState([]);
  const [ myActions, setMyActions ] = useState([])
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
      console.error(dataMessage);
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
  }, [dataIsError, dataMessage, dispatch, navigate, user])

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