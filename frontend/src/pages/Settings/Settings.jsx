import { useEffect, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import { toast } from 'react-toastify';
import {
  setFontSizeScale,
  loadFontSizeScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
} from '../../utils/theme.js';
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
  } catch { return updates; }
}

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

  // AI Settings (synced with /net via localStorage)
  const [aiSettings, setAiSettings] = useState(() => {
    const stored = getAISettings();
    return {
      llmProvider: stored.llmProvider || 'portfolio',
      githubModel: stored.githubModel || 'gpt-4o-mini',
      portfolioModel: stored.portfolioModel || 'gpt-4o-mini',
      githubToken: stored.githubToken || '',
      defaultTemperature: stored.defaultTemperature ?? 0.7,
      defaultMaxTokens: stored.defaultMaxTokens ?? 500,
      sendWithEnter: stored.sendWithEnter ?? true,
      showTimestamps: stored.showTimestamps ?? true,
      enableMarkdown: stored.enableMarkdown ?? true,
    };
  });
  const [showToken, setShowToken] = useState(false);
  const [fontScale, setFontScale] = useState(() => loadFontSizeScale());

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
  }, []);

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

                    <div className="planit-settings-item">
                      <label className="planit-settings-label">🔤 Font Size</label>
                      <div className="planit-settings-range-group">
                        <input
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
                      <span className="planit-settings-hint">Adjusts text size across the entire app ({Math.round(FONT_SCALE_MIN * 100)}%–{Math.round(FONT_SCALE_MAX * 100)}%)</span>
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

                    {/* LLM Provider */}
                    <div className="planit-settings-grid">
                      <div className="planit-settings-item">
                        <label className="planit-settings-label">☁️ LLM Provider</label>
                        <select
                          value={aiSettings.llmProvider}
                          onChange={e => updateAISetting('llmProvider', e.target.value)}
                          className="planit-settings-input"
                        >
                          <option value="portfolio">☁️ Cloud (Portfolio)</option>
                          <option value="github">🐙 GitHub Models</option>
                          <option value="local">💻 Local (HuggingFace)</option>
                        </select>
                      </div>

                      {/* Model selector */}
                      <div className="planit-settings-item">
                        <label className="planit-settings-label">
                          🧠 Model
                          {aiSettings.llmProvider === 'github' && <span className="planit-settings-provider-badge">🐙 GitHub</span>}
                          {aiSettings.llmProvider === 'portfolio' && <span className="planit-settings-provider-badge">☁️ Cloud</span>}
                          {aiSettings.llmProvider === 'local' && <span className="planit-settings-provider-badge">💻 Local</span>}
                        </label>
                        {aiSettings.llmProvider === 'github' ? (
                          <select
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
                            value={aiSettings.portfolioModel}
                            onChange={e => updateAISetting('portfolioModel', e.target.value)}
                            className="planit-settings-input"
                          >
                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                            <option value="gpt-4o">GPT-4o</option>
                          </select>
                        ) : (
                          <p className="planit-settings-ai-note" style={{ margin: 0 }}>
                            Local models require the CSimple addon to be running.
                          </p>
                        )}
                      </div>

                      {/* GitHub Token */}
                      <div className="planit-settings-item planit-settings-item-full">
                        <label className="planit-settings-label">🔑 GitHub Personal Access Token</label>
                        <div className="planit-settings-token-group">
                          <input
                            type={showToken ? 'text' : 'password'}
                            value={aiSettings.githubToken}
                            onChange={e => updateAISetting('githubToken', e.target.value)}
                            className="planit-settings-input"
                            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="planit-settings-token-toggle"
                            onClick={() => setShowToken(v => !v)}
                          >
                            {showToken ? '🙈' : '👁️'}
                          </button>
                        </div>
                        <span className="planit-settings-token-status">
                          {aiSettings.githubToken
                            ? (aiSettings.githubToken.startsWith('ghp_') ? '✅ Classic PAT detected' : '⚠️ Use a classic PAT (ghp_...)')
                            : 'Required for GitHub Models provider'}
                        </span>
                        <p className="planit-settings-token-help">
                          Create a <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">classic PAT</a> (not fine-grained) — no scopes needed.
                        </p>
                      </div>
                    </div>

                    {/* Chat Preferences */}
                    <h4 className="planit-settings-subsection-title">💬 Chat Preferences</h4>
                    <div className="planit-settings-grid">
                      <div className="planit-settings-item">
                        <label className="planit-settings-label">🌡️ Temperature</label>
                        <div className="planit-settings-range-group">
                          <input
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
                        <span className="planit-settings-hint">Lower = more focused, Higher = more creative</span>
                      </div>

                      <div className="planit-settings-item">
                        <label className="planit-settings-label">📏 Max Tokens</label>
                        <input
                          type="number"
                          min="50"
                          max="4000"
                          step="50"
                          value={aiSettings.defaultMaxTokens}
                          onChange={e => updateAISetting('defaultMaxTokens', parseInt(e.target.value) || 500)}
                          className="planit-settings-input"
                        />
                        <span className="planit-settings-hint">Maximum response length (50-4000)</span>
                      </div>

                      <div className="planit-settings-item planit-settings-checkbox-item">
                        <label className="planit-settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={aiSettings.sendWithEnter}
                            onChange={e => updateAISetting('sendWithEnter', e.target.checked)}
                            className="planit-settings-checkbox"
                          />
                          <span>⏎ Send with Enter</span>
                        </label>
                      </div>

                      <div className="planit-settings-item planit-settings-checkbox-item">
                        <label className="planit-settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={aiSettings.showTimestamps}
                            onChange={e => updateAISetting('showTimestamps', e.target.checked)}
                            className="planit-settings-checkbox"
                          />
                          <span>🕐 Show Timestamps</span>
                        </label>
                      </div>

                      <div className="planit-settings-item planit-settings-checkbox-item">
                        <label className="planit-settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={aiSettings.enableMarkdown}
                            onChange={e => updateAISetting('enableMarkdown', e.target.checked)}
                            className="planit-settings-checkbox"
                          />
                          <span>📝 Enable Markdown Rendering</span>
                        </label>
                      </div>
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
                      These settings sync with the /net chat sidebar automatically.
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