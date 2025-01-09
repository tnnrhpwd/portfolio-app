import { useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import useOutsideAlerter from '../../useOutsideAlerter.js';
import { toast } from 'react-toastify';
import { deleteData } from '../../../features/data/dataSlice.js';
import DeleteView from '../DeleteView/DeleteView.jsx';
import './ManageView.css';

function ManageView({ type, user, itemString, topicID, click }) {
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const dispatch = useDispatch();
    let itemUserID = itemString.substring(itemString.indexOf("Creator:")+8, itemString.indexOf("Creator:")+8+24);
    let itemData = (itemString.substring(itemString.indexOf("Creator:")+8+25, itemString.length)).replace("Public:true", "");
    console.log("itemString:" + itemString + ", itemUserID:" + itemUserID + ", itemData:" + itemData + ", topicID:" + topicID);

    const hideComponentVisibility = () => click(null);
    const ComponentVisibility = () => true;
    const toggleButtonRef = useRef(null);
    const insideComponentRef = useRef(null);
    useOutsideAlerter("share", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility);

    const handleTopicDelete = () => {
        dispatch(deleteData(topicID));
        toast.info("Your plan has been deleted.", { autoClose: 2000 });
    };

    const handleShowDelete = (e) => {
        e.preventDefault();
        setShowDeleteConfirmation(!showDeleteConfirmation);
    };

    return (
        <>
            {showDeleteConfirmation && (
                <DeleteView
                    topicID={topicID}
                    view={true}
                    delFunction={handleTopicDelete}
                    click={setShowDeleteConfirmation}
                    type={type}
                />
            )}

            <div className="manage-view">
                <div className="manage-view-container" ref={insideComponentRef}>
                    <button
                        className="manage-view-close"
                        ref={toggleButtonRef}
                        onClick={hideComponentVisibility}
                    >
                        Close
                    </button>
                    <div className="manage-view-title">Manage View</div>
                    { itemUserID === user._id && (
                        <div className="manage-view-delete">
                            <button
                                onClick={handleShowDelete}
                                className="manage-view-delete-btn"
                            >
                                Delete : {itemData.length > 50 ? `${itemData.substring(0, 50)}...` : itemData}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default ManageView;