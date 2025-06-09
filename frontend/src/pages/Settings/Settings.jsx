import { useEffect, useState } from 'react';
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

  const [settings, setSettings] = useState({
    // Account Settings
    paymentMethod: '',
    email: '',
    phoneNumber: '',
    address: '',

    // Notification Settings
    notificationPreferences: '',
    emailNotifications: true,
    smsNotifications: false,
    pushNotifications: true,

    // Appearance Settings
    theme: 'light',
    fontSize: 'medium',
    fontFamily: 'Arial',
    backgroundColor: '',
    textColor: '',
    backgroundAccentColor: '', // New setting

    // Privacy Settings
    profileVisibility: 'public',
    dataSharing: true,
    locationTracking: false,

    // Accessibility Settings
    highContrast: false,
    textToSpeech: false,
    keyboardNavigation: true,

    // Advanced Settings
    apiEndpoint: '',
    dataBackupFrequency: 'weekly',

    // Regional Settings
    timeZone: '', // New setting
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // Initialize settings from user data (replace with actual user data retrieval)
    setSettings({
      paymentMethod: user.paymentMethod || '',
      email: user.email || '',
      phoneNumber: user.phoneNumber || '',
      address: user.address || '',
      notificationPreferences: user.notificationPreferences || '',
      theme: user.theme || 'light',
			fontSize: user.fontSize || 'medium',
			fontFamily: user.fontFamily || 'Arial',
			backgroundColor: user.backgroundColor || '',
			textColor: user.textColor || '',
			backgroundAccentColor: user.backgroundAccentColor || '', // Initialize
			profileVisibility: user.profileVisibility || 'public',
			dataSharing: user.dataSharing || true,
			locationTracking: user.locationTracking || false,
			highContrast: user.highContrast || false,
			textToSpeech: user.textToSpeech || false,
			keyboardNavigation: user.keyboardNavigation || false,
			apiEndpoint: user.apiEndpoint || '',
			dataBackupFrequency: user.dataBackupFrequency || 'weekly',
      timeZone: user.timeZone || '', // Initialize
    });

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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prevSettings => ({
        ...prevSettings,
        [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Dispatch action to update settings (not implemented yet)
    console.log('Settings submitted:', settings);
    // dispatch(updateSettings(settings));
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
            <form onSubmit={handleSubmit}>
              <table>
                <tbody>
                  <tr>
                    <td>Payment Method:</td>
                    <td>
                      <select
                        name="paymentMethod"
                        value={settings.paymentMethod}
                        onChange={handleChange}
                      >
                        <option value="">Select Payment Method</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="paypal">PayPal</option>
                        <option value="stripe">Stripe</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Email:</td>
                    <td>
                      <input
                        type="email"
                        name="email"
                        value={settings.email}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Phone Number:</td>
                    <td>
                      <input
                        type="tel"
                        name="phoneNumber"
                        value={settings.phoneNumber}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Address:</td>
                    <td>
                      <input
                        type="text"
                        name="address"
                        value={settings.address}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Notification Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>Notification Preferences:</td>
                    <td>
                      <select
                        name="notificationPreferences"
                        value={settings.notificationPreferences}
                        onChange={handleChange}
                      >
                        <option value="">Select Preference</option>
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                        <option value="push">Push Notification</option>
                        <option value="none">None</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Email Notifications:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="emailNotifications"
                        checked={settings.emailNotifications}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>SMS Notifications:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="smsNotifications"
                        checked={settings.smsNotifications}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Push Notifications:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="pushNotifications"
                        checked={settings.pushNotifications}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Appearance Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>Theme:</td>
                    <td>
                      <select
                        name="theme"
                        value={settings.theme}
                        onChange={handleChange}
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Font Size:</td>
                    <td>
                      <select
                        name="fontSize"
                        value={settings.fontSize}
                        onChange={handleChange}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Language:</td>
                    <td>
                      <select
                        name="language"
                        value={settings.language}
                        onChange={handleChange}
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Font Family:</td>
                    <td>
                      <select
                        name="fontFamily"
                        value={settings.fontFamily}
                        onChange={handleChange}
                      >
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Helvetica">Helvetica</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Background Color:</td>
                    <td>
                      <input
                        type="color"
                        name="backgroundColor"
                        value={settings.backgroundColor}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Text Color:</td>
                    <td>
                      <input
                        type="color"
                        name="textColor"
                        value={settings.textColor}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Background Accent Color:</td>
                    <td>
                      <input
                        type="color"
                        name="backgroundAccentColor"
                        value={settings.backgroundAccentColor}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Privacy Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>Profile Visibility:</td>
                    <td>
                      <select
                        name="profileVisibility"
                        value={settings.profileVisibility}
                        onChange={handleChange}
                      >
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                        <option value="friends">Friends Only</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>Data Sharing:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="dataSharing"
                        checked={settings.dataSharing}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Location Tracking:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="locationTracking"
                        checked={settings.locationTracking}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Accessibility Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>High Contrast:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="highContrast"
                        checked={settings.highContrast}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Text-to-Speech:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="textToSpeech"
                        checked={settings.textToSpeech}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Keyboard Navigation:</td>
                    <td>
                      <input
                        type="checkbox"
                        name="keyboardNavigation"
                        checked={settings.keyboardNavigation}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Advanced Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>API Endpoint:</td>
                    <td>
                      <input
                        type="text"
                        name="apiEndpoint"
                        value={settings.apiEndpoint}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Data Backup Frequency:</td>
                    <td>
                      <select
                        name="dataBackupFrequency"
                        value={settings.dataBackupFrequency}
                        onChange={handleChange}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2>Regional Settings</h2>
              <table>
                <tbody>
                  <tr>
                    <td>Time Zone:</td>
                    <td>
                      <select
                        name="timeZone"
                        value={settings.timeZone}
                        onChange={handleChange}
                      >
                        <option value="">Select Time Zone</option>
                        <option value="America/Los_Angeles">Pacific Time</option>
                        <option value="America/New_York">Eastern Time</option>
                        <option value="UTC">UTC</option>
                        {/* Add more time zones as needed */}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>

              <button className="planit-settings-auth-button" type="submit">Update Settings</button>
            </form>
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