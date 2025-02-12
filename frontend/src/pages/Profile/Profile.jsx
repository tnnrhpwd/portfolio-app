import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import './Profile.css';

function Profile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { user, dataIsLoading } = useSelector((state) => state.data);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [user, navigate, dispatch]);

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

  const handleColorModeChange = (event) => {
    const value = event.target.value;
    if (value === 'light') {
      console.log('light');
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
              <li>Profile Picture: <img src={user.profilePicture} alt="Profile" className="profile-picture" /></li>
              <li>Profile Name: {user.nickname}</li>
              <li>Color Mode: 
                <select onChange={handleColorModeChange}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </li>
              <li>Subscription Plan:
                <select value={user.subscriptionPlan}>
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
}

export default Profile;