import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice, resetDataSuccess, getUserSubscription } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import { isTokenValid, getTokenExpiration } from '../../utils/tokenUtils.js';
import { toast } from 'react-toastify';
import './Profile.css';
import HeaderLogo from '../../../src/assets/Checkmark512.png';

function Profile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [currentColorMode, setCurrentColorMode] = useState('system');
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [userSubscription, setUserSubscription] = useState(null);

  // Get user data from Redux state
  const { user, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector((state) => state.data);

  // Theme detection effect
  useEffect(() => {
    // Detect current theme on component mount
    const html = document.querySelector('html');
    if (html.classList.contains('dark')) {
      setCurrentColorMode('dark');
    } else if (html.classList.contains('light')) {
      setCurrentColorMode('light');
    } else {
      setCurrentColorMode('system');
    }
    
    if (!user) {
      navigate('/login');
      return;
    }

    if (dataIsError) {
      toast.error(dataMessage);
      console.log('Toast error message:', dataMessage);
      dispatch(resetDataSuccess());
    }

    if (dataIsSuccess && dataMessage) {
      toast.success(dataMessage);
      console.log('Toast success message:', dataMessage);
      dispatch(resetDataSuccess());
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [user, dataIsSuccess, dataIsError, dataMessage, navigate, dispatch]);

  // Only fetch subscription data once when component mounts
  useEffect(() => {
    if (user && !subscriptionLoaded) {
      // Debug: Check user token
      console.log('User object:', user);
      console.log('User token exists:', !!user.token);
      
      if (!user.token) {
        console.log('No token found, logging out');
        dispatch(logout());
        navigate('/login');
        return;
      }
      
      // Check if token is valid using utility function
      if (!isTokenValid(user.token)) {
        const expiration = getTokenExpiration(user.token);
        console.log('Token is invalid or expired');
        console.log('Token expiration:', expiration);
        toast.error('Your session has expired. Please log in again.');
        dispatch(logout());
        navigate('/login');
        return;
      }
      
      console.log('Token is valid, fetching subscription');
      
      // Use a local try-catch to prevent the component from crashing
      try {
        dispatch(getUserSubscription())
          .unwrap()
          .then((subscriptionData) => {
            console.log('Successfully fetched subscription:', subscriptionData);
            setUserSubscription(subscriptionData);
            setSubscriptionLoaded(true);
            dispatch(resetDataSuccess());
          })
          .catch((error) => {
            console.error('Failed to fetch subscription:', error);
            
            // If it's an authentication error, redirect to login
            if (error.includes('Not authorized') || error.includes('token expired')) {
              toast.error('Your session has expired. Please log in again.');
              dispatch(logout());
              navigate('/login');
            } else {
              // For other errors, just mark as loaded and set default subscription
              setUserSubscription({ subscriptionPlan: 'Free', subscriptionDetails: null });
              setSubscriptionLoaded(true);
            }
            dispatch(resetDataSuccess());
          });
      } catch (error) {
        console.error('Error dispatching subscription action:', error);
        setSubscriptionLoaded(true);
      }
    }
  }, [user, subscriptionLoaded, dispatch, navigate]);

  // Rest of handlers
  const onLogout = () => {
    setSubscriptionLoaded(false); // Reset subscription loaded state
    dispatch(logout());
    dispatch(resetDataSlice());
    navigate('/');
  };

  const navigateToSettings = () => {
    navigate('/settings');
  };

  const handleSubscriptionChange = (event) => {
    const newPlan = event.target.value;
    
    // Check if the user is trying to select their current plan
    if (newPlan.toLowerCase() === (userSubscription?.subscriptionPlan || 'Free').toLowerCase()) {
      // If selecting current plan, just ignore the selection and reset dropdown
      // This prevents the error message from showing
      event.target.value = userSubscription?.subscriptionPlan || 'Free';
      return;
    }
    
    // Navigate to the pay page with the selected plan as a URL parameter
    navigate(`/pay?plan=${newPlan.toLowerCase()}`);
  };

  const handleColorModeChange = (event) => {
    const value = event.target.value;
    setCurrentColorMode(value);
    
    if (value === 'light') {
      setLightMode();
    } else if (value === 'dark') {
      setDarkMode();
    } else if (value === 'system') {
      setSystemColorMode();
    }
  };

  // Use the local state for subscription details
  const currentPlan = userSubscription?.subscriptionPlan || 'Free';
  const subscriptionDetails = userSubscription?.subscriptionDetails;

  if (dataIsLoading) {
    return <Spinner />;
  }

  if (user) {
    return (
      <>
        <Header />
        <div className='planit-profile'>
          <div className='planit-profile-title'>
            Profile
          </div>
          <div className='planit-profile-welcome'>
            Welcome home {user.nickname}!
          </div>
          <div className="planit-profile-settings">
            <h2>Settings</h2>
            <ul>
              <li>
                <img src={HeaderLogo} alt="Profile" className="profile-picture" />
              </li>
              <li>
                <span>Profile Name:</span> 
                <span>{user.nickname}</span>
              </li>
              <li>
                <span>Color Mode:</span>
                <select value={currentColorMode} onChange={handleColorModeChange}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </li>
              <li>
                <span>Subscription Plan:</span>
                <select value={currentPlan} onChange={handleSubscriptionChange}>
                  <option value="Free">Free</option>
                  <option value="Flex">Flex</option>
                  <option value="Premium">Premium</option>
                </select>
                
                {subscriptionDetails && (
                  <div className="subscription-details">
                    <p>
                      {subscriptionDetails.productName} - Renews on {new Date(subscriptionDetails.currentPeriodEnd).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </li>
            </ul>
            <button className="planit-profile-settings-button" onClick={navigateToSettings}>All Settings</button>
          </div>
          <div className="planit-profile-auth">
            <button className="planit-profile-auth-button" onClick={onLogout}>Log out</button>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return null;
}

export default Profile;