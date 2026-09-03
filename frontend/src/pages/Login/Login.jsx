import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import { useNavigate, useLocation, Link } from 'react-router-dom'              // page redirects
import { toast } from 'react-toastify'                        // visible error notifications
import { login, logout, resetDataSlice, resetDataSuccess } from '../../features/data/dataSlice'     // import functions from authslice
import Spinner from '../../components/Spinner/Spinner.jsx';
import React from 'react';
import './Login.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
import { isTokenValid } from '../../utils/tokenUtils.js';
const devMode = (process.env.NODE_ENV === 'development')

function Login() {
    // useState variables of input fields
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    })

    // the state values of the input fields
    const { email, password } = formData
    const [showPassword, setShowPassword] = useState(false);
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);

    const navigate = useNavigate() // initialization
    const location = useLocation() // to access navigation state
    const dispatch = useDispatch() // initialization
    const loadingStartTimeRef = useRef(null);

    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage, operation } = useSelector(
        (state) => state.data
    )

    // Visiting the login page means starting a fresh sign-in. Clear any stale
    // persisted session (e.g. a token whose user record was deleted) and reset
    // auth state so the form always starts clean — the user isn't bounced
    // through 401 loops from an orphaned token and can just log in.
    useEffect(() => {
        if (localStorage.getItem('user')) {
            localStorage.removeItem('user');
        }
        // `logout` is the one action that actually nulls `state.user`;
        // `resetDataSlice` would instead restore the module-load-time user.
        dispatch(logout());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // called on state changes
    useEffect(() => {
        console.log('🔧 Login useEffect triggered:', {
            hasUser: !!user,
            userId: user?._id,
            userNickname: user?.nickname,
            dataIsError,
            dataIsSuccess,
            dataIsLoading,
            dataMessage,
            operation: user?.operation
        });

        // If user exists but has old error data (no _id), clear localStorage and reset state
        if (user && !user._id && user.dataMessage) {
            console.log('🔧 User has old error data, clearing localStorage:', user);
            localStorage.removeItem('user');
            dispatch(resetDataSlice());
            return; // Don't show error toast for stale data
        }

        // If user exists but token is invalid/expired, clear it and stay on login
        if (user && user._id && !isTokenValid(user.token)) {
            console.log('🔧 User has expired token, clearing from localStorage');
            localStorage.removeItem('user');
            dispatch(resetDataSlice());
            // Show session expired message only if redirected from another page
            const queryExpired = new URLSearchParams(location.search).get('sessionExpired') === '1';
            if (location.state?.sessionExpired || queryExpired) {
                toast.info('Your session has expired. Please log in again.', {
                    autoClose: 4000,
                    hideProgressBar: false,
                });
            }
            return;
        }

        // Only show error toast if there's an actual error from a recent login attempt
        if (dataIsError && dataMessage) {
            // Handle specific login error messages with better user feedback
            let errorMessage = dataMessage;
            
            // Log the original error for debugging
            console.error('Login error received:', dataMessage);
            console.error('Current environment:', process.env.NODE_ENV);
            
            // Don't hide all token-related errors, only specific ones that aren't relevant during login
            if (dataMessage === 'Not authorized, no token' && window.location.pathname === '/login') {
                // This is expected on the login page, don't show it
                return;
            }
            
            // Customize error messages for better user experience
            if (dataMessage === "Could not find that user.") {
                errorMessage = "No account found with this email address. Please check your email or register a new account.";
            } else if (dataMessage === "Invalid password.") {
                errorMessage = "Incorrect password. Please check your password and try again.";
                // Clear password field on invalid password
                setFormData(prevState => ({
                    ...prevState,
                    password: ''
                }));
            } else if (dataMessage === "Server error during login.") {
                errorMessage = "Login service is temporarily unavailable. Please try again in a few moments.";
            } else if (dataMessage === "Please provide a valid email address") {
                errorMessage = "Please enter a valid email address.";
            } else if (dataMessage === "Password is required") {
                errorMessage = "Please enter your password.";
            } else if (dataMessage.includes('Unable to connect to server')) {
                errorMessage = "Unable to connect to server. Please check your internet connection and try again.";
            } else if (dataMessage.includes('timeout')) {
                errorMessage = "Login request timed out. Please check your internet connection and try again.";
            } else if (dataMessage.includes('Network Error') || dataMessage.includes('ERR_NETWORK')) {
                errorMessage = "Network error. Please check your internet connection and try again.";
            } else {
                // Show the original error for debugging in production
                errorMessage = `Login failed: ${dataMessage}`;
                console.error('Unhandled login error:', dataMessage);
            }
            
            toast.error(errorMessage, { 
                autoClose: 4000,
                hideProgressBar: false,
                closeOnClick: true,
                pauseOnHover: true,
                draggable: true,
            });
            
            setAttemptedSubmit(true);
        }
        if (user && user._id && operation === 'login') {  // only after a successful login submission
            // Don't show toast if coming from an expired session redirect
            if (!location.state?.sessionExpired) {
                const welcomeMessage = user.nickname === 'Guest User' 
                    ? `Welcome, ${user.nickname}! (Debug Mode)` 
                    : `Welcome back, ${user.nickname}!`;
                
                toast.success(welcomeMessage, { 
                    autoClose: 2000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                });
            }
            // Redirect to intended page if provided, otherwise home
            const redirectTo = location.state?.redirectTo || '/';
            navigate(redirectTo);           // send user to intended destination
        } else {
            // Reset only the data flags (so error toasts don't repeat) without
            // touching `user` — resetDataSlice would restore a stale user.
            dispatch(resetDataSuccess());
        }
    }, [user, operation, dataIsError, dataIsSuccess, dataIsLoading, dataMessage, navigate, dispatch, location.state?.sessionExpired])

    // Show a one-time toast when redirected here from an expired session
    useEffect(() => {
        const queryExpired = new URLSearchParams(location.search).get('sessionExpired') === '1';
        if (queryExpired) {
            toast.info('Your session has expired. Please log in again.', {
                autoClose: 4000,
                hideProgressBar: false,
            });
        }
        // Run only on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (dataIsLoading) {
            loadingStartTimeRef.current = Date.now();
        }
    }, [dataIsLoading]);

    useEffect(() => {
        if (dataIsLoading && loadingStartTimeRef.current && Date.now() - loadingStartTimeRef.current > 5000) {
            toast.info("The server takes about a minute to spin up. Please try again in a moment.", { autoClose: 3000 });
        }
    }, [dataIsLoading]);
    
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
        
        // Reset previous attempt state
        setAttemptedSubmit(false);
        
        // Basic client-side validation
        if (!email.trim()) {
            toast.error("Please enter your email address.", { autoClose: 3000 });
            return;
        }
        
        if (!password.trim()) {
            toast.error("Please enter your password.", { autoClose: 3000 });
            return;
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            toast.error("Please enter a valid email address.", { autoClose: 3000 });
            return;
        }
        
        const userData = {     // get data from input form
            email: email.trim(),
            password,
        }
        
        console.log('=== LOGIN FORM SUBMIT ===');
        console.log('Environment:', process.env.NODE_ENV);
        console.log('Attempting login for email:', email);
        console.log('Window location:', window.location.href);
        console.log('User agent:', navigator.userAgent);
        console.log('Local storage user:', localStorage.getItem('user') ? 'exists' : 'none');
        
        dispatch(login(userData));   // dispatch connects to the store, then calls the async register function passing userdata as input.
    }

    // called on each guest login form submit
    const handleGuestLogin = async (e) => {
        e.preventDefault()
        
        // Reset previous attempt state
        setAttemptedSubmit(false);

        try {
            const userData = {
              // set input data to guest user (matches database entry)
              email: "guest@gmail.com",
              password: "guest",
            };
            
            console.log('Attempting guest login with:', userData.email);
            await dispatch(login(userData)).unwrap();   // Use unwrap() to handle promise rejection properly
        } catch (error) {
            console.error('Guest login failed:', error);
            // Additional error handling for guest login issues
            if (error.includes && error.includes('Could not find that user')) {
                toast.error('Guest user not found. Please contact support or try regular login.', {
                    autoClose: 5000
                });
            }
        }
    }

    // if loading, show spinner. authIsLoading resets on state change.
    if (dataIsLoading) {
        return <Spinner />
    }

        return (<>
            <SEO title="Login" description="Log in to your STHopwood account to save, create, and share." path="/login" noindex />
            <Header />
            <div className="login">
                <div className="login-floating" aria-hidden="true">
                    <div className="login-circle login-circle-1"></div>
                    <div className="login-circle login-circle-2"></div>
                    <div className="login-circle login-circle-3"></div>
                </div>

                <section className="login-hero">
                    <div className="login-title-wrap">
                        <p className="login-eyebrow">Account</p>
                        <h1 className="login-title">Welcome Back</h1>
                        <p className="login-subtitle">Log in to save, create, and share.</p>
                    </div>
                </section>

                <main id="main" className="login-section">
                    <div className="login-card">
                        <form onSubmit={onSubmit} autoComplete="on">
                            <div className="login-form-group">
                                <label className="login-label" htmlFor="login-email">Email</label>
                                <input
                                    type="email"
                                    className={`login-input ${attemptedSubmit && dataIsError && (dataMessage.includes('email') || dataMessage.includes('Could not find that user')) ? 'error' : ''}`}
                                    id="login-email"
                                    name="email"
                                    value={email}
                                    placeholder="you@example.com"
                                    onChange={onChange}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="login-form-group">
                                <label className="login-label" htmlFor="login-password">Password</label>
                                <div className="login-password-wrapper">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        className={`login-input ${attemptedSubmit && dataIsError && (dataMessage.includes('password') || dataMessage.includes('Invalid password')) ? 'error' : ''}`}
                                        id="login-password"
                                        name="password"
                                        value={password}
                                        placeholder="Enter your password"
                                        onChange={onChange}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="login-showhide"
                                        onClick={() => setShowPassword((show) => !show)}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                            </div>
                            <button type="submit" className="login-submit" disabled={dataIsLoading}>
                                {dataIsLoading ? 'Logging In…' : 'Log In'}
                            </button>
                        </form>

                        <div className="login-actions">
                            <Link className="login-link" to="/register" state={{ redirectTo: location.state?.redirectTo }}>
                                Create an account <span aria-hidden="true">→</span>
                            </Link>
                            <Link className="login-link" to="/forgot-password">
                                Forgot password?
                            </Link>
                            {devMode && (
                                <button
                                    onClick={handleGuestLogin}
                                    className="login-guest"
                                    disabled={dataIsLoading}
                                >
                                    {dataIsLoading ? 'Logging in as Guest…' : 'Continue as Guest'}
                                </button>
                            )}
                        </div>
                    </div>
                </main>
            </div>
            <Footer />
        </>);
}

export default Login