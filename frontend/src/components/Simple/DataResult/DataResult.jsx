import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ShareView from '../ShareView/ShareView.jsx';
import { toast } from 'react-toastify';
import CreatedAt from './CreatedAt.js';
import { useNavigate } from 'react-router-dom';
import { updateData } from '../../../features/data/dataSlice.js';
import ThumbsUp from './../../../assets/thumbs-up.svg';
import ManageView from '../ManageView/ManageView.jsx';
import ThumbsDown from './../../../assets/thumbs-down.svg';
import './DataResult.css';

function DataResult(props) {
    const planString = props.importPlanString;
    const updatedAt = props.updatedAtData;
    const itemID = props.itemID;
    const files = props.files;

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { user } = useSelector((state) => state.data);
  
    const [shareView, setShareView] = useState(null);
    const [manageView, setManageView] = useState(null);
    const [currentFileIndex, setCurrentFileIndex] = useState(0);

    function handleAgree(id){
        if(!user){ navigate('/login') }
        const type = ("agree");
        dispatch(updateData({ id, type }));
    }

    function handleDisagree(id){
        if(!user){ navigate('/login') }
        const type = ("disagree");
        dispatch(updateData({ id, type }));
    }

    function handleFavorite(id){
        if(!user){ navigate('/login') }
        const type = ("favorite");
        dispatch(updateData({ id, type }));
        toast.success("Data added to your favorites!", { autoClose: 1000 });
    }

    function handleUnfavorite(id){
        if(!user){ navigate('/login') }
        const type = ("unfavorite");
        dispatch(updateData({ id, type }));
        toast.success("Data removed from your favorites!", { autoClose: 1000 });
    }

    function handleShareView(type, id){
        if (shareView === null) {
            const shareViewComponent = <ShareView view={true} click={setShareView} type={type} id={id} />;
            setShareView(shareViewComponent);
        } else {
            setShareView(null);
        }
    }

    function handleManageView(type, id){
        if(!user){ navigate('/login') }
        if (manageView === null) {
            const manageViewComponent = <ManageView plan={planString} owner={planString} user={user} view={true} click={setManageView} type={type} />;
            setManageView(manageViewComponent);
        } else {
            setManageView(null);
        }
    }

    function handleNextFile() {
        setCurrentFileIndex((prevIndex) => (prevIndex + 1) % files.length);
    }

    function handlePrevFile() {
        setCurrentFileIndex((prevIndex) => (prevIndex - 1 + files.length) % files.length);
    }

    if(planString){
        const currentFile = files[currentFileIndex];

        return (
            <>
                {shareView}
                {manageView}

                <div key={planString+"0"} className='planit-dataresult'>
                    <div key={planString+"0.1"} className='planit-dataresult-1'>
                        <div key={planString+"0.11"} className='planit-dataresult-date'>
                            <CreatedAt key={planString+"0.12"} createdAt={updatedAt}/>
                        </div>
                        <div key={planString+"0.13"} className='planit-dataresult-share'>
                            <button key={planString+"0.14"} className='planit-dataresult-share-btn' onClick={() => handleShareView("plan",itemID)}>Share</button>
                        </div>
                        <div className='planit-dataresult-fav' key={planString+"0.15"}>
                            {user && (
                                <>
                                    {planString.includes(user._id) ? (
                                        <button className='planit-dataresult-fav-btn' onClick={() => handleUnfavorite(itemID)} key={planString+"5.1"}>❤</button>
                                    ) : (
                                        <button className='planit-dataresult-unfav-btn' onClick={() => handleFavorite(itemID)} key={planString+"5.2"}>♡</button>
                                    )}
                                </>
                            )}
                        </div>
                        <div className='planit-dataresult-manageplan' key={planString+"0.16"}>
                            {user && (
                                <button key={planString+"0.17"} className='planit-dataresult-manageplan-btn' onClick={() => handleManageView("plan",itemID)}>☸</button>
                            )}
                        </div>
                    </div>
                        <div key={planString+"0.2"} className='planit-dataresult-2'>                    
                            <a href={'InfoData/' + itemID}>
                                <div key={planString + "2"} className='planit-dataresult-goal'>
                                    <button key={planString + "2button"} className='planit-dataresult-goalbutton'>
                                        <div className='planit-dataresult-goalbutton-text'>{planString.replace(/Creator:.*?\|/, '|')}</div>
                                    </button>
                                </div>                    
                            </a>
                            {currentFile && (
                                <div key={planString+"attachments"} className='planit-dataresult-attachments'>
                                    <div key={planString+"attachments1"} className='planit-dataresult-attachment'>
                                        <a href={'InfoData/' + itemID}>
                                            {currentFile.contentType.startsWith('image/') && (
                                                <img src={`data:${currentFile.contentType};base64,${currentFile.data}`} alt={currentFile.name} className='planit-dataresult-image' />
                                            )}
                                            {currentFile.contentType.startsWith('video/') && (
                                                <video controls className='planit-dataresult-video'>
                                                    <source src={`data:${currentFile.contentType};base64,${currentFile.data}`} type={currentFile.contentType} />
                                                    Your browser does not support the video tag.
                                                </video>
                                            )}
                                            {!currentFile.contentType.startsWith('image/') && !currentFile.contentType.startsWith('video/') && (
                                                <div className='planit-dataresult-file'>
                                                    <p>Attachment: {currentFile.filename}</p>
                                                    <p>Type: {currentFile.contentType}</p>
                                                </div>
                                            )}
                                        </a>
                                        {files.length > 1 && (
                                            <div className='planit-dataresult-file-navigation'>
                                                <button onClick={handlePrevFile}>Previous</button>
                                                <button onClick={handleNextFile}>Next</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                    <div key={planString+"0.3"} className='planit-dataresult-3'>
                        <div key={planString+"1"} className="planit-dataresult-disagree-div">
                            {user && planString.includes(user._id) ? (
                                <button key={planString+"1button"} className='planit-dataresult-disagreeACT' onClick={() => handleDisagree(planString)}><img key={planString+"4.002"} className='planit-dataresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                            ) : (
                                <button key={planString+"1.5button"} className='planit-dataresult-disagree' onClick={() => handleDisagree(planString)}><img key={planString+"4.001"} className='planit-dataresult-thumb' src={ThumbsDown} alt='thumbs down logo'/></button>
                            )}
                        </div>
                        <div key={planString+"3"} className="planit-dataresult-agree-div">
                            {user && planString.includes(user._id) ? (
                                <button key={planString+"3button"} className='planit-dataresult-agreeACT' onClick={() => handleAgree(planString)}><img key={planString+"4.003"} className='planit-dataresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                            ) : (
                                <button key={planString+"3button"} className='planit-dataresult-agree' onClick={() => handleAgree(planString)}><img key={planString+"4.004"} className='planit-dataresult-thumb' src={ThumbsUp} alt='thumbs up logo'/></button>
                            )}
                        </div>
                        <div className='planit-dataresult-votecomment-holder' key={planString+"4.005"}>
                            <a href={'plan/'+planString} className='planit-dataresult-votecomment-link' key={planString+"4.006"}>
                                <div className='planit-dataresult-votecomment' key={planString+"4.007"}>
                                    {(planString.length - planString.length > 0)
                                        ? "+"+(planString.length - planString.length)+" votes "
                                        : (planString.length - planString.length)+" votes "
                                    }
                                    |
                                    {" " + ( 0 ) + " comments"}
                                </div>
                            </a>
                        </div>           
                    </div>
                </div>
            </>
        );
    }
}

export default DataResult;