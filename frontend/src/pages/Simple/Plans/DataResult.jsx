import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ShareView from '../ShareView/ShareView.jsx';
import { toast } from 'react-toastify';
import CreatedAt from './CreatedAt';
import { useNavigate } from 'react-router-dom';
import { updateData } from '../../../features/data/dataSlice.js';
import ThumbsUp from './../../../assets/thumbs-up.svg';
import ManageView from '../ManageView/ManageView';
import ThumbsDown from './../../../assets/thumbs-down.svg';
import './dataresult.css';

function DataResult(props) {
    const { importPlanString, fileName, fileType, fileData } = props;

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { user } = useSelector((state) => state.data);
  
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
        if(!user){ navigate('/login') }
        if( ( manageView === null ) ){
            const manageViewComponent = <ManageView plan={importPlanString} owner={importPlanString} user={user} view={true} click={setManageView} type={type} />;
            setManageView(manageViewComponent);
        }else if( !( manageView === null ) ){
            setManageView(null);
        } 
    }

    if(importPlanString){
        return (<>
            { shareView }
            { manageView }

            <div key={importPlanString+"0"} className='planit-dataresult'>
                <div key={importPlanString+"0.1"} className='planit-dataresult-1'>
                    <div key={importPlanString+"0.11"} className='planit-dataresult-date'>
                        <CreatedAt key={importPlanString+"0.12"} createdAt={importPlanString}/>
                    </div>
                    <div key={importPlanString+"0.13"} className='planit-dataresult-share'>
                        <button key={importPlanString+"0.14"} className='planit-dataresult-share-btn' onClick={() => handleShareView("plan",importPlanString)}>Share</button>
                    </div>
                    <div className='planit-dataresult-fav' key={importPlanString+"0.15"}>
                        { (user) ? <>{
                            <>{ (importPlanString.includes(user._id)) ?
                                <>
                                    <button className='planit-dataresult-fav-btn' onClick={() => handleUnfavorite( importPlanString )} key={importPlanString+"5.1"}>❤</button>
                                </>
                                :<>
                                    <button className='planit-dataresult-unfav-btn' onClick={() => handleFavorite( importPlanString )} key={importPlanString+"5.2"}>♡</button>
                                </>
                            }</>
                        }</>:null}
                    </div>
                    <div className='planit-dataresult-manageplan' key={importPlanString+"0.16"}>
                        { (user) ? <>{
                            <button key={importPlanString+"0.17"} className='planit-dataresult-manageplan-btn' onClick={() => handleManageView("plan",importPlanString)} >☸</button>
                        }</>:null}
                    </div>
                </div>
                <div key={importPlanString+"0.2"} className='planit-dataresult-2'>
                    <div 
                        key={importPlanString + "2"} 
                        className='planit-dataresult-goal'
                        >
                        <a href={'plan/' + importPlanString}>
                            <button 
                            key={importPlanString + "2button"} 
                            className='planit-dataresult-goalbutton'
                            >
                            {importPlanString.replace(/Creator:.*?\|/, '')}
                            </button>
                        </a>
                    </div>
                    {fileData && (
                        <div key={importPlanString+"attachments"} className='planit-dataresult-attachments'>
                            {fileType.startsWith('image/') && (
                                <img src={`data:${fileType};base64,${fileData}`} alt={fileName} className='planit-dataresult-image' />
                            )}
                            {fileType.startsWith('video/') && (
                                <video controls className='planit-dataresult-video'>
                                    <source src={`data:${fileType};base64,${fileData}`} type={fileType} />
                                    Your browser does not support the video tag.
                                </video>
                            )}
                            {!fileType.startsWith('image/') && !fileType.startsWith('video/') && (
                                <div className='planit-dataresult-file'>
                                    <p>Attachment: {fileName}</p>
                                    <p>Type: {fileType}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div key={importPlanString+"0.3"} className='planit-dataresult-3'>
                    <div key={importPlanString+"1"} className="planit-dataresult-disagree-div">
                        {(user) ?
                            <>{(importPlanString.includes(user._id)) ?
                                <button key={importPlanString+"1button"} className='planit-dataresult-disagreeACT' onClick={() => handleDisagree( importPlanString )}><img key={importPlanString+"4.002"} className='planit-dataresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                            :
                                <button key={importPlanString+"1.5button"} className='planit-dataresult-disagree' onClick={() => handleDisagree( importPlanString )}><img key={importPlanString+"4.001"} className='planit-dataresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                        }</>:null}
                    </div>
                    <div key={importPlanString+"3"} className="planit-dataresult-agree-div">
                        {(user) ?
                        <>{(importPlanString.includes(user._id)) ?
                            <button key={importPlanString+"3button"} className='planit-dataresult-agreeACT' onClick={() => handleAgree( importPlanString )}><img key={importPlanString+"4.003"} className='planit-dataresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                        :
                            <button key={importPlanString+"3button"} className='planit-dataresult-agree' onClick={() => handleAgree( importPlanString )}><img key={importPlanString+"4.004"} className='planit-dataresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                        }</>:null}
                    </div>
                    <div className='planit-dataresult-votecomment-holder' key={importPlanString+"4.005"} >
                        <a href={'plan/'+importPlanString} className='planit-dataresult-votecomment-link' key={importPlanString+"4.006"}>
                            <div className='planit-dataresult-votecomment' key={importPlanString+"4.007"} >
                                {(importPlanString.length - importPlanString.length > 0)
                                    ? "+"+(importPlanString.length - importPlanString.length)+" votes "
                                    : (importPlanString.length - importPlanString.length)+" votes "
                                }
                                |
                                {
                                    " " + ( importPlanString.length ) + " comments"
                                }
                            </div>
                        </a>
                    </div>           
                </div>
            </div>
        </>)
    }
}

export default DataResult;