import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import dataService from '../../features/data/dataService';
import { toast } from 'react-toastify';
import './Profile.css';
import HeaderLogo from '../../../src/assets/Checkmark512.png';

function Profile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [currentColorMode, setCurrentColorMode] = useState('system');

  const { user, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector((state) => state.data);

  useEffect(() => {
    // Detect current theme on component mount
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
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
    }

    if (dataIsError) {
      toast.error(dataMessage);
      console.log('Toast error message:', dataMessage);
    }

    if (dataIsSuccess && dataMessage) {
      toast.success(dataMessage);
      console.log('Toast success message:', dataMessage);
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [user, navigate, dispatch, dataIsError, dataIsSuccess, dataMessage]);

  if (dataIsLoading) {
    return <Spinner />;
  }

  const onLogout = () => {
    dispatch(logout());
    dispatch(resetDataSlice());
    navigate('/');
  };

  const navigateToSettings = () => {
    navigate('/settings');
  };

  const handleSubscriptionChange = async (event) => {
    const newPlan = event.target.value;
    const userId = user._id;

    try {
      const updatedData = await dataService.updateData({ id: userId, text: newPlan }, user.token);
      if (updatedData.redirectToPay) {
        navigate('/pay');
      } else {
        dispatch(resetDataSlice());
        toast.success('Subscription plan updated successfully!');
      }
    } catch (error) {
      console.error('Failed to update subscription plan:', error);
      const errorMessage = error.response?.data?.dataMessage || 'Failed to update subscription plan.';
      toast.error(errorMessage);
      console.log('Toast error message:', errorMessage);
      if(errorMessage === 'Not authorized, token expired') {
        onLogout();
      }
    }
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
                <select value={user.subscriptionPlan} onChange={handleSubscriptionChange}>
                  <option value="Free">Free</option>
                  <option value="Flex">Flex</option>
                  <option value="Premium">Premium</option>
                </select>
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