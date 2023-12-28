import { toast } from 'react-toastify'                        // visible error notifications
import { useRef } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js'
import './ShareView.css'

function ShareView(props) {
    const type = props.type.toLowerCase();
    const id = props.id;
    const link = "https://mern-planit-app.herokuapp.com/"+type+"/"+id;

    const hideComponentVisibility = () => {props.click(null);}
    const ComponentVisibility = () => { return( true ) }  
    const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
    const insideComponentRef = useRef(null); // reference to the dropper container
    useOutsideAlerter( "share", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects


  return (
    <div className='shareview-spc'>

        <div className='shareview' ref={insideComponentRef}>

            <div className='shareview-interact'>

                <button ref={toggleButtonRef} onClick={hideComponentVisibility} className='shareview-interact-close'>
                    Close
                </button>
            </div>
                This is a shareable link to the {type}.
            <br/>
            <textarea readOnly className='shareview-textarea' value={link}/>
            <button className='shareview-copy' onClick={() => {navigator.clipboard.writeText(link);toast.success("Link Copied!")}}>
                Copy to Clipboard
            </button>
            
            
        </div>
    </div>
  )
}

export default ShareView