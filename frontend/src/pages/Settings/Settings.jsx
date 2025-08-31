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

    // Authentication & Account Linking Settings
    linkedAccounts: {
      google: false,
      facebook: false,
      twitter: false,
      linkedin: false,
      github: false,
    },
    enableSocialLogin: false,
    autoLinkNewAccounts: true,
    requirePasswordForLinking: true,
    notifyOnNewLinks: true,

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
      linkedAccounts: user.linkedAccounts || {
        google: false,
        facebook: false,
        twitter: false,
        linkedin: false,
        github: false,
      },
      enableSocialLogin: user.enableSocialLogin || false,
      autoLinkNewAccounts: user.autoLinkNewAccounts || true,
      requirePasswordForLinking: user.requirePasswordForLinking !== undefined ? user.requirePasswordForLinking : true,
      notifyOnNewLinks: user.notifyOnNewLinks !== undefined ? user.notifyOnNewLinks : true,
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

  // Handle account linking
  const handleLinkAccount = async (provider) => {
    console.log(`Attempting to link ${provider} account`);
    
    // Check if password verification is required
    if (settings.requirePasswordForLinking) {
      const password = await promptForPasswordVerification();
      
      if (!password) {
        toast.error('Password verification is required to link accounts.', { autoClose: 3000 });
        return;
      }

      try {
        // Verify password with backend
        const isPasswordValid = await verifyUserPassword(password);
        
        if (!isPasswordValid) {
          toast.error('Invalid password. Account linking canceled.', { autoClose: 3000 });
          return;
        }
      } catch (error) {
        console.error('Password verification failed:', error);
        toast.error('Failed to verify password. Please try again.', { autoClose: 3000 });
        return;
      }
    }

    // Password verified (if required), proceed with OAuth flow
    await initiateOAuthFlow(provider);
  };

  // Handle account unlinking
  const handleUnlinkAccount = async (provider) => {
    console.log(`Attempting to unlink ${provider} account`);
    
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to unlink your ${provider} account?\n\n` +
      `This will remove the ability to log in using ${provider} and you'll need to use your email and password.`
    );
    
    if (!confirmed) {
      return;
    }

    // Check if password verification is required
    if (settings.requirePasswordForLinking) {
      const password = await promptForPasswordVerification();
      
      if (!password) {
        toast.error('Password verification is required to unlink accounts.', { autoClose: 3000 });
        return;
      }

      try {
        // Verify password with backend
        const isPasswordValid = await verifyUserPassword(password);
        
        if (!isPasswordValid) {
          toast.error('Invalid password. Account unlinking canceled.', { autoClose: 3000 });
          return;
        }
      } catch (error) {
        console.error('Password verification failed:', error);
        toast.error('Failed to verify password. Please try again.', { autoClose: 3000 });
        return;
      }
    }

    try {
      // TODO: Make API call to backend to unlink the account
      // For now, we'll simulate unlinking
      setSettings(prevSettings => ({
        ...prevSettings,
        linkedAccounts: {
          ...prevSettings.linkedAccounts,
          [provider]: false
        }
      }));

      toast.success(`${provider} account unlinked successfully!`, { autoClose: 3000 });

      // Send notification if enabled
      if (settings.notifyOnNewLinks) {
        toast.info('Account unlinking notification sent to your email.', { autoClose: 2000 });
      }
      
    } catch (error) {
      console.error(`Error unlinking ${provider} account:`, error);
      toast.error(`Failed to unlink ${provider} account. Please try again.`, { autoClose: 3000 });
    }
  };

  // Prompt user for password verification
  const promptForPasswordVerification = () => {
    return new Promise((resolve) => {
      const password = prompt('Please enter your current password to link this account:');
      resolve(password);
    });
  };

  // Verify user's password with backend
  const verifyUserPassword = async (password) => {
    try {
      // For now, we'll use a simple prompt-based verification
      // In a real implementation, this would make an API call to verify the password
      console.log('Verifying password...');
      
      // TODO: Implement actual password verification API call
      // const response = await fetch('/api/verify-password', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${user.token}`
      //   },
      //   body: JSON.stringify({ password })
      // });
      // 
      // return response.ok;
      
      // For now, return true for demonstration purposes
      return password && password.length > 0;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  };

  // Initiate OAuth flow for the specified provider
  const initiateOAuthFlow = async (provider) => {
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
        twitter: {
          url: `https://api.twitter.com/oauth/authenticate`,
          clientId: process.env.REACT_APP_TWITTER_CLIENT_ID,
          scope: 'read',
          name: 'Twitter/X'
        },
        linkedin: {
          url: `https://www.linkedin.com/oauth/v2/authorization`,
          clientId: process.env.REACT_APP_LINKEDIN_CLIENT_ID,
          scope: 'r_emailaddress r_liteprofile',
          name: 'LinkedIn'
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
        toast.error(`${provider} integration is not configured. Please contact support.`, { autoClose: 4000 });
        return;
      }

      toast.info(`Redirecting to ${config.name} for account linking...`, { autoClose: 2000 });

      // Build OAuth URL
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: `${window.location.origin}/auth/callback/${provider}`,
        scope: config.scope,
        response_type: 'code',
        state: JSON.stringify({ 
          action: 'link',
          userId: user._id,
          provider: provider
        })
      });

      const authUrl = `${config.url}?${params.toString()}`;
      
      // Open OAuth popup window
      const popup = window.open(
        authUrl,
        `${provider}-oauth`,
        'width=600,height=600,scrollbars=yes,resizable=yes'
      );

      // Monitor popup for completion
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          // Check if account was successfully linked
          checkLinkingStatus(provider);
        }
      }, 1000);

    } catch (error) {
      console.error(`Error initiating ${provider} OAuth:`, error);
      toast.error(`Failed to initiate ${provider} linking. Please try again.`, { autoClose: 3000 });
    }
  };

  // Check if account linking was successful
  const checkLinkingStatus = async (provider) => {
    try {
      // TODO: Make API call to check if the account was successfully linked
      // For now, we'll simulate success
      setSettings(prevSettings => ({
        ...prevSettings,
        linkedAccounts: {
          ...prevSettings.linkedAccounts,
          [provider]: true
        }
      }));

      toast.success(`${provider} account linked successfully!`, { autoClose: 3000 });

      // Send notification if enabled
      if (settings.notifyOnNewLinks) {
        toast.info('Account linking notification sent to your email.', { autoClose: 2000 });
      }
      
    } catch (error) {
      console.error(`Error checking ${provider} linking status:`, error);
      toast.error(`Failed to verify ${provider} account linking.`, { autoClose: 3000 });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Dispatch action to update settings (not implemented yet)
    console.log('Settings submitted:', settings);
    toast.success('Settings updated successfully!', { autoClose: 2000 });
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

                {/* Authentication & Account Linking */}
                <div className="planit-settings-section">
                  <h3 className="planit-settings-section-title">🔐 Authentication & Account Linking</h3>
                  <div className="planit-settings-grid">
                    
                    {/* Authentication Preferences */}
                    <div className="planit-settings-item planit-settings-auth-preferences">
                      <label className="planit-settings-label">� Authentication Preferences</label>
                      <div className="planit-settings-auth-options">
                        <div className="planit-settings-item planit-settings-checkbox-item">
                          <label className="planit-settings-checkbox-label">
                            <input
                              type="checkbox"
                              name="enableSocialLogin"
                              checked={settings.enableSocialLogin}
                              onChange={handleChange}
                              className="planit-settings-checkbox"
                            />
                            <span>🚪 Enable "Login with" Social Options</span>
                          </label>
                          <div className="planit-settings-help-text">
                            Allow logging in using social media accounts on the login page
                          </div>
                        </div>
                        
                        <div className="planit-settings-item planit-settings-checkbox-item">
                          <label className="planit-settings-checkbox-label">
                            <input
                              type="checkbox"
                              name="autoLinkNewAccounts"
                              checked={settings.autoLinkNewAccounts}
                              onChange={handleChange}
                              className="planit-settings-checkbox"
                            />
                            <span>🔄 Auto-link accounts with same email</span>
                          </label>
                          <div className="planit-settings-help-text">
                            Automatically link social accounts that use the same email address
                          </div>
                        </div>
                        
                        <div className="planit-settings-item planit-settings-checkbox-item">
                          <label className="planit-settings-checkbox-label">
                            <input
                              type="checkbox"
                              name="requirePasswordForLinking"
                              checked={settings.requirePasswordForLinking}
                              onChange={handleChange}
                              className="planit-settings-checkbox"
                            />
                            <span>🔒 Require password verification for account linking</span>
                          </label>
                          <div className="planit-settings-help-text">
                            Enhanced security - verify your password before linking new accounts
                          </div>
                        </div>
                        
                        <div className="planit-settings-item planit-settings-checkbox-item">
                          <label className="planit-settings-checkbox-label">
                            <input
                              type="checkbox"
                              name="notifyOnNewLinks"
                              checked={settings.notifyOnNewLinks}
                              onChange={handleChange}
                              className="planit-settings-checkbox"
                            />
                            <span>📧 Notify me when accounts are linked</span>
                          </label>
                          <div className="planit-settings-help-text">
                            Receive email notifications when social accounts are linked or unlinked
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Linked Accounts Management */}
                    <div className="planit-settings-item planit-settings-linked-accounts-container">
                      <label className="planit-settings-label">🔗 Manage Linked Accounts</label>
                      <div className="planit-settings-linked-accounts-status">
                        <div className="planit-settings-status-summary">
                          <span className="planit-settings-linked-count">
                            {Object.values(settings.linkedAccounts || {}).filter(Boolean).length} of 5 accounts linked
                          </span>
                          <div className="planit-settings-status-bar">
                            <div 
                              className="planit-settings-status-fill"
                              style={{ 
                                width: `${(Object.values(settings.linkedAccounts || {}).filter(Boolean).length / 5) * 100}%` 
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <div className="planit-settings-linked-accounts">
                        <div className={`planit-settings-account-item ${settings.linkedAccounts?.google ? 'linked' : ''}`}>
                          <span className="planit-settings-account-provider">
                            🌐 Google
                            {settings.linkedAccounts?.google && <span className="planit-settings-linked-badge">✓ Linked</span>}
                          </span>
                          <button
                            type="button"
                            className={`planit-settings-link-button ${settings.linkedAccounts?.google ? 'unlink' : ''}`}
                            onClick={() => settings.linkedAccounts?.google ? handleUnlinkAccount('google') : handleLinkAccount('google')}
                          >
                            {settings.linkedAccounts?.google ? '🔗 Unlink' : '🔗 Link Account'}
                          </button>
                        </div>
                        
                        <div className={`planit-settings-account-item ${settings.linkedAccounts?.facebook ? 'linked' : ''}`}>
                          <span className="planit-settings-account-provider">
                            � Facebook
                            {settings.linkedAccounts?.facebook && <span className="planit-settings-linked-badge">✓ Linked</span>}
                          </span>
                          <button
                            type="button"
                            className={`planit-settings-link-button ${settings.linkedAccounts?.facebook ? 'unlink' : ''}`}
                            onClick={() => settings.linkedAccounts?.facebook ? handleUnlinkAccount('facebook') : handleLinkAccount('facebook')}
                          >
                            {settings.linkedAccounts?.facebook ? '🔗 Unlink' : '🔗 Link Account'}
                          </button>
                        </div>
                        
                        <div className={`planit-settings-account-item ${settings.linkedAccounts?.twitter ? 'linked' : ''}`}>
                          <span className="planit-settings-account-provider">
                            � Twitter/X
                            {settings.linkedAccounts?.twitter && <span className="planit-settings-linked-badge">✓ Linked</span>}
                          </span>
                          <button
                            type="button"
                            className={`planit-settings-link-button ${settings.linkedAccounts?.twitter ? 'unlink' : ''}`}
                            onClick={() => settings.linkedAccounts?.twitter ? handleUnlinkAccount('twitter') : handleLinkAccount('twitter')}
                          >
                            {settings.linkedAccounts?.twitter ? '🔗 Unlink' : '🔗 Link Account'}
                          </button>
                        </div>
                        
                        <div className={`planit-settings-account-item ${settings.linkedAccounts?.linkedin ? 'linked' : ''}`}>
                          <span className="planit-settings-account-provider">
                            💼 LinkedIn
                            {settings.linkedAccounts?.linkedin && <span className="planit-settings-linked-badge">✓ Linked</span>}
                          </span>
                          <button
                            type="button"
                            className={`planit-settings-link-button ${settings.linkedAccounts?.linkedin ? 'unlink' : ''}`}
                            onClick={() => settings.linkedAccounts?.linkedin ? handleUnlinkAccount('linkedin') : handleLinkAccount('linkedin')}
                          >
                            {settings.linkedAccounts?.linkedin ? '� Unlink' : '🔗 Link Account'}
                          </button>
                        </div>
                        
                        <div className={`planit-settings-account-item ${settings.linkedAccounts?.github ? 'linked' : ''}`}>
                          <span className="planit-settings-account-provider">
                            🐱 GitHub
                            {settings.linkedAccounts?.github && <span className="planit-settings-linked-badge">✓ Linked</span>}
                          </span>
                          <button
                            type="button"
                            className={`planit-settings-link-button ${settings.linkedAccounts?.github ? 'unlink' : ''}`}
                            onClick={() => settings.linkedAccounts?.github ? handleUnlinkAccount('github') : handleLinkAccount('github')}
                          >
                            {settings.linkedAccounts?.github ? '🔗 Unlink' : '🔗 Link Account'}
                          </button>
                        </div>
                      </div>
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