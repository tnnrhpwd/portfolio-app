import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import useOutsideAlerter from '../../useOutsideAlerter.js'
import { toast } from 'react-toastify'                        // visible error notifications
import { deleteData } from '../../../features/data/dataSlice.js';
import DeleteView from '../DeleteView/DeleteView.jsx';
import './ManageView.css';


function ManageView(props) {
    const [ showDeleteConfirmation, setShowDeleteConfirmation ] = useState(false);

    const dispatch = useDispatch();
    // const navigate = useNavigate();

    const type = props.type.toLowerCase();
    const user = props.user
    const owner = props.owner
    const topicID = props.topicID

    const hideComponentVisibility = () => { props.click( null ); }
    const ComponentVisibility = () => { return( true ) }  
    const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
    const insideComponentRef = useRef(null); // reference to the dropper container
    useOutsideAlerter( "share", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects

    const handleTopicDelete = () => {
        switch(type) {
            case 'goal':
                dispatch(deleteData( topicID ))
                toast.info("Your plan has been deleted.", { autoClose: 2000 }) // print error to toast errors
                break;
            default:
                toast.error("Delete type is not defined.", { autoClose: 2000 }) // print error to toast errors
        }


    }
    const handleShowDelete = (e) => {
        e.preventDefault()
        if(showDeleteConfirmation){setShowDeleteConfirmation(false)}
        else if(!showDeleteConfirmation){setShowDeleteConfirmation(true)}
        
    }

    return (<>
        {   ( showDeleteConfirmation ) &&
            < DeleteView topicID={topicID} view={true} delFunction={handleTopicDelete} click={setShowDeleteConfirmation} type={type} />
        }

        <div className='planit-manageview'>
            <div className='planit-manageview-spc' ref={insideComponentRef}>
                <button className='planit-manageview-spc-close' ref={toggleButtonRef} onClick={hideComponentVisibility}>
                    Close
                </button>
                <div className='planit-manageview-spc-title'>
                    ManageView
                </div>
                { (user._id === owner) &&
                    <div className='planit-manageview-spc-delete'>
                        <button onClick={handleShowDelete} className='planit-manageview-spc-delete-btn'>
                            Delete {type}
                        </button>
                    </div>
                }
            </div>
        </div>
    </>)
}

export default ManageView