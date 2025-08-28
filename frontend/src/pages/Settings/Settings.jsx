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
    emailNotifications: false,
    smsNotifications: false,
    pushNotifications: false,

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
      emailNotifications: user.emailNotifications || false,
      smsNotifications: user.smsNotifications || false,
      pushNotifications: user.pushNotifications || false,
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
        <div className="planit-settings-bg">
          <div className="floating-shapes">
            <div className="floating-circle floating-circle-1"></div>
            <div className="floating-circle floating-circle-2"></div>
            <div className="floating-circle floating-circle-3"></div>
          </div>
          <div className="planit-settings-card">
            <section className="planit-settings-heading">
              <div className="planit-settings-heading-title">⚙️ Advanced Settings</div>
              <div className="planit-settings-heading-description">Configure your account preferences and system settings</div>
            </section>
            
            <form onSubmit={handleSubmit}>
              <section className="planit-settings-content">
                
                {/* Account Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">💼 Account Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">💳 Payment Method</label>
                      <select
                        name="paymentMethod"
                        value={settings.paymentMethod}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="">Select Payment Method</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="paypal">PayPal</option>
                        <option value="stripe">Stripe</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">📧 Email Address</label>
                      <input
                        type="email"
                        name="email"
                        value={settings.email}
                        onChange={handleChange}
                        className="planit-settings-input"
                        placeholder="Enter email address"
                      />
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">📱 Phone Number</label>
                      <input
                        type="tel"
                        name="phoneNumber"
                        value={settings.phoneNumber}
                        onChange={handleChange}
                        className="planit-settings-input"
                        placeholder="Enter phone number"
                      />
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🏠 Address</label>
                      <input
                        type="text"
                        name="address"
                        value={settings.address}
                        onChange={handleChange}
                        className="planit-settings-input"
                        placeholder="Enter address"
                      />
                    </div>
                  </div>
                </div>

                {/* Notification Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🔔 Notification Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">📬 Notification Preferences</label>
                      <select
                        name="notificationPreferences"
                        value={settings.notificationPreferences}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="">Select Preference</option>
                        <option value="email">📧 Email</option>
                        <option value="sms">📱 SMS</option>
                        <option value="push">🔔 Push Notification</option>
                        <option value="none">🔕 None</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="emailNotifications"
                          checked={settings.emailNotifications}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>📧 Email Notifications</span>
                      </label>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="smsNotifications"
                          checked={settings.smsNotifications}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>📱 SMS Notifications</span>
                      </label>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="pushNotifications"
                          checked={settings.pushNotifications}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>🔔 Push Notifications</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Appearance Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🎨 Appearance Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🌓 Theme</label>
                      <select
                        name="theme"
                        value={settings.theme}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="light">☀️ Light</option>
                        <option value="dark">🌙 Dark</option>
                        <option value="system">💻 System</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">📏 Font Size</label>
                      <select
                        name="fontSize"
                        value={settings.fontSize}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🔤 Font Family</label>
                      <select
                        name="fontFamily"
                        value={settings.fontFamily}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Helvetica">Helvetica</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🎨 Background Color</label>
                      <input
                        type="color"
                        name="backgroundColor"
                        value={settings.backgroundColor}
                        onChange={handleChange}
                        className="planit-settings-color-input"
                      />
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">✏️ Text Color</label>
                      <input
                        type="color"
                        name="textColor"
                        value={settings.textColor}
                        onChange={handleChange}
                        className="planit-settings-color-input"
                      />
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🌈 Accent Color</label>
                      <input
                        type="color"
                        name="backgroundAccentColor"
                        value={settings.backgroundAccentColor}
                        onChange={handleChange}
                        className="planit-settings-color-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Privacy Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🔒 Privacy Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">👁️ Profile Visibility</label>
                      <select
                        name="profileVisibility"
                        value={settings.profileVisibility}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="public">🌐 Public</option>
                        <option value="private">🔒 Private</option>
                        <option value="friends">👥 Friends Only</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="dataSharing"
                          checked={settings.dataSharing}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>📊 Data Sharing</span>
                      </label>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="locationTracking"
                          checked={settings.locationTracking}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>📍 Location Tracking</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Accessibility Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">♿ Accessibility Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="highContrast"
                          checked={settings.highContrast}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>🌓 High Contrast</span>
                      </label>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="textToSpeech"
                          checked={settings.textToSpeech}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>🔊 Text-to-Speech</span>
                      </label>
                    </div>
                    
                    <div className="planit-settings-item planit-settings-checkbox-item">
                      <label className="planit-settings-checkbox-label">
                        <input
                          type="checkbox"
                          name="keyboardNavigation"
                          checked={settings.keyboardNavigation}
                          onChange={handleChange}
                          className="planit-settings-checkbox"
                        />
                        <span>⌨️ Keyboard Navigation</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Advanced Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🔧 Advanced Settings</h3>
                  <div className="planit-settings-grid">
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🔗 API Endpoint</label>
                      <input
                        type="text"
                        name="apiEndpoint"
                        value={settings.apiEndpoint}
                        onChange={handleChange}
                        className="planit-settings-input"
                        placeholder="Enter API endpoint"
                      />
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">💾 Data Backup Frequency</label>
                      <select
                        name="dataBackupFrequency"
                        value={settings.dataBackupFrequency}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="daily">📅 Daily</option>
                        <option value="weekly">📆 Weekly</option>
                        <option value="monthly">🗓️ Monthly</option>
                      </select>
                    </div>
                    
                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🌍 Time Zone</label>
                      <select
                        name="timeZone"
                        value={settings.timeZone}
                        onChange={handleChange}
                        className="planit-settings-input"
                      >
                        <option value="">Select Time Zone</option>
                        <option value="America/Los_Angeles">🌊 Pacific Time</option>
                        <option value="America/New_York">🗽 Eastern Time</option>
                        <option value="UTC">🌐 UTC</option>
                      </select>
                    </div>
                  </div>
                </div>
                
              </section>
              
              <section className="planit-settings-actions">
                <button type="submit" className="planit-settings-save-button">
                  💾 Update Settings
                </button>
                <button type="button" className="planit-settings-logout-button" onClick={onLogout}>
                  🚪 Sign Out
                </button>
              </section>
            </form>
          </div>
        </div>
        <Footer />
      </>
    );
  }
}

export default Settings;