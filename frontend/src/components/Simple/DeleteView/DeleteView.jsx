import { useRef } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js'
import './DeleteView.css'

function DeleteView(props) {
    const type = props.type.toLowerCase();
    const topicID = props.topicID;

    const handleDelete = () => { props.delFunction( topicID ); }
    const hideComponentVisibility = () => { props.click( null ); }
    const ComponentVisibility = () => { return( true ) }  
    const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
    const insideComponentRef = useRef(null); // reference to the dropper container
    useOutsideAlerter( "share", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects

    return (
        <div className='planit-deleteview'>
            <div className='planit-deleteview-spc' ref={insideComponentRef}>
                Are you sure you want to delete this { type }?
                <div>
                    <button className='planit-deleteview-spc-btn' onClick={handleDelete}>
                        Yes, delete.
                    </button>
                    <button className='planit-deleteview-spc-btn' ref={toggleButtonRef} onClick={hideComponentVisibility} >
                        No.
                    </button>
                </div>
            </div>
        </div>
    )
}

export default DeleteView