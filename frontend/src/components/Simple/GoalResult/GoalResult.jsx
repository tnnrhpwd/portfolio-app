import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux'      // access state variables
// import { updateData } from './../../features/goals/goalSlice'
import ShareView from '../ShareView/ShareView.jsx'
// import { toast } from 'react-toastify'                        // visible error notifications
import CreatedAt from '../PlanResult/CreatedAt';
import { useNavigate } from 'react-router-dom';
// import ThumbsUp from './../../assets/thumbs-up.svg';
// import ThumbsDown from './../../assets/thumbs-down.svg';
import ManageView from '../ManageView/ManageView';
import './GoalResult.css';

function GoalResult( props ) {
  const goalObjectArray = props.importGoalArray;

  const dispatch = useDispatch()  // initialization
  const navigate = useNavigate();

  const { user } = useSelector((state) => state.auth)      // select user values from user state

  const [ shareView, setShareView ] = useState(null);
  const [ manageView, setManageView ] = useState(null);

  function handleShareView(type, id){

    if( ( shareView === null ) ){
      const shareViewComponent = <ShareView view={true} click={setShareView} type={type} id={id}/>;
      setShareView(shareViewComponent);
    }else if( !( shareView === null ) ){
      setShareView(null);
    } 
  }

  function handleManageView(type, id){
    if(!user){ navigate('/login') } // GUARD CLAUSE -- Nonusers go to login.
    if( ( manageView === null ) ){
      const manageViewComponent = <ManageView topicID={goalObjectArray[0]} owner={goalObjectArray[2]} user={user} view={true} click={setManageView} type={type} id={id}/>;
      setManageView(manageViewComponent);
    }else if( !( manageView === null ) ){
      setManageView(null);
    } 
  }

  return (<>
    { shareView }
    { manageView }

    <div className='planit-goalresult'>
      <div key={goalObjectArray[0]+"0.1"} className='planit-planresult-1'>
        <div key={goalObjectArray[0]+"0.11"} className='planit-planresult-date'>
            <CreatedAt key={goalObjectArray[0]+"0.12"} createdAt={goalObjectArray[3]}/>
        </div>
        <div key={goalObjectArray[0]+"0.13"} className='planit-planresult-share'>
            <button key={goalObjectArray[0]+"0.14"} className='planit-planresult-share-btn' onClick={() => handleShareView("goal",goalObjectArray[0])}>Share</button>
        </div>
        <div className='planit-planresult-manageplan' key={goalObjectArray[0]+"0.16"}>
            { (user) ? <>{
              <button key={goalObjectArray[0]+"0.17"} className='planit-planresult-manageplan-btn' onClick={() => handleManageView("goal",goalObjectArray[0])} >☸</button>
            }</>:null}
        </div>
      </div>
      <div key={goalObjectArray[0]+"0.2"} className='planit-planresult-2'>
        <div key={goalObjectArray[0]+"2"} className='planit-planresult-goal'><a href={'goal/'+goalObjectArray[0]}><button key={goalObjectArray[0]+"2button"} className='planit-planresult-goalbutton'>{goalObjectArray[1]}</button></a></div>
      </div>
      <div key={goalObjectArray[0]+"0.3"} className='planit-planresult-3'>
        { ( props.freqNumGoalPlans ) } plans | 
        {" " + ( props.freqNumPlanGoals ) } actions
      </div>
    </div>
  </>)
}

export default GoalResult