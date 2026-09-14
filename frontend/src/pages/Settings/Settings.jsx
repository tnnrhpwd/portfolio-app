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
import { GEOLOCATION, isPermissionEnabled, setPermissionEnabled } from '../../utils/browserPermissions.js';
import { ADDON_DOWNLOAD_URL, useAddonDetection } from '../../hooks/simpleAddon/useAddonDetection';
import AIWorkflowSettings from '../../components/SimpleAddon/AIWorkflowSettings.jsx';
import { DEFAULT_CLOUD_MODEL_ID, resolveCloudModelLabel } from '../../utils/llmProviderOptions.js';
import ProfileAvatar from '../../components/ProfilePicture/ProfileAvatar.jsx';
import ProfilePictureEditor from '../../components/ProfilePicture/ProfilePictureEditor.jsx';
import './Settings.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';

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

  // Only the toolbar needs the connection state, but it needs it *live*: the
  // readout is where "is my PC agent reachable?" is answered on this page, so it
  // must come from the hook rather than a one-shot check.
  const { addonNeedsCertTrust, isConnected: addonConnected, isRemoteConnected } = useAddonDetection();
  const addonOnline = Boolean(addonConnected || isRemoteConnected);
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

  // Device-local browser-permission opt-in (see utils/browserPermissions.js).
  // The microphone choice is the existing `sttEnabled` setting; location gets
  // its own flag because Halfway is the only page that uses it.
  const [locationEnabled, setLocationEnabled] = useState(() => isPermissionEnabled(GEOLOCATION));

  // What the AI panel should *state* it is using — resolved from the user's
  // saved choice and the live `/llm-providers` response, never hardcoded.
  // `resolveCloudModelLabel` already folds the provider in ("Claude Haiku 4.5
  // (Bedrock)"), so the panel needs no separate provider string.
  const cloudModelLabel = resolveCloudModelLabel(aiSettings?.portfolioModel, llmProviders);

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

  // Microphone opt-in = the shared Speech Recognition setting, so enabling it
  // here lets the browser ask for mic access on /net (and disabling it stops the
  // ask entirely). Location is its own device-local flag.
  const handleMicToggle = useCallback((e) => {
    const next = e.target.checked;
    updateAISetting('sttEnabled', next);
    toast.success(next
      ? 'Microphone on — the browser may now ask for mic access on /net.'
      : 'Microphone off — voice input is disabled and the mic will not be requested.');
  }, [updateAISetting]);

  const handleLocationToggle = useCallback(() => {
    const next = !locationEnabled;
    setPermissionEnabled(GEOLOCATION, next);
    setLocationEnabled(next);
    toast.success(next
      ? 'Location on — Halfway may ask your browser for it.'
      : 'Location off — pages will not ask your browser for location.');
  }, [locationEnabled]);

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
    const hasPhoto = Boolean(user.profilePicture);
    // `#photo` is a child of `#identity`, so both hashes light up the same panel.
    const accountHighlighted = activeSection === 'identity' || activeSection === 'photo';

    return (
      <>
        <SEO
          title="Settings"
          description="Manage your Simple account: profile, email notifications, appearance, AI provider, and browser permissions."
          path="/settings"
        />
        <Header />

        <div className="settings-page">
          <div className="settings-shell">
            {/* Sticky toolbar — the page's "hero", collapsed onto one row: the
                room's name, its live state, and the primary action reachable from
                anywhere on the page (FRONTEND_UI_STANDARD.md §5.7). No eyebrow,
                no subtitle, no lead. */}
            <header className="settings-bar">
              <h1 className="settings-bar-title">Settings</h1>

              <ul className="settings-bar-readout">
                <li className="settings-chip">
                  <span className="settings-chip-key">Account</span>
                  <strong>{user.nickname || user.email}</strong>
                </li>
                <li className="settings-chip">
                  <span className="settings-chip-key">Theme</span>
                  <strong>{colorMode}</strong>
                </li>
                <li className="settings-chip">
                  <span className="settings-chip-key">Text</span>
                  <strong>{Math.round(fontScale * 100)}%</strong>
                </li>
                <li className={`settings-chip${addonOnline ? ' settings-chip--live' : ''}`}>
                  <span className="settings-chip-key">Addon</span>
                  <strong>{addonOnline ? 'online' : 'offline'}</strong>
                </li>
              </ul>

              <div className="settings-bar-actions">
                <button
                  type="button"
                  className="settings-btn settings-btn--outline"
                  onClick={() => navigate('/net')}
                >
                  💬 Open chat
                </button>
                <button
                  type="submit"
                  form="settings-form"
                  className="settings-btn settings-btn--primary"
                  disabled={profileSaving}
                >
                  {profileSaving ? 'Saving…' : '💾 Save changes'}
                </button>
              </div>
            </header>

            <form id="settings-form" className="settings-form" onSubmit={handleProfileSave}>
              {/* Row 1 — who you are, and how the app looks. */}
              <div className="settings-row">
                <section
                  id="identity"
                  className={`settings-panel settings-panel--account${accountHighlighted ? ' is-highlighted' : ''}`}
                >
                  <div className="settings-panel-head">
                    <h2 className="settings-panel-title">Account</h2>
                  </div>

                  <div className="settings-photo" id="photo">
                    <ProfileAvatar
                      picture={user.profilePicture}
                      name={user.nickname}
                      size="lg"
                    />
                    <div className="settings-photo-copy">
                      <span className="settings-photo-title">Profile picture</span>
                      <span className="settings-hint">
                        {hasPhoto ? 'Shown across your account.' : 'Replaces the default checkmark.'}
                      </span>
                      <div className="settings-photo-actions">
                        <button
                          type="button"
                          className="settings-btn settings-btn--outline settings-btn--sm"
                          onClick={() => setPhotoEditorOpen(true)}
                          disabled={profileSaving}
                        >
                          {hasPhoto ? '🖼️ Change' : '⬆️ Upload'}
                        </button>
                        {hasPhoto && (
                          <button
                            type="button"
                            className="settings-btn settings-btn--danger settings-btn--sm"
                            onClick={() => handlePhotoSave(null)}
                            disabled={profileSaving}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="settings-fields">
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="planit-settings-nickname">👤 Profile name</label>
                      <input
                        id="planit-settings-nickname"
                        type="text"
                        name="nickname"
                        value={profileForm.nickname}
                        onChange={handleProfileChange}
                        className="settings-input"
                        placeholder="Your display name"
                        autoComplete="nickname"
                        maxLength={40}
                      />
                      <span className="settings-hint">Shown across the app.</span>
                    </div>

                    <div className="settings-field">
                      <label className="settings-label" htmlFor="planit-settings-email">📧 Email address</label>
                      <input
                        id="planit-settings-email"
                        type="email"
                        name="email"
                        value={profileForm.email}
                        onChange={handleProfileChange}
                        className="settings-input"
                        placeholder="Enter email address"
                        autoComplete="email"
                      />
                      <span className="settings-hint">Receipts, alerts, and account recovery.</span>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label" htmlFor="planit-settings-password">🔐 Password</label>
                    <button
                      id="planit-settings-password"
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={isResetPasswordLoading}
                      className="settings-btn settings-btn--warm settings-btn--sm"
                    >
                      {isResetPasswordLoading ? '📤 Sending…' : '🔐 Send reset email'}
                    </button>
                    <span className="settings-hint">Emails a secure reset link to {user.email}.</span>
                  </div>

                  <div className="settings-panel-foot">
                    <span className="settings-hint">
                      {profileSaving ? 'Saving…' : 'Name and email save to your account.'}
                    </span>
                  </div>
                </section>

                <section
                  id="appearance"
                  className={`settings-panel settings-panel--appearance${activeSection === 'appearance' ? ' is-highlighted' : ''}`}
                >
                  <div className="settings-panel-head">
                    <h2 className="settings-panel-title">Appearance</h2>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label" htmlFor="planit-settings-theme">🌓 Theme</label>
                    <select
                      id="planit-settings-theme"
                      name="theme"
                      value={colorMode}
                      onChange={handleColorModeChange}
                      className="settings-input"
                    >
                      <option value="light">☀️ Light</option>
                      <option value="dark">🌙 Dark</option>
                      <option value="system">💻 System</option>
                    </select>
                    <span className="settings-hint">Previews immediately.</span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label" htmlFor="planit-settings-font-size">🔤 Text size</label>
                    <div className="settings-range">
                      <input
                        id="planit-settings-font-size"
                        type="range"
                        min={FONT_SCALE_MIN}
                        max={FONT_SCALE_MAX}
                        step="0.05"
                        value={fontScale}
                        onChange={handleFontScaleChange}
                        className="settings-range-input"
                        aria-label="Font size scale"
                      />
                      <span className="settings-range-value">{Math.round(fontScale * 100)}%</span>
                    </div>
                    <div className="settings-font-preview">
                      <span className="settings-font-preview-text">The quick brown fox jumps over the lazy dog</span>
                      {fontScale !== FONT_SCALE_DEFAULT && (
                        <button
                          type="button"
                          className="settings-btn settings-btn--ghost settings-btn--sm"
                          onClick={resetFontScale}
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                    <span className="settings-hint">
                      Scales text across the app ({Math.round(FONT_SCALE_MIN * 100)}%–{Math.round(FONT_SCALE_MAX * 100)}%).
                    </span>
                  </div>
                </section>
              </div>

              {/* Row 2 — what we send you, and what a page may ask for. */}
              <div className="settings-row">
                <section
                  id="notifications"
                  className={`settings-panel settings-panel--notifications${activeSection === 'notifications' ? ' is-highlighted' : ''}`}
                >
                  <div className="settings-panel-head">
                    <h2 className="settings-panel-title">Email notifications</h2>
                  </div>

                  <div className="settings-toggle-list">
                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">🔐 Account &amp; security</span>
                        <span className="settings-toggle-desc">Resets, welcome, and security alerts. Always on.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={emailPrefsLocal.account}
                        disabled
                        className="settings-toggle-input"
                      />
                    </label>

                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">💳 Plan &amp; billing</span>
                        <span className="settings-toggle-desc">Plan changes, subscription updates, and receipts.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={emailPrefsLocal.billing}
                        onChange={handleEmailPrefToggle('billing')}
                        className="settings-toggle-input"
                      />
                    </label>

                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">✨ Product updates</span>
                        <span className="settings-toggle-desc">New features and improvements.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={emailPrefsLocal.product}
                        onChange={handleEmailPrefToggle('product')}
                        className="settings-toggle-input"
                      />
                    </label>

                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">📣 Marketing</span>
                        <span className="settings-toggle-desc">Offers, discounts, and newsletter. Opt-in only.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={emailPrefsLocal.marketing}
                        onChange={handleEmailPrefToggle('marketing')}
                        className="settings-toggle-input"
                      />
                    </label>
                  </div>
                </section>

                <section
                  id="privacy"
                  className={`settings-panel settings-panel--privacy${activeSection === 'privacy' ? ' is-highlighted' : ''}`}
                >
                  <div className="settings-panel-head">
                    <h2 className="settings-panel-title">Privacy &amp; permissions</h2>
                  </div>

                  <div className="settings-toggle-list">
                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">🎤 Microphone</span>
                        <span className="settings-toggle-desc">
                          Voice input on <strong>/net</strong>. Off means the browser is never asked.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiSettings.sttEnabled ?? false}
                        onChange={handleMicToggle}
                        className="settings-toggle-input"
                      />
                    </label>

                    <label className="settings-toggle">
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">📍 Location</span>
                        <span className="settings-toggle-desc">
                          Sunrise &amp; sunset on Halfway. Off waits for <strong>Use my location</strong>.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={locationEnabled}
                        onChange={handleLocationToggle}
                        className="settings-toggle-input"
                      />
                    </label>
                  </div>
                </section>
              </div>

              {/* Row 3 — the AI connection, which needs the full width. */}
              <section
                id="ai"
                className={`settings-panel settings-panel--ai${activeSection === 'ai' ? ' is-highlighted' : ''}`}
              >
                <div className="settings-panel-head">
                  <h2 className="settings-panel-title">AI &amp; Simple addon</h2>
                  <span className="settings-chip settings-chip--quiet">☁️ {cloudModelLabel}</span>
                </div>

                <div className="settings-ai">
                  <p className="settings-hint">
                    Cloud chat runs on {cloudModelLabel} at <strong>/net</strong>. Local models and
                    desktop automation need the <strong>Simple addon</strong>.
                  </p>

                  <AIWorkflowSettings
                    settings={aiSettings}
                    onChange={updateAISetting}
                    user={user}
                    portfolioLLMProviders={llmProviders}
                  />

                  <div className="settings-ai-actions">
                    <a
                      href={ADDON_DOWNLOAD_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-btn settings-btn--outline"
                    >
                      📥 Get the addon
                    </a>
                  </div>

                  {addonNeedsCertTrust && (
                    <p className="settings-note">
                      Already installed? Browsers block the addon&apos;s self-signed cert on HTTPS
                      sites.{' '}
                      <a href="https://localhost:3444/api/status" target="_blank" rel="noopener noreferrer">
                        Trust the cert
                      </a>{' '}
                      (choose &quot;Advanced → Proceed&quot;), then reload this page.
                    </p>
                  )}

                  {/* Power-user plumbing, folded away: the first screen is the
                      job, not the config (§5.7). */}
                  <details className="settings-details">
                    <summary>Addon, sync, and browser integration</summary>
                    <div className="settings-details-body">
                      <p className="settings-note">
                        AI preferences sync with the /net chat sidebar automatically.
                      </p>
                      <p className="settings-note">
                        Agents, personas, behaviors, memory, goals, and shortcuts live in{' '}
                        <strong>Advanced Settings</strong> inside the addon&apos;s <strong>/net</strong> chat.
                      </p>
                      <p className="settings-note">
                        To remove it: right-click the tray icon, turn off <strong>Start at Login</strong>{' '}
                        if it&apos;s on, choose <strong>Quit Simple Addon</strong>, then delete{' '}
                        <code>Simple-Addon-portable.exe</code>. Nothing is left installed in Windows.
                      </p>
                      {isSecurePage && (
                        <div className="settings-optout">
                          <p className="settings-note">
                            This browser {addonOptedIn ? 'checks' : 'does not check'} for the addon on
                            this page. Off stops the page probing your addon&apos;s local cert entirely
                            — no addon features work here until it&apos;s back on.
                          </p>
                          <button
                            type="button"
                            className="settings-btn settings-btn--outline settings-btn--sm"
                            onClick={toggleAddonOptIn}
                          >
                            {addonOptedIn ? '🔌 Turn off browser integration' : '🔌 Turn on browser integration'}
                          </button>
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              </section>

              {/* Closing row — leaving the room, not a pitch. */}
              <div className="settings-session">
                <button
                  type="button"
                  className="settings-btn settings-btn--outline"
                  onClick={() => navigate('/profile')}
                >
                  👤 Back to profile
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--danger"
                  onClick={onLogout}
                >
                  🚪 Sign out
                </button>
              </div>
            </form>
          </div>

          <ProfilePictureEditor
            open={photoEditorOpen}
            onClose={() => setPhotoEditorOpen(false)}
            onSave={handlePhotoSave}
            currentPicture={user.profilePicture}
            saving={profileSaving}
          />
        </div>

        <Footer />
      </>
    );
  }

  return null;
}

export default Settings;
