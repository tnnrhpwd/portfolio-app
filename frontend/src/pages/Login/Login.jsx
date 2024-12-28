import { useState, useEffect }  from 'react';
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import { useNavigate } from 'react-router-dom'              // page redirects
import { toast } from 'react-toastify'                        // visible error notifications
import { login, logout, resetDataSlice } from '../../features/data/dataSlice'     // import functions from authslice
import Spinner from '../../components/Spinner/Spinner.jsx';
import React from 'react';
import './Login.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
const devMode = (process.env.NODE_ENV === 'development')

function Login() {
    // useState variables of input fields
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    })

    // the state values of the input fields
    const { email, password } = formData

    const navigate = useNavigate() // initialization
    const dispatch = useDispatch() // initialization
    const rootStyle = window.getComputedStyle(document.body);
    const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
    let loadingStartTime = null;

    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage } = useSelector(
        (state) => state.data
    )

    // called on state changes
    useEffect(() => {
        if (user && !user._id) {
            toast.error("We're sorry. We are having issues finding your account ID.", { autoClose: 2000 }) // print error to toast errors
            dispatch(logout())  // dispatch connects to the store, then remove user item from local storage
        }
        if (dataIsError) {
            if (dataMessage && !dataMessage.includes('token')) {
                toast.error(dataMessage, { autoClose: toastDuration });
              }
        }
        if (user && user._id) {  // if registered or logged in, 
            toast.success("Successfully logged in as "+user.nickname, { autoClose: 2000 }) // print error to toast errors
            navigate('/')           // send user to dashboard
        }else{
            dispatch(resetDataSlice())   // reset state values( data, dataisloading, dataiserror, datamessage, and dataissuccess ) on each state change
        }
    }, [user, dataIsError, dataIsSuccess, dataMessage, navigate, dispatch])

    useEffect(() => {
        if (dataIsLoading) {
            loadingStartTime = Date.now();
        }
    }, [dataIsLoading]);

    useEffect(() => {
        if (dataIsLoading && loadingStartTime && Date.now() - loadingStartTime > 5000) {
            toast.info("The server service takes about a minute to spin up. Please try again in a moment.", { autoClose: 3000 });
        }
    },  [dataIsLoading]);
    
    // called on each letter typed into input field
    const onChange = (e) => {
        setFormData((prevState) => ({
        ...prevState,
        [e.target.name]: e.target.value,
        }))
    }

      // called on each login form submit
    const onSubmit = (e) => {
        e.preventDefault()
        const userData = {     // get data from input form
        email,
        password,
        }
        console.log(userData)
        dispatch(login(userData))   // dispatch connects to the store, then calls the async register function passing userdata as input.
    }

    // called on each guest login form submit
    const handleGuestLogin = (e) => {
        e.preventDefault()

        const userData = {
          // set input data to guest user
          email: "Guest@gmail.com",
          password: "Guest",
        };
        dispatch(login(userData))   // dispatch connects to the store, then calls the async register function passing userdata as input. 
    }

    // if loading, show spinner. authIsLoading resets on state change.
    if (dataIsLoading) {
        return <Spinner />
    }

    return (<>
    <Header />
        <div className='planit-login'>
            <section className="planit-login-heading">
                <div className="planit-login-heading-title">
                    Hello!
                </div>
                <div className="planit-login-heading-description">
                    Log in to save, create, and share!
                </div>
            </section>
            <section className="planit-login-form">
                <form onSubmit={onSubmit}>
                    <div className="planit-login-form-group">
                        <input
                            type='email'
                            className='planit-login-form-control'
                            id='planit-email'
                            name='email'
                            value={email}
                            placeholder='Enter your email'
                            onChange={onChange}
                        />
                    </div>
                    <div className="planit-login-form-group">
                        <input
                            type='password'
                            className='planit-login-form-control'
                            id='planit-password'
                            name='password'
                            value={password}
                            placeholder='Enter password'
                            onChange={onChange}
                        />
                    </div>
                    <div className='planit-login-form-group'>
                        <button type='submit' className='planit-login-form-submit'>
                            Submit
                        </button>
                    </div>
                </form>
            </section>
            <a href='/register'>
                <button className='planit-login-register'>
                    Register
                </button>
            </a>
            {devMode &&
                <button onClick={handleGuestLogin} className='planit-login-guest'>
                    Login as Guest
                </button>
            }
        </div>
        <Footer />
    </>)
}

export default Login