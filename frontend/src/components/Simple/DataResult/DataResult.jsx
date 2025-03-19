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

function GoldBadge() {
    return (
        <div className="badge gold-badge">
            <div className="badge-triangle gold-badge-triangle"></div>
            <div className="badge-circle gold-badge-circle"></div>
        </div>
    );
}

function SilverBadge() {
    return (
        <div className="badge silver-badge">
            <div className="badge-triangle silver-badge-triangle"></div>
            <div className="badge-circle silver-badge-circle"></div>
        </div>
    );
}

function UnknownBadge() {
    return (
        <div className="badge unknown-badge">
            <div className="badge-triangle unknown-badge-triangle"></div>
            <div className="badge-circle unknown-badge-circle"></div>
        </div>
    );
}

function DataResult(props) {
    const planString = props.importPlanString;
    const updatedAt = props.updatedAtData;
    const itemID = props.itemID;
    const files = props.files || [];
    const userName = props.userName;
    const userBadge = props.userBadge;
    
    // Extract user rank from planString if available
    let userRank = "Free"; // Default rank
    if (planString && planString.includes("|Rank:")) {
        const rankMatch = planString.match(/\|Rank:([^|]*)/);
        if (rankMatch && rankMatch[1]) {
            userRank = rankMatch[1].trim();
        }
    }

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
            const manageViewComponent = <ManageView topicID={id} itemString={planString} user={user} view={true} click={setManageView} type={type} />;
            setManageView(manageViewComponent);
        } else {
            setManageView(null);
        }
    }

    function handleNextFile() {
        if (files.length > 1) {
            setCurrentFileIndex((prevIndex) => (prevIndex + 1) % files.length);
        }
    }

    function handlePrevFile() {
        if (files.length > 1) {
            setCurrentFileIndex((prevIndex) => (prevIndex - 1 + files.length) % files.length);
        }
    }

    // Updated renderBadge function based on user rank
    const renderBadge = () => {
        // If we have a direct userBadge prop, use that first
        if (userBadge) {
            if (userBadge === 'Gold') return <GoldBadge />;
            if (userBadge === 'Silver') return <SilverBadge />;
            return <UnknownBadge />;
        }
        
        // Otherwise use rank from the plan string
        switch (userRank) {
            case 'Premium':
                return <GoldBadge />;
            case 'Flex':
                return <SilverBadge />;
            default: // 'Free' or any other value
                return <UnknownBadge />;
        }
    };

    if(planString){
        const currentFile = files && files.length > 0 ? files[currentFileIndex] : null;
        
        // Clean the displayed plan string by removing system metadata
        const displayPlanString = planString.replace(/Creator:.*?\|/, '|').replace(/\|Rank:[^|]*/, '');

        return (
            <>
                {shareView}
                {manageView}

                <div className='planit-dataresult'>
                    <div className='planit-dataresult-header'>
                        <div className='planit-dataresult-created'>
                            {renderBadge()}
                            <span className='planit-dataresult-created-user'>{userName}</span>
                            <div className='planit-dataresult-created-date'>                            
                                <CreatedAt createdAt={updatedAt}/>
                            </div>
                        </div>
                        <div className='planit-dataresult-actions'>
                            <button className='planit-dataresult-share-btn' onClick={() => handleShareView("plan", itemID)}>
                                <span className="btn-icon">🔗</span>
                                <span className="btn-text">Share</span>
                            </button>
                            {user && (
                                <>
                                    <button 
                                        className={planString.includes(user._id) ? 'planit-dataresult-fav-btn' : 'planit-dataresult-unfav-btn'} 
                                        onClick={() => planString.includes(user._id) ? handleUnfavorite(itemID) : handleFavorite(itemID)}>
                                        <span className="btn-icon">{planString.includes(user._id) ? '❤' : '♡'}</span>
                                    </button>
                                    <button className='planit-dataresult-manageplan-btn' onClick={() => handleManageView("plan",itemID)}>
                                        <span className="btn-icon">☸</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    
                    <div className='planit-dataresult-content'>                    
                        <a href={'InfoData/' + itemID} className="planit-dataresult-link">
                            <div className='planit-dataresult-goal'>
                                <div className='planit-dataresult-goalbutton-text'>{displayPlanString}</div>
                            </div>                    
                        </a>
                        
                        {currentFile && (
                            <div className='planit-dataresult-attachments'>
                                <div className='planit-dataresult-attachment'>
                                    <a href={'InfoData/' + itemID}>
                                        {currentFile.contentType && currentFile.contentType.startsWith('image/') && (
                                            <img src={`data:${currentFile.contentType};base64,${currentFile.data}`} alt={currentFile.filename} className='planit-dataresult-image' />
                                        )}
                                        {currentFile.contentType && currentFile.contentType.startsWith('video/') && (
                                            <video controls className='planit-dataresult-video'>
                                                <source src={`data:${currentFile.contentType};base64,${currentFile.data}`} type={currentFile.contentType} />
                                                Your browser does not support the video tag.
                                            </video>
                                        )}
                                        {currentFile.contentType && !currentFile.contentType.startsWith('image/') && !currentFile.contentType.startsWith('video/') && (
                                            <div className='planit-dataresult-file'>
                                                <p>Attachment: {currentFile.filename}</p>
                                                <p>Type: {currentFile.contentType}</p>
                                            </div>
                                        )}
                                    </a>
                                    {files.length > 1 && (
                                        <div className='planit-dataresult-file-navigation'>
                                            <button onClick={handlePrevFile} className="nav-button prev-button">Previous</button>
                                            <span className="file-counter">{currentFileIndex + 1} / {files.length}</span>
                                            <button onClick={handleNextFile} className="nav-button next-button">Next</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className='planit-dataresult-footer'>
                        <div className="planit-dataresult-voting">
                            <button 
                                className={user && planString.includes(user._id) ? 'planit-dataresult-disagreeACT' : 'planit-dataresult-disagree'} 
                                onClick={() => handleDisagree(planString)}>
                                <img className='planit-dataresult-thumb' src={ThumbsDown} alt='thumbs down logo'/>
                            </button>
                            <div className='planit-dataresult-votecomment-holder'>
                                <a href={'plan/'+planString} className='planit-dataresult-votecomment-link'>
                                    <div className='planit-dataresult-votecomment'>
                                        {(planString.length - planString.length > 0)
                                            ? "+"+(planString.length - planString.length)+" votes "
                                            : (planString.length - planString.length)+" votes "
                                        }
                                        |
                                        {" " + ( 0 ) + " comments"}
                                    </div>
                                </a>
                            </div>           
                            <button 
                                className={user && planString.includes(user._id) ? 'planit-dataresult-agreeACT' : 'planit-dataresult-agree'} 
                                onClick={() => handleAgree(planString)}>
                                <img className='planit-dataresult-thumb' src={ThumbsUp} alt='thumbs up logo'/>
                            </button>
                        </div>
                    </div>
                </div>
            </>
        );
    }
    
    return null;
}

export default DataResult;