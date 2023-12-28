import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'              // page redirects
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import useOutsideAlerter from '../useOutsideAlerter';
import { login, resetDataSlice } from '../../features/data/dataSlice'     // import functions from authslice
import { toast } from 'react-toastify'                        // visible error notifications
import './LoginView.css';


function LoginView(props) {

    const navigate = useNavigate() // initialization
    const dispatch = useDispatch() // initialization


    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage } = useSelector(
        (state) => state.data
    )

    // called on each guest login form submit
    const handleGuestLogin = (e) => {
        e.preventDefault()

        const userData = {     // get data from input form
            email: "Guest@gmail.com",
            password: "Guest",
        }

        dispatch(login(userData))   // dispatch connects to the store, then calls the async register function passing userdata as input. 
        hideComponentVisibility()
        toast.success("Logged in as Guest", { autoClose: 2000 }) // print error to toast errors
    }

    // called on state changes
    useEffect(() => {
        if (dataIsError) {
            toast.error(dataMessage) // print error to toast errors
        }

        if (dataIsSuccess || user) {  // if registered or logged in, 
            navigate('/')           // send user to dashboard
        }

        dispatch(resetDataSlice())   // reset state values( authMessage, isloading, iserror, and issuccess ) on each state change
    }, [user, dataIsError, dataIsSuccess, dataMessage, navigate, dispatch])


    const hideComponentVisibility = () => { props.click( false ); }
    const ComponentVisibility = () => { return( true ) }  
    const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
    const insideComponentRef = useRef(null); // reference to the dropper container
    useOutsideAlerter( "share", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects



  return (<>
  
    <div className='loginview' ref={insideComponentRef}>
        <div className='loginview-spc' >          
            <button className='loginview-spc-close' ref={toggleButtonRef} onClick={hideComponentVisibility}>
                Close
            </button>

            <div className='loginview-spc-welcome'>
                Welcome to Planit!
                <br/>
                <br/>
                -- The place where goals become actions
            </div>

            <div className='loginview-spc-account'>
                <a href='/login'>
                    <button className='loginview-spc-account-btn'>
                        Login
                    </button>
                </a>
  
                <a href='/register'>
                    <button className='loginview-spc-account-btn'>
                        Register
                    </button>
                </a>


                <br/>
                
                <button className='loginview-spc-account-btn' onClick={handleGuestLogin}>
                    Login as Guest
                </button>
                <button className='loginview-spc-account-btn' onClick={hideComponentVisibility}>
                    Skip...
                </button>
            </div>

        </div>
    </div>
  </>)
}

export default LoginView