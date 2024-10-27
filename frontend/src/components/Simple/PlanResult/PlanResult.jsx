import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import ShareView from '../ShareView/ShareView.jsx'
import { toast } from 'react-toastify'                        // visible error notifications
import CreatedAt from './CreatedAt';
import { useNavigate } from 'react-router-dom';
import { updateData } from '../../../features/data/dataSlice.js'
// import { getGoals, resetGoalSlice, createGoal, updateGoal, deleteGoal } from '../../features/goals/goalSlice'
// import { getComments, resetCommentSlice, createComment, updateComment } from '../../features/comments/commentSlice'
// import { getMyData, resetAuthSlice } from '../../features/auth/authSlice'

import ThumbsUp from './../../../assets/thumbs-up.svg';
import ManageView from '../ManageView/ManageView';
import ThumbsDown from './../../../assets/thumbs-down.svg';
import './PlanResult.css';

function DataResult(props) {
    const planString = props.importPlanString;

    const dispatch = useDispatch()  // initialization
    const navigate = useNavigate();

    const { user } = useSelector((state) => state.data)      // select user values from user state
  
    const [ shareView, setShareView ] = useState(null);
    const [ manageView, setManageView ] = useState(null);

    function handleAgree(id){
        const type = ("agree");
        dispatch( updateData( {  id ,type } ) )
    }

    function handleDisagree(id){
        const type = ("disagree");
        dispatch( updateData( {  id ,type } ) )
    }

    function handleFavorite(id){
        const type = ("favorite");
        dispatch( updateData( {  id ,type } ) )
        toast.success("Data added to your favorites!", { autoClose: 1000 })

    }

    function handleUnfavorite(id){
        const type = ("unfavorite");
        dispatch( updateData( {  id ,type } ) )
        toast.success("Data removed from your favorites!", { autoClose: 1000 })
    }

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
            const manageViewComponent = <ManageView plan={planString} owner={planString} user={user} view={true} click={setManageView} type={type} />;
            setManageView(manageViewComponent);
        }else if( !( manageView === null ) ){
            setManageView(null);
        } 
    }

    if(planString){
        return (<>
            { shareView }
            { manageView }

            <div key={planString+"0"} className='planit-planresult'>
                <div key={planString+"0.1"} className='planit-planresult-1'>
                    <div key={planString+"0.11"} className='planit-planresult-date'>
                        <CreatedAt key={planString+"0.12"} createdAt={planString}/>
                    </div>
                    <div key={planString+"0.13"} className='planit-planresult-share'>
                        <button key={planString+"0.14"} className='planit-planresult-share-btn' onClick={() => handleShareView("plan",planString)}>Share</button>
                    </div>
                    <div className='planit-planresult-fav' key={planString+"0.15"}>
                        { (user) ? <>{
                            <>{ (planString.includes(user._id)) ?
                                <>
                                    <button className='planit-planresult-fav-btn' onClick={() => handleUnfavorite( planString )} key={planString+"5.1"}>❤</button>
                                </>
                                :<>
                                    <button className='planit-planresult-unfav-btn' onClick={() => handleFavorite( planString )} key={planString+"5.2"}>♡</button>
                                </>
                            }</>
                        }</>:null}
                    </div>
                    <div className='planit-planresult-manageplan' key={planString+"0.16"}>
                        { (user) ? <>{
                            <button key={planString+"0.17"} className='planit-planresult-manageplan-btn' onClick={() => handleManageView("plan",planString)} >☸</button>
                        }</>:null}
                    </div>
                </div>
                <div key={planString+"0.2"} className='planit-planresult-2'>
                    <div 
                        key={planString + "2"} 
                        className='planit-planresult-goal'
                        >
                        <a href={'plan/' + planString}>
                            <button 
                            key={planString + "2button"} 
                            className='planit-planresult-goalbutton'
                            >
                            {planString.replace(/Creator:.*?\|/, '')}
                            </button>
                        </a>
                    </div>
                    {/* <div key={planString+"4"} className='planit-planresult-plan'><a href={'plan/'+planString}><button key={planString+"4button"} className='planit-planresult-planbutton'>{planString.map(( planElement, planElementIndex ) => (<div key={planString+"element"+planElement}>{planElement}</div>))}</button></a></div> */}
                </div>
                <div key={planString+"0.3"} className='planit-planresult-3'>
                    <div key={planString+"1"} className="planit-planresult-disagree-div">
                        {(user) ?
                            <>{(planString.includes(user._id)) ?
                                <button key={planString+"1button"} className='planit-planresult-disagreeACT' onClick={() => handleDisagree( planString )}><img key={planString+"4.002"} className='planit-planresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                            :
                                <button key={planString+"1.5button"} className='planit-planresult-disagree' onClick={() => handleDisagree( planString )}><img key={planString+"4.001"} className='planit-planresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                        }</>:null}
                    </div>
                    <div key={planString+"3"} className="planit-planresult-agree-div">
                        {(user) ?
                        <>{(planString.includes(user._id)) ?
                            <button key={planString+"3button"} className='planit-planresult-agreeACT' onClick={() => handleAgree( planString )}><img key={planString+"4.003"} className='planit-planresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                        :
                            <button key={planString+"3button"} className='planit-planresult-agree' onClick={() => handleAgree( planString )}><img key={planString+"4.004"} className='planit-planresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                        }</>:null}
                    </div>
                    <div className='planit-planresult-votecomment-holder' key={planString+"4.005"} >
                        <a href={'plan/'+planString} className='planit-planresult-votecomment-link' key={planString+"4.006"}>
                            <div className='planit-planresult-votecomment' key={planString+"4.007"} >
                                {/* Needed to add this if statement to add "+" before positive */}
                                {(planString.length - planString.length > 0)
                                    ? "+"+(planString.length - planString.length)+" votes "
                                    : (planString.length - planString.length)+" votes "
                                }
                                |
                                {
                                    " " + ( planString.length ) + " comments"
                                }
                            </div>
                        </a>
                    </div>           
                </div>
            </div>
        </>)
    }
}

export default DataResult