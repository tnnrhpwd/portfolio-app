import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { logout, resetDataSlice, getLLMProviders, getEmailPreferences, updateEmailPreferences, updateProfile } from './../../features/data/dataSlice.js';
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
import { getCloudSettings, saveCloudSettings, isAddonOptedIn, setAddonOptIn } from '../../services/simpleAddonApi.js';
import { ADDON_DOWNLOAD_URL, useAddonDetection } from '../../hooks/simpleAddon/useAddonDetection';
import AIWorkflowSettings from '../../components/SimpleAddon/AIWorkflowSettings.jsx';
import { DEFAULT_CLOUD_MODEL_ID, resolveCloudModelLabel, resolveCloudModelProvider } from '../../utils/llmProviderOptions.js';
import { providerLabel } from '../../constants/aiModel.js';
import ProfileAvatar from '../../components/ProfilePicture/ProfileAvatar.jsx';
import ProfilePictureEditor from '../../components/ProfilePicture/ProfilePictureEditor.jsx';
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
  const location = useLocation();
  const dispatch = useDispatch();

  const { user, dataIsLoading, llmProviders, emailPrefs } = useSelector((state) => state.data);

  useEffect(() => {
    dispatch(getLLMProviders());
  }, [dispatch]);

  const { addonNeedsCertTrust } = useAddonDetection();
  const [addonOptedIn, setAddonOptedInState] = useState(() => isAddonOptedIn());
  const isSecurePage = typeof window !== 'undefined' && window.location?.protocol === 'https:';

  const toggleAddonOptIn = useCallback(() => {
    const next = !addonOptedIn;
    setAddonOptIn(next);
    setAddonOptedInState(next);
    toast.success(next
      ? 'Browser will now check for the Simple addon on this page.'
      : 'Browser integration with the Simple addon turned off for this browser.');
  }, [addonOptedIn]);

  const [profileForm, setProfileForm] = useState({ nickname: '', email: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [colorMode, setColorMode] = useState('system');
  const [activeSection, setActiveSection] = useState('');

  const [isResetPasswordLoading, setIsResetPasswordLoading] = useState(false);

  // Email notification preferences (defaults match the backend: billing and
  // product on, marketing off, account always on and not toggleable).
  const [emailPrefsLocal, setEmailPrefsLocal] = useState({
    account: true,
    billing: true,
    product: true,
    marketing: false,
  });

  useEffect(() => {
    if (user?.token) dispatch(getEmailPreferences());
  }, [user?.token, dispatch]);

  useEffect(() => {
    if (emailPrefs) {
      setEmailPrefsLocal((prev) => ({
        account: true,
        billing: emailPrefs.billing ?? prev.billing,
        product: emailPrefs.product ?? prev.product,
        marketing: emailPrefs.marketing ?? prev.marketing,
      }));
    }
  }, [emailPrefs]);

  const handleEmailPrefToggle = useCallback((key) => (e) => {
    const value = e.target.checked;
    setEmailPrefsLocal((prev) => ({ ...prev, [key]: value }));
    dispatch(updateEmailPreferences({ [key]: value }))
      .unwrap()
      .then(() => toast.success('Email preferences updated.', { autoClose: 2000 }))
      .catch(() => {
        // Revert on failure so the UI stays truthful
        setEmailPrefsLocal((prev) => ({ ...prev, [key]: !value }));
        toast.error('Failed to update email preferences.', { autoClose: 3000 });
      });
  }, [dispatch]);

  const [aiSettings, setAiSettings] = useState(() => {
    const stored = getAISettings();
    return {
      llmProvider: stored.llmProvider || 'portfolio',
      portfolioModel: stored.portfolioModel || DEFAULT_CLOUD_MODEL_ID,
      defaultTemperature: stored.defaultTemperature ?? 0.7,
      defaultMaxTokens: stored.defaultMaxTokens ?? 500,
      maxConversationHistory: stored.maxConversationHistory ?? 20,
      sendWithEnter: stored.sendWithEnter ?? true,
      showTimestamps: stored.showTimestamps ?? true,
      enableMarkdown: stored.enableMarkdown ?? true,
      saveChatsLocally: stored.saveChatsLocally ?? true,
      cloudSync: stored.cloudSync ?? true,
      ttsEnabled: stored.ttsEnabled ?? true,
      sttEnabled: stored.sttEnabled ?? false,
    };
  });
  const [fontScale, setFontScale] = useState(() => loadFontSizeScale());

  // What the AI section should *state* it is using — resolved from the user's
  // saved choice and the live `/llm-providers` response, never hardcoded.
  const cloudModelLabel = resolveCloudModelLabel(aiSettings?.portfolioModel, llmProviders);
  const cloudProviderLabel = providerLabel(resolveCloudModelProvider(aiSettings?.portfolioModel, llmProviders));

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
          'llmProvider', 'portfolioModel',
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

    setProfileForm({
      nickname: user.nickname || '',
      email: user.email || '',
    });

    const body = document.body;
    if (body.classList.contains('dark-theme')) {
      setColorMode('dark');
    } else if (body.classList.contains('light-theme')) {
      setColorMode('light');
    } else {
      setColorMode('system');
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [user, navigate, dispatch]);

  // /profile links here with a section hash (e.g. "#photo"). Scroll that section
  // into view and briefly highlight it so the jump is obvious.
  useEffect(() => {
    if (dataIsLoading) return undefined;
    const hash = (location.hash || '').replace('#', '');
    if (!hash) return undefined;

    const target = document.getElementById(hash);
    if (!target) return undefined;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(hash);
    const timer = setTimeout(() => setActiveSection(''), 2400);
    return () => clearTimeout(timer);
  }, [location.hash, dataIsLoading]);

  if (dataIsLoading) {
    return <Spinner />;
  }

  const onLogout = () => {
    dispatch(logout());
    dispatch(resetDataSlice());
    navigate('/');
  };

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Persist the profile-name / email fields. Only the fields that actually
   * changed are sent, so a no-op save never fires a pointless request.
   */
  const handleProfileSave = async (event) => {
    event.preventDefault();

    const nickname = profileForm.nickname.trim();
    const email = profileForm.email.trim().toLowerCase();
    const updates = {};

    if (nickname && nickname !== (user?.nickname || '')) updates.nickname = nickname;
    if (email && email !== (user?.email || '').toLowerCase()) updates.email = email;

    if (Object.keys(updates).length === 0) {
      toast.info('Nothing to update.', { autoClose: 2000 });
      return;
    }

    setProfileSaving(true);
    try {
      await dispatch(updateProfile(updates)).unwrap();
      toast.success('Profile updated.', { autoClose: 2500 });
    } catch (error) {
      toast.error(typeof error === 'string' ? error : 'Could not update your profile.', { autoClose: 4000 });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleColorModeChange = (event) => {
    const value = event.target.value;
    setColorMode(value);

    if (value === 'light') {
      setLightMode();
    } else if (value === 'dark') {
      setDarkMode();
    } else {
      setSystemColorMode();
    }
  };

  /** Save (or clear) the profile picture through the same profile endpoint. */
  const handlePhotoSave = async (dataUrl) => {
    setProfileSaving(true);
    try {
      await dispatch(updateProfile({ profilePicture: dataUrl })).unwrap();
      toast.success(dataUrl ? 'Profile photo updated.' : 'Profile photo removed.', { autoClose: 2500 });
      setPhotoEditorOpen(false);
    } catch (error) {
      toast.error(typeof error === 'string' ? error : 'Could not save your photo.', { autoClose: 4000 });
    } finally {
      setProfileSaving(false);
    }
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
                  <h1 className="planit-settings-heading-title">Settings</h1>
                  <p className="planit-settings-heading-description">
                    Your profile, notifications, appearance, and AI connection — all in one place.
                  </p>
                </div>
              </div>
            </section>

            <form onSubmit={handleProfileSave} className="planit-settings-form">
              <section className="planit-settings-content">
                <div className="planit-settings-layout">
                  <div className="planit-settings-main">
                    <div
                      className={`planit-settings-section${activeSection === 'identity' ? ' is-highlighted' : ''}`}
                      id="identity"
                    >
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Account</span>
                          <h2 className="planit-settings-section-title">Account settings</h2>
                          <p className="planit-settings-section-description">
                            Your photo, profile name, email, and password — everything about how you appear in the app.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-photo" id="photo">
                        <ProfileAvatar
                          picture={user.profilePicture}
                          name={user.nickname}
                          size="lg"
                        />
                        <div className="planit-settings-photo-copy">
                          <span className="planit-settings-photo-title">Profile picture</span>
                          <span className="planit-settings-hint">
                            {user.profilePicture
                              ? 'Shown across your account. Upload a new image to replace it.'
                              : 'Add your own photo to replace the default checkmark.'}
                          </span>
                          <div className="planit-settings-photo-actions">
                            <button
                              type="button"
                              className="planit-settings-outline-button"
                              onClick={() => setPhotoEditorOpen(true)}
                              disabled={profileSaving}
                            >
                              {user.profilePicture ? '🖼️ Change photo' : '⬆️ Upload photo'}
                            </button>
                            {user.profilePicture && (
                              <button
                                type="button"
                                className="planit-settings-text-button"
                                onClick={() => handlePhotoSave(null)}
                                disabled={profileSaving}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="planit-settings-grid">
                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-nickname">👤 Profile name</label>
                          <input
                            id="planit-settings-nickname"
                            type="text"
                            name="nickname"
                            value={profileForm.nickname}
                            onChange={handleProfileChange}
                            className="planit-settings-input"
                            placeholder="Your display name"
                            autoComplete="nickname"
                            maxLength={40}
                          />
                          <span className="planit-settings-hint">This is the name shown across the app.</span>
                        </div>

                        <div className="planit-settings-item">
                          <label className="planit-settings-label" htmlFor="planit-settings-email">📧 Email address</label>
                          <input
                            id="planit-settings-email"
                            type="email"
                            name="email"
                            value={profileForm.email}
                            onChange={handleProfileChange}
                            className="planit-settings-input"
                            placeholder="Enter email address"
                            autoComplete="email"
                          />
                          <span className="planit-settings-hint">Used for receipts, alerts, and account recovery.</span>
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
                            {isResetPasswordLoading ? '📤 Sending reset email...' : '🔐 Send password reset email'}
                          </button>
                        </div>
                      </div>

                      <div className="planit-settings-save-row">
                        <button
                          type="submit"
                          className="planit-settings-save-button"
                          disabled={profileSaving}
                        >
                          {profileSaving ? 'Saving…' : '💾 Save changes'}
                        </button>
                        <span className="planit-settings-hint">
                          Your profile name and email are saved to your account.
                        </span>
                      </div>
                    </div>

                    <div
                      className={`planit-settings-section${activeSection === 'notifications' ? ' is-highlighted' : ''}`}
                      id="notifications"
                    >
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">Email</span>
                          <h2 className="planit-settings-section-title">Email notifications</h2>
                          <p className="planit-settings-section-description">
                            Choose which emails you receive. Account &amp; security emails always stay on.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-checkbox-grid">
                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">🔐 Account &amp; Security</span>
                            <span className="planit-settings-toggle-description">Password resets, welcome, and security alerts. Always on.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={emailPrefsLocal.account}
                            disabled
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">💳 Plan &amp; Billing</span>
                            <span className="planit-settings-toggle-description">Plan changes, subscription updates, and receipts.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={emailPrefsLocal.billing}
                            onChange={handleEmailPrefToggle('billing')}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">✨ Product Updates</span>
                            <span className="planit-settings-toggle-description">New features, improvements, and product announcements.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={emailPrefsLocal.product}
                            onChange={handleEmailPrefToggle('product')}
                            className="planit-settings-checkbox"
                          />
                        </label>

                        <label className="planit-settings-toggle-card">
                          <div className="planit-settings-toggle-copy">
                            <span className="planit-settings-toggle-title">📣 Marketing &amp; Promotions</span>
                            <span className="planit-settings-toggle-description">Offers, discounts, and newsletter. Opt-in only.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={emailPrefsLocal.marketing}
                            onChange={handleEmailPrefToggle('marketing')}
                            className="planit-settings-checkbox"
                          />
                        </label>
                      </div>
                    </div>

                    <div
                      className={`planit-settings-section${activeSection === 'appearance' ? ' is-highlighted' : ''}`}
                      id="appearance"
                    >
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
                            value={colorMode}
                            onChange={handleColorModeChange}
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

                    <div
                      className={`planit-settings-section${activeSection === 'ai' ? ' is-highlighted' : ''}`}
                      id="ai"
                    >
                      <div className="planit-settings-section-header">
                        <div>
                          <span className="planit-settings-section-kicker">AI workflow</span>
                          <h2 className="planit-settings-section-title">AI &amp; Simple addon</h2>
                          <p className="planit-settings-section-description">
                            Choose your provider, tune chat defaults, and manage {cloudProviderLabel} access.
                          </p>
                        </div>
                      </div>

                      <div className="planit-settings-ai-info">
                        <p className="planit-settings-ai-description">
                          Access AI chat powered by {cloudModelLabel} at <strong>/net</strong>. For local AI and desktop automation, install the <strong>Simple addon</strong>.
                        </p>

                        <AIWorkflowSettings
                          settings={aiSettings}
                          onChange={updateAISetting}
                          user={user}
                          portfolioLLMProviders={llmProviders}
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
                            href={ADDON_DOWNLOAD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="planit-settings-ai-link"
                          >
                            📥 Get Simple Addon
                          </a>
                        </div>
                        <p className="planit-settings-ai-note">
                          AI preferences sync with the /net chat sidebar automatically.
                        </p>
                        <p className="planit-settings-ai-note">
                          Need agents, personas, behaviors, memory, goals, or shortcuts? Install the <strong>Simple addon</strong> and open <strong>Advanced Settings</strong> inside the <strong>/net</strong> chat for those power-user tools.
                        </p>
                        <p className="planit-settings-ai-note">
                          Removing it later is just as easy: right-click the Simple tray icon, turn off <strong>Start at Login</strong> if it&apos;s on, choose <strong>Quit Simple Addon</strong>, then delete the downloaded <code>Simple-Addon-portable.exe</code>. Nothing is left installed in Windows.
                        </p>
                        {addonNeedsCertTrust && (
                          <p className="planit-settings-ai-note">
                            Already installed? Browsers block the addon's self-signed cert on HTTPS sites.{' '}
                            <a
                              href="https://localhost:3444/api/status"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ textDecoration: 'underline' }}
                            >
                              Click here
                            </a>
                            , choose &quot;Advanced → Proceed&quot;, then reload this page.
                          </p>
                        )}
                        {isSecurePage && (
                          <div className="planit-settings-ai-optout">
                            <p className="planit-settings-ai-note">
                              This browser {addonOptedIn ? 'checks' : 'does not check'} for the Simple addon
                              on this page. Turning this off stops the page from probing your addon's local
                              cert entirely — no addon features work here until it's back on, but it's easy
                              to reverse anytime.
                            </p>
                            <button
                              type="button"
                              className="planit-settings-ai-button"
                              onClick={toggleAddonOptIn}
                            >
                              {addonOptedIn ? '🔌 Turn off browser integration' : '🔌 Turn on browser integration'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="planit-settings-actions">
                <button
                  type="button"
                  className="planit-settings-profile-button"
                  onClick={() => navigate('/profile')}
                >
                  👤 Back to Profile
                </button>
                <button
                  type="button"
                  className="planit-settings-ai-button"
                  onClick={() => navigate('/net')}
                >
                  💬 Open AI Chat
                </button>
                <button type="button" className="planit-settings-logout-button" onClick={onLogout}>
                  🚪 Sign Out
                </button>
              </section>
            </form>
          </div>
        </div>

        <ProfilePictureEditor
          open={photoEditorOpen}
          onClose={() => setPhotoEditorOpen(false)}
          onSave={handlePhotoSave}
          currentPicture={user.profilePicture}
          saving={profileSaving}
        />

        <Footer />
      </>
    );
  }

  return null;
}

export default Settings;
