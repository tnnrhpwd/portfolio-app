import { useState, useEffect }  from 'react';
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import { useNavigate, useLocation, Link } from 'react-router-dom'              // page redirects
import { toast } from 'react-toastify'                        // visible error notifications
import { register, logout } from '../../features/data/dataSlice'     // import functions from authslice
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
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
    const location = useLocation() // to access navigation state
    const dispatch = useDispatch() // initialization
    const rootStyle = window.getComputedStyle(document.body);
    const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
    
    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage, operation } = useSelector(
        (state) => state.data
    )

    // Visiting the register page means starting a fresh sign-up. Clear any
    // stale persisted session so the page always starts clean.
    useEffect(() => {
        localStorage.removeItem('user');
        dispatch(logout());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        if (user && user._id && operation === 'register') {
            // only redirect after a successful registration
            const redirectTo = location.state?.redirectTo || '/';
            navigate(redirectTo);
        }

        // dispatch(resetDataSlice())   // reset state values( authMessage, isloading, iserror, and issuccess ) on each state change
    }, [user, operation, dataIsError, dataIsSuccess, dataMessage, navigate, dispatch, toastDuration])

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
        } else if (password.length < 8) {
            toast.error('Password must be at least 8 characters long.', { autoClose: 3000 })
        } else if (!/(?=.*[a-z])/.test(password)) {
            toast.error('Password must contain at least one lowercase letter.', { autoClose: 3000 })
        } else if (!/(?=.*[A-Z])/.test(password)) {
            toast.error('Password must contain at least one uppercase letter.', { autoClose: 3000 })
        } else if (!/(?=.*\d)/.test(password)) {
            toast.error('Password must contain at least one number.', { autoClose: 3000 })
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
        <SEO title="Register" description="Create a new STHopwood account to save, create, and share." path="/register" noindex />
        <Header />
        <div className="register">
            <div className="register-floating" aria-hidden="true">
                <div className="register-circle register-circle-1"></div>
                <div className="register-circle register-circle-2"></div>
                <div className="register-circle register-circle-3"></div>
            </div>

            <section className="register-hero">
                <div className="register-title-wrap">
                    <p className="register-eyebrow">Get started</p>
                    <h1 className="register-title">Create Your Account</h1>
                    <p className="register-subtitle">Register to save, create, and share goals and plans.</p>
                </div>
            </section>

            <main id="main" className="register-section">
                <div className="register-card">
                    <form onSubmit={onSubmit} autoComplete="on">
                        <div className="register-form-group">
                            <label className="register-label" htmlFor="register-nickname">Nickname</label>
                            <input
                                type="text"
                                className="register-input"
                                id="register-nickname"
                                name="nickname"
                                value={nickname}
                                placeholder="How should we greet you?"
                                onChange={onChange}
                                autoFocus
                                required
                            />
                        </div>
                        <div className="register-form-group">
                            <label className="register-label" htmlFor="register-email">Email</label>
                            <input
                                type="email"
                                className="register-input"
                                id="register-email"
                                name="email"
                                value={email}
                                placeholder="you@example.com"
                                onChange={onChange}
                                required
                            />
                        </div>
                        <div className="register-form-group">
                            <label className="register-label" htmlFor="register-password">Password</label>
                            <input
                                type="password"
                                className="register-input"
                                id="register-password"
                                name="password"
                                value={password}
                                placeholder="At least 8 characters"
                                onChange={onChange}
                                required
                            />
                            <p className="register-hint">Password must contain lowercase, uppercase, and number.</p>
                        </div>
                        <button type="submit" className="register-submit">
                            Create Account
                        </button>
                    </form>

                    <div className="register-actions">
                        <Link className="register-link" to="/login" state={{ redirectTo: location.state?.redirectTo }}>
                            Already have an account? Log in <span aria-hidden="true">→</span>
                        </Link>
                    </div>
                </div>
            </main>
        </div>
        <Footer />
    </>);
}

export default Register