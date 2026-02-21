import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import { toast } from 'react-toastify';
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
    emailNotifications: false,
    smsNotifications: false,
    pushNotifications: false,

    // Appearance Settings
    theme: 'light',

    // Accessibility Settings
    highContrast: false,
    textToSpeech: false,
    keyboardNavigation: true,
  });

  const [isResetPasswordLoading, setIsResetPasswordLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // Initialize settings from user data
    setSettings({
      paymentMethod: user.paymentMethod || '',
      email: user.email || '',
      phoneNumber: user.phoneNumber || '',
      address: user.address || '',
      emailNotifications: user.emailNotifications || false,
      smsNotifications: user.smsNotifications || false,
      pushNotifications: user.pushNotifications || false,
      theme: user.theme || 'light',
      highContrast: user.highContrast || false,
      textToSpeech: user.textToSpeech || false,
      keyboardNavigation: user.keyboardNavigation || false,
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
    // TODO: Dispatch action to update settings when backend supports it
    console.log('Settings submitted:', settings);
    toast.info('Settings persistence coming soon.', { autoClose: 2000 });
  };

  const handlePasswordReset = async () => {
    // Extract email from user object
    const userEmail = user?.email;
    
    if (!userEmail) {
      toast.error('Unable to send password reset email. No email address found.', { autoClose: 3000 });
      return;
    }

    // Show confirmation dialog
    const isConfirmed = window.confirm(
      `Are you sure you want to reset your password?\n\n` +
      `A password reset email will be sent to: ${userEmail}\n\n` +
      `You will need to click the link in the email to complete the password reset process.`
    );

    if (!isConfirmed) {
      return; // User cancelled
    }

    setIsResetPasswordLoading(true);
    try {
      const API_BASE_URL = process.env.NODE_ENV === 'production' 
        ? 'https://www.sthopwood.com' 
        : 'http://localhost:5000';
      
      const response = await fetch(`${API_BASE_URL}/api/data/forgot-password-authenticated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`, // Include auth token for authenticated request
        },
        body: JSON.stringify({}), // Empty body since email comes from auth
      });

      if (response.ok) {
        toast.success(`Password reset email sent to ${userEmail}`, { autoClose: 5000 });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send password reset email');
      }
    } catch (error) {
      console.error('Password reset error:', error);
      toast.error('Failed to send password reset email. Please try again.', { autoClose: 3000 });
    } finally {
      setIsResetPasswordLoading(false);
    }
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

                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🔐 Password</label>
                      <button
                        type="button"
                        onClick={handlePasswordReset}
                        disabled={isResetPasswordLoading}
                        className="planit-settings-password-reset-button"
                      >
                        {isResetPasswordLoading ? '📤 Sending...' : '🔐 Reset Password'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Notification Settings */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🔔 Notification Settings</h3>
                  <div className="planit-settings-grid">
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
                  </div>
                </div>

                {/* AI & CSimple Addon */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🤖 AI & CSimple Addon</h3>
                  <div className="planit-settings-ai-info">
                    <p className="planit-settings-ai-description">
                      Access AI chat powered by GitHub Models at <strong>/net</strong>. 
                      For local AI and desktop automation, install the <strong>CSimple addon</strong>.
                    </p>
                    <div className="planit-settings-ai-actions">
                      <button 
                        type="button" 
                        className="planit-settings-ai-button"
                        onClick={() => navigate('/net')}
                      >
                        🤖 Open AI Chat
                      </button>
                      <a 
                        href="https://github.com/tnnrhpwd/portfolio-app/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="planit-settings-ai-link"
                      >
                        📥 Get CSimple Addon
                      </a>
                    </div>
                    <p className="planit-settings-ai-note">
                      GitHub token and model settings are configured in the /net sidebar when the addon is connected.
                    </p>
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

                
              </section>
              
              <section className="planit-settings-actions">
                <button type="submit" className="planit-settings-save-button">
                  💾 Update Settings
                </button>
                <button 
                  type="button" 
                  className="planit-settings-net-button" 
                  onClick={() => navigate('/net')}
                >
                  🤖 Open AI Chat
                </button>
                <button 
                  type="button" 
                  className="planit-settings-profile-button" 
                  onClick={() => navigate('/profile')}
                >
                  👤 View Profile
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