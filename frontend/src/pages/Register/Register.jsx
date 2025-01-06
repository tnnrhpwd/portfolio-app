import { useState, useEffect }  from 'react';
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import { useNavigate } from 'react-router-dom'              // page redirects
import { toast } from 'react-toastify'                        // visible error notifications
import { register } from '../../features/data/dataSlice'     // import functions from authslice
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import './Register.css';

function Register() {
    // useState variables of input fields
    const [formData, setFormData] = useState({
        nickname: '',
        email: '',
        password: '',
    })

    // the state values of the input fields
    const { email, password, nickname } = formData

    const navigate = useNavigate() // initialization
    const dispatch = useDispatch() // initialization
    const rootStyle = window.getComputedStyle(document.body);
    const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
    
    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage } = useSelector(
        (state) => state.data
    )

    // called on state changes
    useEffect(() => {
        if (dataIsError) {
            if (dataMessage && !dataMessage.includes('token')) {
                toast.error(dataMessage, { autoClose: toastDuration });
              }
        }

        if (dataIsSuccess) {
            // if registered,
            toast.success("Successfully Registered", { autoClose: 2000 }); // print success to toast
        }
        if (user) {
            // if logged in,
            navigate("/"); // send user to dashboard
        }

        // dispatch(resetDataSlice())   // reset state values( authMessage, isloading, iserror, and issuccess ) on each state change
    }, [user, dataIsError, dataIsSuccess, dataMessage, navigate, dispatch, toastDuration])

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

        if (((nickname).length === 0) || ((email).length === 0) || ((password).length === 0)) { // if passwords dont match, error. Else, 
            toast.error('Please fill in all blanks.', { autoClose: 2000 })
        } else {
            const userData = {  // get data from input form
            nickname,
            email,
            password,
            }
            dispatch(register(userData))  // dispatch connects to the store, then calls the async register function passing userdata as input.
        }
    }

      // if loading, show spinner. authIsLoading resets on state change.
    if (dataIsLoading) {
        return <Spinner />
    }

  return (<>
    <Header />
    <div className='planit-register'>
        <section className="planit-register-heading">
            <div className="planit-register-heading-title">
                Register Now!
            </div>
            <div className="planit-register-heading-description">
                Register to save, create, and share goals and plans!
            </div>
        </section>
        <section className="planit-register-form">
            <form onSubmit={onSubmit}>
                <div className="planit-register-form-group">
                    <input
                        type='nickanme'
                        className='planit-register-form-control'
                        id='nickname'
                        name='nickname'
                        value={nickname}
                        placeholder='Enter nickname'
                        onChange={onChange}
                    />
                </div>
                <div className="planit-register-form-group">
                    <input
                        type='email'
                        className='planit-register-form-control'
                        id='email'
                        name='email'
                        value={email}
                        placeholder='Enter your email'
                        onChange={onChange}
                    />
                </div>
                <div className="planit-register-form-group">
                    <input
                        type='password'
                        className='planit-register-form-control'
                        id='password'
                        name='password'
                        value={password}
                        placeholder='Enter password'
                        onChange={onChange}
                    />
                </div>
                <div className='planit-register-form-group'>
                    <button type='submit' className='planit-register-form-submit'>
                        Submit
                    </button>
                </div>
            </form>
        </section>
        <a href='/login'>
            <button className='planit-register-login'>
                Log In Instead
            </button>
        </a>
    </div>
    <Footer />
  </>)
}

export default Register