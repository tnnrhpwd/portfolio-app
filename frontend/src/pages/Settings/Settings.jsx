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
import './Settings.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';

const DEVICE_SETTINGS_KEY = 'csimple_device_settings';

const GITHUB_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
];

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
  const [showToken, setShowToken] = useState(false);
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

                        <div className="planit-settings-grid">
                          <div className="planit-settings-item">
                            <label className="planit-settings-label" htmlFor="planit-settings-llm-provider">☁️ LLM Provider</label>
                            <select
                              id="planit-settings-llm-provider"
                              value={aiSettings.llmProvider}
                              onChange={e => updateAISetting('llmProvider', e.target.value)}
                              className="planit-settings-input"
                            >
                              <option value="portfolio">☁️ Cloud (Portfolio)</option>
                              <option value="github">🐙 GitHub Models</option>
                              <option value="local">💻 Local (HuggingFace)</option>
                            </select>
                            <span className="planit-settings-hint">Switch providers depending on where you want responses generated.</span>
                          </div>

                          <div className="planit-settings-item">
                            <label className="planit-settings-label" htmlFor="planit-settings-model">
                              🧠 Model
                              {aiSettings.llmProvider === 'github' && <span className="planit-settings-provider-badge">🐙 GitHub</span>}
                              {aiSettings.llmProvider === 'portfolio' && <span className="planit-settings-provider-badge">☁️ Cloud</span>}
                              {aiSettings.llmProvider === 'local' && <span className="planit-settings-provider-badge">💻 Local</span>}
                            </label>
                            {aiSettings.llmProvider === 'github' ? (
                              <select
                                id="planit-settings-model"
                                value={aiSettings.githubModel}
                                onChange={e => updateAISetting('githubModel', e.target.value)}
                                className="planit-settings-input"
                              >
                                {GITHUB_MODELS.map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            ) : aiSettings.llmProvider === 'portfolio' ? (
                              <select
                                id="planit-settings-model"
                                value={aiSettings.portfolioModel}
                                onChange={e => updateAISetting('portfolioModel', e.target.value)}
                                className="planit-settings-input"
                              >
                                <option value="gpt-4o-mini">GPT-4o Mini</option>
                                <option value="gpt-4o">GPT-4o</option>
                              </select>
                            ) : (
                              <p className="planit-settings-ai-note">
                                Local models require the CSimple addon to be running.
                              </p>
                            )}
                          </div>

                          <div className="planit-settings-item planit-settings-item-full">
                            <label className="planit-settings-label" htmlFor="planit-settings-token">🔑 GitHub Personal Access Token</label>
                            <div className="planit-settings-token-group">
                              <input
                                id="planit-settings-token"
                                type={showToken ? 'text' : 'password'}
                                value={aiSettings.githubToken}
                                onChange={e => updateAISetting('githubToken', e.target.value)}
                                className="planit-settings-input"
                                placeholder="github_pat_... or ghp_..."
                                autoComplete="off"
                              />
                              <button
                                type="button"
                                className="planit-settings-token-toggle"
                                onClick={() => setShowToken(v => !v)}
                                aria-label={showToken ? 'Hide token' : 'Show token'}
                              >
                                {showToken ? '🙈' : '👁️'}
                              </button>
                            </div>
                            <span className="planit-settings-token-status">
                              {aiSettings.githubToken
                                ? (aiSettings.githubToken.startsWith('github_pat_')
                                  ? '✅ Fine-grained PAT detected'
                                  : aiSettings.githubToken.startsWith('ghp_')
                                    ? '✅ Classic PAT detected'
                                    : '⚠️ Unrecognized token format')
                                : 'Required for GitHub Models provider'}
                            </span>
                            <p className="planit-settings-token-help">
                              Create a <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">fine-grained PAT</a> with the <strong>Models: Read-only</strong> account permission, or a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">classic PAT</a> if your account already has GitHub Models access.
                            </p>
                          </div>
                        </div>

                        <h3 className="planit-settings-subsection-title">💬 Chat preferences</h3>
                        <div className="planit-settings-grid">
                          <div className="planit-settings-item">
                            <label className="planit-settings-label" htmlFor="planit-settings-temperature">🌡️ Temperature</label>
                            <div className="planit-settings-range-group">
                              <input
                                id="planit-settings-temperature"
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={aiSettings.defaultTemperature}
                                onChange={e => updateAISetting('defaultTemperature', parseFloat(e.target.value))}
                                className="planit-settings-range"
                              />
                              <span className="planit-settings-range-value">{aiSettings.defaultTemperature}</span>
                            </div>
                            <span className="planit-settings-hint">Lower = more focused, higher = more creative.</span>
                          </div>

                          <div className="planit-settings-item">
                            <label className="planit-settings-label" htmlFor="planit-settings-max-tokens">📏 Max Tokens</label>
                            <input
                              id="planit-settings-max-tokens"
                              type="number"
                              min="50"
                              max="4000"
                              step="50"
                              value={aiSettings.defaultMaxTokens}
                              onChange={e => updateAISetting('defaultMaxTokens', parseInt(e.target.value, 10) || 500)}
                              className="planit-settings-input"
                            />
                            <span className="planit-settings-hint">Maximum response length (50-4000).</span>
                          </div>

                          <div className="planit-settings-item">
                            <label className="planit-settings-label" htmlFor="planit-settings-history">🗂️ Conversation History</label>
                            <div className="planit-settings-range-group">
                              <input
                                id="planit-settings-history"
                                type="range"
                                min="5"
                                max="100"
                                step="5"
                                value={aiSettings.maxConversationHistory}
                                onChange={e => updateAISetting('maxConversationHistory', parseInt(e.target.value, 10))}
                                className="planit-settings-range"
                              />
                              <span className="planit-settings-range-value">{aiSettings.maxConversationHistory}</span>
                            </div>
                            <span className="planit-settings-hint">Messages of context sent with each request.</span>
                          </div>
                        </div>

                        <div className="planit-settings-checkbox-grid">
                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">⏎ Send with Enter</span>
                              <span className="planit-settings-toggle-description">Press Enter to send and Shift+Enter for a new line.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.sendWithEnter}
                              onChange={e => updateAISetting('sendWithEnter', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">🕐 Show Timestamps</span>
                              <span className="planit-settings-toggle-description">Display sent times in chat conversations.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.showTimestamps}
                              onChange={e => updateAISetting('showTimestamps', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">📝 Markdown Rendering</span>
                              <span className="planit-settings-toggle-description">Render structured AI answers with formatting and code blocks.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.enableMarkdown}
                              onChange={e => updateAISetting('enableMarkdown', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">💾 Save Chats Locally</span>
                              <span className="planit-settings-toggle-description">Store conversation history in this browser.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.saveChatsLocally}
                              onChange={e => updateAISetting('saveChatsLocally', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">☁️ Cloud Sync</span>
                              <span className="planit-settings-toggle-description">Sync chats and settings across your devices.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.cloudSync}
                              onChange={e => updateAISetting('cloudSync', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">🔊 Text-to-Speech</span>
                              <span className="planit-settings-toggle-description">Speak AI responses and action descriptions aloud.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.ttsEnabled}
                              onChange={e => updateAISetting('ttsEnabled', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>

                          <label className="planit-settings-toggle-card">
                            <div className="planit-settings-toggle-copy">
                              <span className="planit-settings-toggle-title">🎤 Speech Recognition</span>
                              <span className="planit-settings-toggle-description">Enable voice commands and wake-word listening.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={aiSettings.sttEnabled}
                              onChange={e => updateAISetting('sttEnabled', e.target.checked)}
                              className="planit-settings-checkbox"
                            />
                          </label>
                        </div>

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
