import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import './Settings.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';

function Settings() {
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

  if (user) {
    return (
      <>
        <Header />
        <div className='planit-settings'>
          <div className='planit-settings-title'>
            Settings
          </div>
          <div className='planit-settings-table'>
            <h2>Account Settings</h2>
            <table>
              <tbody>
                <tr>
                  <td>Payment Method:</td>
                  <td>{user.paymentMethod}</td>
                </tr>
                <tr>
                  <td>Email:</td>
                  <td>{user.email}</td>
                </tr>
                <tr>
                  <td>Phone Number:</td>
                  <td>{user.phoneNumber}</td>
                </tr>
                <tr>
                  <td>Address:</td>
                  <td>{user.address}</td>
                </tr>
                <tr>
                  <td>Notification Preferences:</td>
                  <td>{user.notificationPreferences}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="planit-settings-auth">
            <button className="planit-settings-auth-button" onClick={onLogout}>Log out</button>
          </div>
        </div>
        <Footer />
      </>
    );
  }
}

export default Settings;