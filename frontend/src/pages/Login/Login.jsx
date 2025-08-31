import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux'      // useSelector-brings in user,iserror,isloading from state | useDispatch-brings in reset,register,login from state
import { useNavigate } from 'react-router-dom'              // page redirects
import { toast } from 'react-toastify'                        // visible error notifications
import { login, resetDataSlice } from '../../features/data/dataSlice'     // import functions from authslice
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
    const [showPassword, setShowPassword] = useState(false);
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);

    const navigate = useNavigate() // initialization
    const dispatch = useDispatch() // initialization
    const loadingStartTimeRef = useRef(null);

    // select values from state
    const { user, dataIsLoading, dataIsError, dataIsSuccess, dataMessage } = useSelector(
        (state) => state.data
    )

    // called on state changes
    useEffect(() => {
        if (user && !user._id) {
            toast.error(dataMessage, { autoClose: 3000 }) // print error to toast errors
            // dispatch(logout())  // dispatch connects to the store, then remove user item from local storage
        }
        if (dataIsError && dataMessage) {
            // Handle specific login error messages with better user feedback
            let errorMessage = dataMessage;
            
            // Don't show token-related errors on login page
            if (dataMessage.includes('token')) {
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
        if (user && user._id) {  // if registered or logged in, 
            const welcomeMessage = user.nickname === 'Guest User' 
                ? `Welcome, ${user.nickname}! (Debug Mode)` 
                : `Welcome back, ${user.nickname}!`;
            
            toast.success(welcomeMessage, { 
                autoClose: 2000,
                hideProgressBar: false,
                closeOnClick: true,
                pauseOnHover: true,
            });
            navigate('/');           // send user to dashboard
        } else {
            dispatch(resetDataSlice());   // reset state values( data, dataisloading, dataiserror, datamessage, and dataissuccess ) on each state change
        }
    }, [user, dataIsError, dataIsSuccess, dataMessage, navigate, dispatch])

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
        console.log('Attempting login for:', email);
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

    // Handle social login
    const handleSocialLogin = async (provider) => {
        console.log(`Attempting social login with ${provider}`);
        
        try {
            const providerConfig = {
                google: {
                    url: `https://accounts.google.com/oauth/authorize`,
                    clientId: process.env.REACT_APP_GOOGLE_CLIENT_ID,
                    scope: 'email profile',
                    name: 'Google'
                },
                facebook: {
                    url: `https://www.facebook.com/v12.0/dialog/oauth`,
                    clientId: process.env.REACT_APP_FACEBOOK_CLIENT_ID,
                    scope: 'email',
                    name: 'Facebook'
                },
                github: {
                    url: `https://github.com/login/oauth/authorize`,
                    clientId: process.env.REACT_APP_GITHUB_CLIENT_ID,
                    scope: 'user:email',
                    name: 'GitHub'
                }
            };

            const config = providerConfig[provider];
            
            if (!config || !config.clientId) {
                toast.error(`${provider} login is not configured. Please use email/password login or contact support.`, { autoClose: 4000 });
                return;
            }

            toast.info(`Redirecting to ${config.name} for login...`, { autoClose: 2000 });

            // Build OAuth URL
            const params = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: `${window.location.origin}/auth/callback/${provider}`,
                scope: config.scope,
                response_type: 'code',
                state: JSON.stringify({ 
                    action: 'login',
                    provider: provider
                })
            });

            const authUrl = `${config.url}?${params.toString()}`;
            
            // Open OAuth popup window
            const popup = window.open(
                authUrl,
                `${provider}-oauth-login`,
                'width=600,height=600,scrollbars=yes,resizable=yes'
            );

            // Monitor popup for completion
            const checkClosed = setInterval(() => {
                if (popup?.closed) {
                    clearInterval(checkClosed);
                    // Check if login was successful
                    checkSocialLoginStatus(provider);
                }
            }, 1000);

        } catch (error) {
            console.error(`Error initiating ${provider} login:`, error);
            toast.error(`Failed to initiate ${provider} login. Please try again or use email/password login.`, { autoClose: 3000 });
        }
    };

    // Check if social login was successful
    const checkSocialLoginStatus = async (provider) => {
        try {
            // TODO: Make API call to check if the social login was successful
            // For now, we'll show a message that it's not implemented
            toast.info(`${provider} login integration is coming soon! Please use email/password login for now.`, { autoClose: 4000 });
            
        } catch (error) {
            console.error(`Error checking ${provider} login status:`, error);
            toast.error(`Failed to complete ${provider} login.`, { autoClose: 3000 });
        }
    };

    // if loading, show spinner. authIsLoading resets on state change.
    if (dataIsLoading) {
        return <Spinner />
    }

        return (<>
            <Header />
            <div className="planit-login-bg">
                <div className="floating-shapes">
                    <div className="floating-circle floating-circle-1"></div>
                    <div className="floating-circle floating-circle-2"></div>
                    <div className="floating-circle floating-circle-3"></div>
                </div>
                <div className="planit-login-card">
                    <section className="planit-login-heading">
                        <div className="planit-login-heading-title">Welcome Back!</div>
                        <div className="planit-login-heading-description">Log in to save, create, and share!</div>
                    </section>
                    <section className="planit-login-form">
                        <form onSubmit={onSubmit} autoComplete="on">
                            <div className="planit-login-form-group">
                                <input
                                    type="email"
                                    className={`planit-login-form-control ${attemptedSubmit && dataIsError && (dataMessage.includes('email') || dataMessage.includes('Could not find that user')) ? 'error' : ''}`}
                                    id="planit-email"
                                    name="email"
                                    value={email}
                                    placeholder="Enter your email"
                                    onChange={onChange}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="planit-login-form-group">
                                <div className="planit-login-password-wrapper">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        className={`planit-login-form-control ${attemptedSubmit && dataIsError && (dataMessage.includes('password') || dataMessage.includes('Invalid password')) ? 'error' : ''}`}
                                        id="planit-password"
                                        name="password"
                                        value={password}
                                        placeholder="Enter password"
                                        onChange={onChange}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="planit-login-showhide"
                                        onClick={() => setShowPassword((show) => !show)}
                                        tabIndex={0}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? "🙈" : "👁️"}
                                    </button>
                                </div>
                            </div>
                            <div className="planit-login-form-group">
                                <button type="submit" className="planit-login-form-submit" disabled={dataIsLoading}>
                                    {dataIsLoading ? 'Logging In...' : 'Log In'}
                                </button>
                            </div>
                        </form>
                    </section>
                    
                    {/* Social Login Options */}
                    <section className="planit-login-social">
                        <div className="planit-login-divider">
                            <span>or</span>
                        </div>
                        <div className="planit-login-social-buttons">
                            <button
                                type="button"
                                className="planit-login-social-button planit-login-google"
                                onClick={() => handleSocialLogin('google')}
                                disabled={dataIsLoading}
                            >
                                🌐 Continue with Google
                            </button>
                            <button
                                type="button"
                                className="planit-login-social-button planit-login-facebook"
                                onClick={() => handleSocialLogin('facebook')}
                                disabled={dataIsLoading}
                            >
                                📘 Continue with Facebook
                            </button>
                            <button
                                type="button"
                                className="planit-login-social-button planit-login-github"
                                onClick={() => handleSocialLogin('github')}
                                disabled={dataIsLoading}
                            >
                                🐱 Continue with GitHub
                            </button>
                        </div>
                    </section>
                    
                    <div className="planit-login-actions">
                        <a href="/register">
                            <button className="planit-login-register">Register</button>
                        </a>
                        {devMode && (
                            <button 
                                onClick={handleGuestLogin} 
                                className="planit-login-guest"
                                disabled={dataIsLoading}
                            >
                                {dataIsLoading ? 'Logging in as Guest...' : 'Login as Guest'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <Footer />
        </>);
}

export default Login