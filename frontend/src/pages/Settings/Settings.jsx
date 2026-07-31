import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import { toast } from 'react-toastify';
import {
  setDarkMode,
  setLightMode,
  setSystemColorMode,
  setFontSizeScale,
  loadFontSizeScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
} from '../../utils/theme.js';
import { getCloudSettings, saveCloudSettings } from '../../services/csimpleApi.js';
import AIWorkflowSettings from '../../components/CSimple/AIWorkflowSettings.jsx';
import './Settings.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';

const DEVICE_SETTINGS_KEY = 'csimple_device_settings';

function getAISettings() {
  try {
    const saved = localStorage.getItem(DEVICE_SETTINGS_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

function saveAISettings(updates) {
  try {
    const current = getAISettings();
    const merged = { ...current, ...updates };
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return updates;
  }
}

function Settings() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { user, dataIsLoading } = useSelector((state) => state.data);

  const [settings, setSettings] = useState({
    paymentMethod: '',
    email: '',
    phoneNumber: '',
    address: '',
    emailNotifications: false,
    smsNotifications: false,
    pushNotifications: false,
    theme: 'light',
    highContrast: false,
    textToSpeech: false,
    keyboardNavigation: true,
  });

  const [isResetPasswordLoading, setIsResetPasswordLoading] = useState(false);

  const [aiSettings, setAiSettings] = useState(() => {
    const stored = getAISettings();
    return {
      llmProvider: stored.llmProvider || 'portfolio',
      githubModel: stored.githubModel || 'gpt-4o-mini',
      portfolioModel: stored.portfolioModel || 'gpt-4o-mini',
      githubToken: stored.githubToken || '',
      defaultTemperature: stored.defaultTemperature ?? 0.7,
      defaultMaxTokens: stored.defaultMaxTokens ?? 500,
      maxConversationHistory: stored.maxConversationHistory ?? 20,
      sendWithEnter: stored.sendWithEnter ?? true,
      showTimestamps: stored.showTimestamps ?? true,
      enableMarkdown: stored.enableMarkdown ?? true,
      saveChatsLocally: stored.saveChatsLocally ?? true,
      cloudSync: stored.cloudSync ?? false,
      ttsEnabled: stored.ttsEnabled ?? true,
      sttEnabled: stored.sttEnabled ?? false,
    };
  });
  const [fontScale, setFontScale] = useState(() => loadFontSizeScale());

  const cloudSyncDebounce = useRef(null);
  const cloudPullDone = useRef(false);

  useEffect(() => {
    if (!user?.token || cloudPullDone.current) return;
    cloudPullDone.current = true;
    getCloudSettings(user.token)
      .then(cloudData => {
        const cloud = cloudData?.settings;
        if (!cloud) return;
        const pullKeys = [
          'llmProvider', 'githubModel', 'portfolioModel', 'githubToken',
          'defaultTemperature', 'defaultMaxTokens', 'maxConversationHistory',
          'sendWithEnter', 'showTimestamps', 'enableMarkdown',
          'saveChatsLocally', 'cloudSync', 'ttsEnabled', 'sttEnabled',
        ];
        setAiSettings(prev => {
          const merged = { ...prev };
          const updates = {};
          for (const key of pullKeys) {
            if (cloud[key] === undefined || cloud[key] === null || cloud[key] === '') continue;
            const localEmpty = prev[key] === '' || prev[key] === undefined || prev[key] === null;
            if (localEmpty) {
              merged[key] = cloud[key];
              updates[key] = cloud[key];
            }
          }
          if (Object.keys(updates).length > 0) {
            saveAISettings(updates);
          }
          return merged;
        });
      })
      .catch(err => console.warn('[Settings] cloud pull failed:', err));
  }, [user?.token]);

  const pushAISettingToCloud = useCallback((next) => {
    if (!user?.token) return;
    if (cloudSyncDebounce.current) clearTimeout(cloudSyncDebounce.current);
    cloudSyncDebounce.current = setTimeout(async () => {
      try {
        const cloudData = await getCloudSettings(user.token).catch(() => null);
        const existing = cloudData?.settings || {};
        await saveCloudSettings(user.token, { ...existing, ...next });
      } catch (err) {
        console.warn('[Settings] cloud push failed:', err);
      }
    }, 400);
  }, [user?.token]);

  const handleFontScaleChange = useCallback((e) => {
    const value = parseFloat(e.target.value);
    setFontScale(value);
    setFontSizeScale(value);
  }, []);

  const resetFontScale = useCallback(() => {
    setFontScale(FONT_SCALE_DEFAULT);
    setFontSizeScale(FONT_SCALE_DEFAULT);
  }, []);

  const updateAISetting = useCallback((key, value) => {
    setAiSettings(prev => {
      const updated = { ...prev, [key]: value };
      saveAISettings({ [key]: value });
      return updated;
    });
    pushAISettingToCloud({ [key]: value });
  }, [pushAISettingToCloud]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

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
    const nextValue = type === 'checkbox' ? checked : value;

    setSettings(prevSettings => ({
      ...prevSettings,
      [name]: nextValue,
    }));

    if (name === 'theme') {
      if (nextValue === 'light') {
        setLightMode();
      } else if (nextValue === 'dark') {
        setDarkMode();
      } else {
        setSystemColorMode();
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Settings submitted:', settings);
    toast.info('Settings persistence coming soon.', { autoClose: 2000 });
  };

  const handlePasswordReset = async () => {
    const userEmail = user?.email;

    if (!userEmail) {
      toast.error('Unable to send password reset email. No email address found.', { autoClose: 3000 });
      return;
    }

    const isConfirmed = window.confirm(
      `Are you sure you want to reset your password?\n\n` +
      `A password reset email will be sent to: ${userEmail}\n\n` +
      `You will need to click the link in the email to complete the password reset process.`
    );

    if (!isConfirmed) {
      return;
    }

    setIsResetPasswordLoading(true);
    try {
      const { getApiOrigin } = await import('../../config/api');
      const API_BASE_URL = getApiOrigin();

      const response = await fetch(`${API_BASE_URL}/api/data/forgot-password-authenticated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({}),
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

          <div className="planit-settings-shell">
            <section className="planit-settings-hero">
              <div className="planit-settings-hero-main">
                <div className="planit-settings-heading-copy">
                  <span className="planit-settings-eyebrow">Workspace preferences</span>
                  <h1 className="planit-settings-heading-title">Advanced Settings</h1>
                  <p className="planit-settings-heading-description">
                    Personalize how the app looks, feels, and connects to AI-powered workflows.
                  </p>
                </div>

                <div className="planit-settings-hero-actions">
                  <button
                    type="button"
                    className="planit-settings-profile-button"
                    onClick={() => navigate('/profile')}
                  >
                    👤 Back to Profile
                  </button>
                  <button
                    type="button"
                    className="planit-settings-net-button"
                    onClick={() => navigate('/net')}
                  >
                    🤖 Open AI Chat
                  </button>
                </div>
              </div>

              <div className="planit-settings-meta">
                <div className="planit-settings-meta-item">
                  <span className="planit-settings-meta-label">Theme</span>
                  <span className="planit-settings-meta-value">{settings.theme}</span>
                </div>
                <div className="planit-settings-meta-item">
                  <span className="planit-settings-meta-label">Font scale</span>
                  <span className="planit-settings-meta-value">{Math.round(fontScale * 100)}%</span>
                </div>
                <div className="planit-settings-meta-item">
                  <span className="planit-settings-meta-label">AI provider</span>
                  <span className="planit-settings-meta-value">{aiSettings.llmProvider}</span>
                </div>
              </div>
            </section>

            <form onSubmit={handleSubmit} className="planit-settings-form">
              <section className="planit-settings-content">
                <div className="planit-settings-layout">
                  <div className="planit-settings-main">
                    <div className="planit-settings-section">
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Account</span>
                          <h2 className="planit-settings-section-title">Account settings</h2>
                          <p className="planit-settings-section-description">
                            Update contact details, payment preferences, and security actions for your account.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-grid">
                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-payment-method">💳 Payment Method</label>
                          <select
                            id="planit-settings-payment-method"
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
                          <span className="planit-settings-hint">Choose the payment method you prefer for future billing.</span>
                        </div>

                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-email">📧 Email Address</label>
                          <input
                            id="planit-settings-email"
                            type="email"
                            name="email"
                            value={settings.email}
                            onChange={handleChange}
                            className="planit-settings-input"
                            placeholder="Enter email address"
                          />
                          <span className="planit-settings-hint">Used for receipts, alerts, and account recovery.</span>
                        </div>

                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-phone">📱 Phone Number</label>
                          <input
                            id="planit-settings-phone"
                            type="tel"
                            name="phoneNumber"
                            value={settings.phoneNumber}
                            onChange={handleChange}
                            className="planit-settings-input"
                            placeholder="Enter phone number"
                          />
                          <span className="planit-settings-hint">Optional, but helpful for multi-device communication features.</span>
                        </div>

                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-address">🏠 Address</label>
                          <input
                            id="planit-settings-address"
                            type="text"
                            name="address"
                            value={settings.address}
                            onChange={handleChange}
                            className="planit-settings-input"
                            placeholder="Enter address"
                          />
                          <span className="planit-settings-hint">Optional contact info for billing or support follow-up.</span>
                        </div>

                        <div className="planit-settings-item planit-settings-item-full">
                          <label className="planit-settings-label">🔐 Password</label>
                          <p className="planit-settings-hint">Send a secure reset link to your current account email when you need to update your password.</p>
                          <button
                            type="button"
                            onClick={handlePasswordReset}
                            disabled={isResetPasswordLoading}
                            className="planit-settings-password-reset-button"
                          >
                            {isResetPasswordLoading ? '📤 Sending reset email...' : '🔐 Send Password Reset Email'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="planit-settings-section">
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Alerts</span>
                          <h2 className="planit-settings-section-title">Notification settings</h2>
                          <p className="planit-settings-section-description">
                            Decide how you want to hear about account changes and activity.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-checkbox-grid">
                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">📧 Email Notifications</span>
                            <span className="planit-settings-toggle-description">Receive updates and reminders in your inbox.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="emailNotifications"
                            checked={settings.emailNotifications}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">📱 SMS Notifications</span>
                            <span className="planit-settings-toggle-description">Use text messages for time-sensitive alerts.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="smsNotifications"
                            checked={settings.smsNotifications}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">🔔 Push Notifications</span>
                            <span className="planit-settings-toggle-description">Enable device alerts when supported.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="pushNotifications"
                            checked={settings.pushNotifications}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="planit-settings-section">
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Appearance</span>
                          <h2 className="planit-settings-section-title">Appearance settings</h2>
                          <p className="planit-settings-section-description">
                            Match the app to your environment with live theme and readable typography controls.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-grid">
                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-theme">🌓 Theme</label>
                          <select
                            id="planit-settings-theme"
                            name="theme"
                            value={settings.theme}
                            onChange={handleChange}
                            className="planit-settings-input"
                          >
                            <option value="light">☀️ Light</option>
                            <option value="dark">🌙 Dark</option>
                            <option value="system">💻 System</option>
                          </select>
                          <span className="planit-settings-hint">Changes preview immediately so you can compare modes.</span>
                        </div>

                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-font-size">🔤 Font Size</label>
                          <div className="planit-settings-range-group">
                            <input
                              id="planit-settings-font-size"
                              type="range"
                              min={FONT_SCALE_MIN}
                              max={FONT_SCALE_MAX}
                              step="0.05"
                              value={fontScale}
                              onChange={handleFontScaleChange}
                              className="planit-settings-range"
                              aria-label="Font size scale"
                            />
                            <span className="planit-settings-range-value">{Math.round(fontScale * 100)}%</span>
                          </div>
                          <div className="planit-settings-font-preview">
                            <span className="planit-settings-font-preview-text">The quick brown fox jumps over the lazy dog</span>
                            {fontScale !== FONT_SCALE_DEFAULT && (
                              <button
                                type="button"
                                className="planit-settings-font-reset"
                                onClick={resetFontScale}
                              >
                                Reset to default
                              </button>
                            )}
                          </div>
                          <span className="planit-settings-hint">
                            Adjusts text size across the entire app ({Math.round(FONT_SCALE_MIN * 100)}%–{Math.round(FONT_SCALE_MAX * 100)}%).
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="planit-settings-section">
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">AI workflow</span>
                          <h2 className="planit-settings-section-title">AI &amp; CSimple addon</h2>
                          <p className="planit-settings-section-description">
                            Choose your provider, tune chat defaults, and manage GitHub Models access.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-ai-info">
                        <p className="planit-settings-ai-description">
                          Access AI chat powered by GitHub Models at <strong>/net</strong>. For local AI and desktop automation, install the <strong>CSimple addon</strong>.
                        </p>

                        <AIWorkflowSettings
                          settings={aiSettings}
                          onChange={updateAISetting}
                          user={user}
                        />

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
                          AI preferences sync with the /net chat sidebar automatically.
                        </p>
                        <p className="planit-settings-ai-note">
                          Need agents, personas, behaviors, memory, goals, or shortcuts? Install the <strong>CSimple addon</strong> and open <strong>Advanced Settings</strong> inside the <strong>/net</strong> chat for those power-user tools.
                        </p>
                      </div>
                    </div>

                    <div className="planit-settings-section">
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Accessibility</span>
                          <h2 className="planit-settings-section-title">Accessibility settings</h2>
                          <p className="planit-settings-section-description">
                            Keep the interface comfortable with readability and navigation helpers.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-checkbox-grid">
                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">🌓 High Contrast</span>
                            <span className="planit-settings-toggle-description">Boost separation between content, borders, and controls.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="highContrast"
                            checked={settings.highContrast}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">🔊 Text-to-Speech</span>
                            <span className="planit-settings-toggle-description">Prepare spoken assistance for supported experiences.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="textToSpeech"
                            checked={settings.textToSpeech}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">⌨️ Keyboard Navigation</span>
                            <span className="planit-settings-toggle-description">Make focus cues and keyboard-friendly navigation easier to follow.</span>
                          </div>
                          <input
                            type="checkbox"
                            name="keyboardNavigation"
                            checked={settings.keyboardNavigation}
                            onChange={handleChange}
                            className="planit-settings-checkbox"
                          />
                        </label>
                      </div>
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
                  👤 Back to Profile
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

  return null;
}

export default Settings;
