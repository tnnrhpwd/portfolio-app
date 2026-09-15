import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, Link } from 'react-router-dom';
import { profilePath, profileVisibilityOf } from '../../utils/userProfileUtils.js';
import { logout, resetDataSlice, getUserSubscription, getUserUsage, getUserStorage, updateProfile } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { getThemePreference, setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import {
  SCHEMES,
  CUSTOM_SCHEME,
  initScheme,
  setScheme,
  getCustomColors,
  setCustomColors,
} from '../../utils/scheme.js';
import { syncSchemeToAddon } from '../../utils/schemeSync.js';
import { isTokenValid } from '../../utils/tokenUtils.js';
import { toast } from 'react-toastify';
import {
  PLAN_IDS, QUOTA_SHORT, STORAGE_DISPLAY,
  isProTier,
} from '../../constants/pricing.js';
import usePurchaseGate from '../../hooks/usePurchaseGate.js';
import PurchaseGateNotice from '../../components/PurchaseGateNotice/PurchaseGateNotice.jsx';
import ProfileAvatar from '../../components/ProfilePicture/ProfileAvatar.jsx';
import { providerLabel } from '../../constants/aiModel.js';
import './Profile.css';

// Emoji + qualifier for each usage record's `api` key. The provider *name*
// comes from the shared aiModel constants so it can't drift from the rest of
// the UI (this list used to hardcode "AWS Bedrock"/"OpenAI" here).
const USAGE_API_LABELS = {
  bedrock: `☁️ ${providerLabel('bedrock')}`,
  deepseek: `☁️ ${providerLabel('deepseek')}`,
  openai: `🧾 ${providerLabel('openai')} (OCR)`,
  github: `🤖 ${providerLabel('github')} (legacy)`,
};

const formatDateLabel = (value) => (
  value ? new Date(value).toLocaleDateString() : 'Unknown'
);

const getAccountAgeLabel = (createdAt) => {
  if (!createdAt) {
    return 'Unknown';
  }

  const startDate = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now - startDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30.44);
  const diffYears = Math.floor(diffDays / 365.25);

  if (diffYears > 0) {
    const remainingMonths = Math.floor((diffDays % 365.25) / 30.44);
    return `${diffYears} year${diffYears !== 1 ? 's' : ''}${remainingMonths > 0 ? `, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}` : ''}`;
  }

  if (diffMonths > 0) {
    return `${diffMonths} month${diffMonths !== 1 ? 's' : ''}`;
  }

  if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  }

  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
  return diffHours > 0 ? `${diffHours} hour${diffHours !== 1 ? 's' : ''}` : 'Just created';
};

function Profile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [currentColorMode, setCurrentColorMode] = useState('system');
  // A separate axis from the mode above, and read synchronously so the control
  // shows the truth on the first paint rather than a frame later.
  const [colorScheme, setColorScheme] = useState(() => initScheme());
  // The Custom pair, held in state because the two pickers are controlled. Read
  // AFTER `initScheme()` above, which is what lets the seed it may hand back be
  // the scheme actually in force.
  const [customColors, setCustomColorsState] = useState(() => getCustomColors());
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [userSubscription, setUserSubscription] = useState(null);
  const { purchasesEnabled, message: gateMessage } = usePurchaseGate();

  const {
    user,
    dataIsLoading,
    userUsage,
    userUsageIsLoading,
    userUsageIsError,
    userUsageMessage,
    userStorage,
    userStorageIsLoading,
    userStorageIsError,
    userStorageMessage
  } = useSelector((state) => state.data);

  useEffect(() => {
    // The PREFERENCE, not the resolved class. With `system` stored the body still
    // carries a concrete light/dark class, so reading the class would report the
    // OUTCOME instead of the choice and this control could never show "System".
    setCurrentColorMode(getThemePreference());

    if (!user) {
      navigate('/login');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && !subscriptionLoaded) {
      if (!user.token || !isTokenValid(user.token)) {
        dispatch(logout());
        setTimeout(() => {
          navigate('/login', { state: { sessionExpired: true } });
        }, 100);
        return;
      }

      try {
        dispatch(getUserSubscription())
          .unwrap()
          .then((subscriptionData) => {
            setUserSubscription(subscriptionData);
            setSubscriptionLoaded(true);
          })
          .catch((error) => {
            if (error.includes('Not authorized') || error.includes('token expired')) {
              dispatch(logout());
              setTimeout(() => {
                navigate('/login', { state: { sessionExpired: true } });
              }, 100);
            } else {
              setUserSubscription({ subscriptionPlan: 'Free', subscriptionDetails: null });
              setSubscriptionLoaded(true);
            }
          });

        dispatch(getUserUsage())
          .unwrap()
          .catch((error) => {
            console.error('Failed to fetch usage data:', error);
          });

        dispatch(getUserStorage())
          .unwrap()
          .catch((error) => {
            console.error('Failed to fetch storage data:', error);
          });
      } catch (error) {
        console.error('Error dispatching subscription/usage actions:', error);
        setSubscriptionLoaded(true);
      }
    }
  }, [user, subscriptionLoaded, dispatch, navigate]);

  const refreshUsageData = () => {
    if (user && user.token && isTokenValid(user.token)) {
      dispatch(getUserUsage())
        .unwrap()
        .catch((error) => {
          console.error('Failed to refresh usage data:', error);
        });

      dispatch(getUserStorage())
        .unwrap()
        .catch((error) => {
          console.error('Failed to refresh storage data:', error);
        });

      toast.success('Profile details refreshed.', { autoClose: 2000 });
    }
  };

  const onLogout = () => {
    setSubscriptionLoaded(false);
    dispatch(logout());
    dispatch(resetDataSlice());
    navigate('/');
  };

  const navigateToSettings = () => {
    navigate('/settings');
  };

  /**
   * Jump to the matching section of /settings, which owns every "edit my
   * account" control. The hash tells Settings which section to scroll to and
   * briefly highlight; the profile picture lives in the "photo" section.
   */
  const goToSettings = (section) => {
    navigate(`/settings#${section}`);
  };

  /**
   * Who may see `/u/<nickname>`. The server owns the truth; this mirrors what it
   * last told us. Seeded from the login response (postData.js) and kept in step
   * by the `updateProfile.fulfilled` reducer, which merges the returned profile
   * back into `state.user`. Accounts with no stored attribute read as private.
   */
  const [visibility, setVisibility] = useState(profileVisibilityOf(user));
  const [savingVisibility, setSavingVisibility] = useState(false);

  // The store can populate `user` after the first render (silent re-auth from
  // localStorage), so follow it rather than trusting the initial seed.
  useEffect(() => {
    setVisibility(profileVisibilityOf(user));
  }, [user?.profileVisibility]);

  const publicPagePath = profilePath(user?.nickname);

  const handleVisibilityChange = async (event) => {
    const next = event.target.value;
    const previous = visibility;
    setVisibility(next);
    setSavingVisibility(true);

    try {
      await dispatch(updateProfile({ profileVisibility: next })).unwrap();
      toast.success(
        next === 'public'
          ? 'Your page is public — anyone with the link can see it.'
          : 'Your page is private — only you and your connections can see it.',
      );
    } catch (error) {
      // Put the dropper back where it was: leaving it showing a value the
      // server rejected would tell the user they had published a page they had
      // not.
      setVisibility(previous);
      toast.error(error || 'Could not change who can see your page.');
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleSubscriptionChange = (event) => {
    const newPlan = event.target.value;

    if (newPlan.toLowerCase() === (userSubscription?.subscriptionPlan || 'Free').toLowerCase()) {
      event.target.value = userSubscription?.subscriptionPlan || 'Free';
      return;
    }

    if (newPlan.toLowerCase() !== 'free' && !purchasesEnabled) {
      event.target.value = userSubscription?.subscriptionPlan || 'Free';
      toast.info(gateMessage || 'Upgrading is temporarily paused. Please check back soon.');
      return;
    }

    navigate(`/pay?plan=${newPlan.toLowerCase()}`);
  };

  const handleColorModeChange = (event) => {
    const value = event.target.value;
    setCurrentColorMode(value);

    if (value === 'light') {
      setLightMode();
    } else if (value === 'dark') {
      setDarkMode();
    } else if (value === 'system') {
      setSystemColorMode();
    }
  };

  const handleSchemeChange = (event) => {
    const next = setScheme(event.target.value);
    setColorScheme(next);
    // Re-read, because arriving at Custom for the first time is exactly when the
    // pickers are handed a new pair to show.
    const custom = getCustomColors();
    setCustomColorsState(custom);
    // Hand the choice to the desktop addon, which is a different origin and so cannot
    // read this one's localStorage. Fire-and-forget: it is optional and usually absent,
    // and a picker must never wait on a local process (`utils/schemeSync.js`).
    syncSchemeToAddon({ scheme: next, custom });
  };

  const handleCustomColor = (role, value) => {
    const next = role === 'primary'
      ? setCustomColors(value, customColors.secondary)
      : setCustomColors(customColors.primary, value);
    setCustomColorsState(next);
    // The site's pair is `{ primary, secondary }`; `schemeSync` translates it into the
    // addon's token names. Only meaningful while Custom is the scheme in force.
    syncSchemeToAddon({ scheme: CUSTOM_SCHEME, custom: next });
  };

  const currentPlan = userSubscription?.subscriptionPlan || 'Free';
  const subscriptionDetails = userSubscription?.subscriptionDetails;
  const profileCreatedLabel = formatDateLabel(user?.createdAt);
  const accountAgeLabel = getAccountAgeLabel(user?.createdAt);
  const usageBreakdown = Array.isArray(userUsage?.usageBreakdown)
    ? [...userUsage.usageBreakdown].slice(-5).reverse()
    : [];
  const storageBreakdown = Array.isArray(userStorage?.storageBreakdown)
    ? userStorage.storageBreakdown.slice(0, 5)
    : [];
  const isRefreshingUsage = userUsageIsLoading || userStorageIsLoading;
  const planLabel = isProTier(currentPlan) ? 'Pro' : 'Free';
  const hasCustomPicture = Boolean(user?.profilePicture);

  if (dataIsLoading) {
    return <Spinner />;
  }

  if (user) {
    return (
      <>
        <Header />
        <div className="planit-profile-bg">
          <div className="floating-shapes">
            <div className="floating-circle floating-circle-1"></div>
            <div className="floating-circle floating-circle-2"></div>
            <div className="floating-circle floating-circle-3"></div>
          </div>

          <div className="planit-profile-shell">
            <section className="planit-profile-hero">
              <div className="planit-profile-hero-main">
                <button
                  type="button"
                  className="planit-profile-avatar"
                  onClick={() => goToSettings('photo')}
                  aria-label={hasCustomPicture ? 'Change profile picture' : 'Upload a profile picture'}
                  title="Change profile picture"
                >
                  <ProfileAvatar
                    picture={user.profilePicture}
                    name={user.nickname}
                    size="lg"
                  />
                  <span className="planit-profile-avatar-camera" aria-hidden="true">📷</span>
                </button>
                <div className="planit-profile-heading-copy">
                  <span className="planit-profile-eyebrow">Account hub</span>
                  <h1 className="planit-profile-heading-title">Welcome back, {user.nickname}!</h1>
                  <p className="planit-profile-heading-subtitle">
                    {planLabel} plan · Member since {profileCreatedLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="planit-profile-edit-button"
                  onClick={() => goToSettings('identity')}
                >
                  ✏️ Edit profile
                </button>
              </div>
            </section>

            {userUsage?.isSpecial && (
              <section className="planit-profile-special-banner" aria-live="polite">
                <span className="planit-profile-special-icon" aria-hidden="true">⭐</span>
                <div className="planit-profile-special-copy">
                  <span className="planit-profile-special-kicker">Admin selection</span>
                  <h2 className="planit-profile-special-title">You&apos;re a special member</h2>
                  <p className="planit-profile-special-text">
                    The site admin has hand-picked your account as a special member.
                    This unlocks unlimited AI credits — your AI usage is never capped
                    and nothing is deducted from your balance. Your regular plan,
                    storage, and all other limits stay exactly the same.
                  </p>
                </div>
              </section>
            )}

            <section className="planit-profile-content">
              <div className="planit-profile-layout">
                <div className="planit-profile-column">
                  <div className="planit-profile-section planit-profile-section-identity">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Identity</span>
                        <h2 className="planit-profile-section-title">Account information</h2>
                        <p className="planit-profile-section-hint">
                          Tap any field to change it in Settings.
                        </p>
                      </div>
                    </div>

                    <div className="planit-profile-info-grid">
                      <button
                        type="button"
                        className="planit-profile-info-item planit-profile-info-item-editable"
                        onClick={() => goToSettings('identity')}
                      >
                        <span className="planit-profile-info-label">👤 Profile name</span>
                        <span className="planit-profile-info-value">{user.nickname}</span>
                        <span className="planit-profile-info-chevron" aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        className="planit-profile-info-item planit-profile-info-item-editable"
                        onClick={() => goToSettings('identity')}
                      >
                        <span className="planit-profile-info-label">📧 Email</span>
                        <span className="planit-profile-info-value">{user.email || 'Not provided'}</span>
                        <span className="planit-profile-info-chevron" aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        className="planit-profile-info-item planit-profile-info-item-editable"
                        onClick={() => goToSettings('photo')}
                      >
                        <span className="planit-profile-info-label">🖼️ Profile picture</span>
                        <span className="planit-profile-info-value">
                          {hasCustomPicture ? 'Custom photo' : 'Default checkmark'}
                        </span>
                        <span className="planit-profile-info-chevron" aria-hidden="true">→</span>
                      </button>
                      <div className="planit-profile-info-item">
                        <span className="planit-profile-info-label">📅 Account created</span>
                        <span className="planit-profile-info-value">{profileCreatedLabel}</span>
                      </div>
                      <div className="planit-profile-info-item">
                        <span className="planit-profile-info-label">⏰ Account age</span>
                        <span className="planit-profile-info-value">{accountAgeLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="planit-profile-section planit-profile-section-privacy">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Public page</span>
                        <h2 className="planit-profile-section-title">Who can see your page</h2>
                        <p className="planit-profile-section-hint">
                          Your page lives at <code>{publicPagePath}</code>. It shows your picture,
                          the games you play and what you have published — never your email, your
                          plan or anything else private. Private is the default.
                        </p>
                      </div>
                    </div>

                    {/* Reuses the preferences grid's own control classes rather than
                        introducing a second select style on the same page. */}
                    <div className="planit-profile-setting-item">
                      <label className="planit-profile-setting-label" htmlFor="profile-visibility">
                        Who can open it
                      </label>
                      <select
                        id="profile-visibility"
                        className="planit-profile-setting-select"
                        value={visibility}
                        onChange={handleVisibilityChange}
                        disabled={savingVisibility}
                      >
                        <option value="private">Private — only you and your connections</option>
                        <option value="public">Public — anyone with the link</option>
                      </select>
                    </div>

                    <p className="planit-profile-privacy-status" aria-live="polite">
                      {savingVisibility
                        ? 'Saving…'
                        : visibility === 'public'
                          ? 'Anyone with the link can see your page.'
                          : 'Only you and the people you are connected with can see your page.'}
                    </p>

                    <Link className="planit-profile-section-link" to={publicPagePath}>
                      ↗ View your page
                    </Link>
                  </div>

                  <div className="planit-profile-section planit-profile-section-storage">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Storage</span>
                        <h2 className="planit-profile-section-title">Database storage</h2>
                      </div>
                    </div>

                    {userStorageIsLoading ? (
                      <div className="planit-profile-state">
                        <span className="planit-profile-state-icon">💾</span>
                        <div>
                          <strong>Loading storage details</strong>
                          <p>We&apos;re measuring the latest files and saved data totals.</p>
                        </div>
                      </div>
                    ) : userStorageIsError ? (
                      <div className="planit-profile-state planit-profile-state-error">
                        <span className="planit-profile-state-icon">⚠️</span>
                        <div>
                          <strong>Unable to load storage</strong>
                          <p>{userStorageMessage}</p>
                        </div>
                      </div>
                    ) : userStorage && typeof userStorage === 'object' ? (
                      <div className="planit-profile-usage-container">
                        <div className="planit-profile-usage-overview">
                          <div className="usage-stat">
                            <span className="usage-label">📊 Total used</span>
                            <span className="usage-value">{userStorage.totalStorageFormatted}</span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">🎯 Storage limit</span>
                            <span className="usage-value">{userStorage.storageLimitFormatted}</span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">📁 Total items</span>
                            <span className="usage-value">{userStorage.itemCount}</span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">📄 Files stored</span>
                            <span className="usage-value">{userStorage.fileCount}</span>
                          </div>
                        </div>

                        {userStorage.isOverLimit && (
                          <div className="credit-warning frozen">
                            <span className="warning-icon">🚨</span>
                            <div className="warning-content">
                              <strong>Storage limit exceeded</strong>
                              <p>You&apos;ve exceeded your storage limit. Delete items or upgrade to keep saving new data.</p>
                              {/* This one is a hard block — they cannot save new
                                  data. Hiding the button when purchases are
                                  paused would leave them with nothing to click
                                  and nobody to ask. §16.5 rule 6. */}
                              {!isProTier(userStorage.membership) && (
                                purchasesEnabled ? (
                                  <Link className="upgrade-button" to="/pay?plan=pro">
                                    Upgrade to Pro
                                  </Link>
                                ) : (
                                  <PurchaseGateNotice message={gateMessage} compact />
                                )
                              )}
                            </div>
                          </div>
                        )}

                        {userStorage.isNearLimit && !userStorage.isOverLimit && (
                          <div className="credit-warning low">
                            <span className="warning-icon">⚠️</span>
                            <div className="warning-content">
                              <strong>Storage nearly full</strong>
                              <p>You&apos;re using {userStorage.storageUsagePercent.toFixed(1)}% of your storage limit.</p>
                            </div>
                          </div>
                        )}

                        {userStorage.storageLimit && (
                          <div className="planit-profile-usage-bar">
                            <div className="usage-bar-track">
                              <div
                                className={`usage-bar-fill ${
                                  userStorage.storageUsagePercent >= 100 ? 'danger' :
                                  userStorage.storageUsagePercent >= 80 ? 'warning' :
                                  'normal'
                                }`}
                                style={{
                                  width: `${Math.min(userStorage.storageUsagePercent, 100)}%`
                                }}
                              ></div>
                            </div>
                            <div className="usage-bar-label">
                              {userStorage.storageUsagePercent.toFixed(1)}% used
                            </div>
                          </div>
                        )}

                        {storageBreakdown.length > 0 ? (
                          <div className="planit-profile-usage-breakdown">
                            <h3 className="usage-breakdown-title">Largest items</h3>
                            <div className="usage-breakdown-list">
                              {storageBreakdown.map((item, index) => (
                                <div key={index} className="usage-breakdown-item">
                                  <div className="usage-api-info">
                                    <span className="api-name">
                                      {item.hasFiles ? '📎 File data' : '📝 Text data'}
                                    </span>
                                    <span className="api-date">
                                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Unknown date'}
                                    </span>
                                  </div>
                                  <div className="usage-details">
                                    <span className="usage-amount">
                                      {item.fileCount > 0 ? `${item.fileCount} files` : 'Text only'}
                                    </span>
                                    <span className="usage-cost">{item.sizeFormatted}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="planit-profile-state">
                            <span className="planit-profile-state-icon">🗂️</span>
                            <div>
                              <strong>No large items to highlight</strong>
                              <p>As you add more saved data, we&apos;ll surface the biggest entries here.</p>
                            </div>
                          </div>
                        )}

                        {!isProTier(userStorage.membership) && userStorage.storageUsagePercent > 50 && (
                          <div className="planit-profile-upgrade-prompt">
                            <div className="upgrade-message">
                              <span className="upgrade-icon">💾</span>
                              <div className="upgrade-text">
                                <strong>Need more storage?</strong>
                                <p>Pro membership includes {STORAGE_DISPLAY[PLAN_IDS.PRO]} of storage for all your data and files.</p>
                              </div>
                            </div>
                            {/* The offer stays legible while the gate is on —
                                only the way to act on it changes. */}
                            {purchasesEnabled ? (
                              <Link className="upgrade-button" to="/pay?plan=pro">
                                Upgrade Now
                              </Link>
                            ) : (
                              <PurchaseGateNotice message={gateMessage} compact />
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="planit-profile-state">
                        <span className="planit-profile-state-icon">📦</span>
                        <div>
                          <strong>Storage summary unavailable</strong>
                          <p>
                            Your current plan includes{' '}
                            {isProTier(currentPlan) ? STORAGE_DISPLAY[PLAN_IDS.PRO] : STORAGE_DISPLAY[PLAN_IDS.FREE]} of storage.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="planit-profile-column">
                  <div className="planit-profile-section planit-profile-section-preferences">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Experience</span>
                        <h2 className="planit-profile-section-title">Preferences</h2>
                      </div>
                      <button
                        type="button"
                        className="planit-profile-section-link"
                        onClick={() => goToSettings('appearance')}
                      >
                        More in Settings →
                      </button>
                    </div>

                    <div className="planit-profile-settings-grid">
                      <div className="planit-profile-setting-item">
                        <label className="planit-profile-setting-label" htmlFor="planit-profile-theme-mode">Theme mode</label>
                        <select
                          id="planit-profile-theme-mode"
                          value={currentColorMode}
                          onChange={handleColorModeChange}
                          className="planit-profile-setting-select"
                        >
                          <option value="light">☀️ Light</option>
                          <option value="dark">🌙 Dark</option>
                          <option value="system">💻 System</option>
                        </select>
                      </div>

                      {/* Deliberately beside Theme mode: they are the same kind of choice,
                          and they are independent. Mode is how LIGHT the surface is;
                          scheme is WHICH hues sit on it — every scheme has both a light
                          and a dark version, so neither locks the other.
                          No swatches, on purpose: the page repaints the moment this
                          changes, so the backdrop behind this control is the preview. */}
                      <div className="planit-profile-setting-item">
                        <label className="planit-profile-setting-label" htmlFor="planit-profile-scheme">Color scheme</label>
                        <select
                          id="planit-profile-scheme"
                          value={colorScheme}
                          onChange={handleSchemeChange}
                          className="planit-profile-setting-select"
                        >
                          {SCHEMES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                          <option value={CUSTOM_SCHEME}>🎨 Custom</option>
                        </select>
                      </div>

                      {/* The pickers exist only while Custom is the chosen scheme, so
                          the grid never carries two controls that do nothing on any
                          other setting. Choosing Custom with nothing stored SEEDS the
                          pair from the scheme being replaced (see `setScheme`), so they
                          open on the colours already on screen.

                          ⚠️ The labels are the visitor's words, not the tokens':
                          "Primary" is `--scheme-accent` (the dominant hue — links,
                          interaction, the room) and "Secondary" is `--scheme-primary`
                          (the partner hue). That mapping is made once, in
                          `utils/scheme.js`, and must not be remade here. */}
                      {colorScheme === CUSTOM_SCHEME && (
                        <>
                          <div className="planit-profile-setting-item">
                            <label className="planit-profile-setting-label" htmlFor="planit-profile-scheme-primary">Primary color</label>
                            <input
                              type="color"
                              id="planit-profile-scheme-primary"
                              className="planit-profile-setting-color"
                              value={customColors.primary}
                              onChange={(e) => handleCustomColor('primary', e.target.value)}
                            />
                          </div>
                          <div className="planit-profile-setting-item">
                            <label className="planit-profile-setting-label" htmlFor="planit-profile-scheme-secondary">Secondary color</label>
                            <input
                              type="color"
                              id="planit-profile-scheme-secondary"
                              className="planit-profile-setting-color"
                              value={customColors.secondary}
                              onChange={(e) => handleCustomColor('secondary', e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      <div className="planit-profile-setting-item">
                        <label className="planit-profile-setting-label" htmlFor="planit-profile-subscription-plan">Subscription plan</label>
                        <select
                          id="planit-profile-subscription-plan"
                          value={currentPlan}
                          onChange={handleSubscriptionChange}
                          className="planit-profile-setting-select"
                        >
                          <option value="Free">🆓 Free Plan</option>
                          <option value="Pro" disabled={!purchasesEnabled}>⚡ Pro Plan</option>
                        </select>
                      </div>
                    </div>

                    {!purchasesEnabled && (
                      <PurchaseGateNotice message={gateMessage} compact />
                    )}

                    {subscriptionDetails ? (
                      <div className="planit-profile-subscription-details">
                        <div>
                          <span className="planit-profile-info-label">Active membership</span>
                          <div className="planit-profile-subscription-product">{subscriptionDetails.productName}</div>
                        </div>
                        <span className="planit-profile-subscription-renewal">
                          Renews on {formatDateLabel(subscriptionDetails.currentPeriodEnd)}
                        </span>
                      </div>
                    ) : (
                      <div className="planit-profile-state">
                        <span className="planit-profile-state-icon">✨</span>
                        <div>
                          <strong>Free plan ready to go</strong>
                          <p>Upgrade for more storage, live phone screen viewing, and email support.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="planit-profile-section planit-profile-section-usage">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Activity</span>
                        <h2 className="planit-profile-section-title">Usage &amp; credits</h2>
                      </div>
                      <button
                        onClick={refreshUsageData}
                        className="planit-profile-refresh-button"
                        title="Refresh usage and storage data"
                        disabled={isRefreshingUsage}
                      >
                        {isRefreshingUsage ? '⏳ Refreshing' : '🔄 Refresh'}
                      </button>
                    </div>

                    {userUsageIsLoading ? (
                      <div className="planit-profile-state">
                        <span className="planit-profile-state-icon">⏳</span>
                        <div>
                          <strong>Refreshing usage details</strong>
                          <p>Your latest usage will appear here in a moment.</p>
                        </div>
                      </div>
                    ) : userUsageIsError ? (
                      <div className="planit-profile-state planit-profile-state-error">
                        <span className="planit-profile-state-icon">⚠️</span>
                        <div>
                          <strong>Unable to load usage</strong>
                          <p>{userUsageMessage}</p>
                        </div>
                      </div>
                    ) : userUsage && typeof userUsage === 'object' ? (
                      <div className="planit-profile-usage-container">
                        <div className="planit-profile-usage-overview">
                          <div className="usage-stat">
                            <span className="usage-label">🎯 Plan</span>
                            <span className="usage-value">{userUsage.membership || 'Free'}</span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">⚡ Automation commands</span>
                            <span className="usage-value">
                              {isProTier(userUsage.membership) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]}
                            </span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">🔑 AI credits</span>
                            <span className="usage-value">
                              {userUsage.isAdmin || userUsage.isSpecial
                                ? 'Unlimited'
                                : userUsage.limit > 0
                                  ? `$${(userUsage.availableCredits || 0).toFixed(2)} of $${userUsage.limit.toFixed(2)} left`
                                  : 'No credits'}
                            </span>
                          </div>
                        </div>

                        {usageBreakdown.length > 0 ? (
                          <div className="planit-profile-usage-breakdown">
                            <h3 className="usage-breakdown-title">Recent usage</h3>
                            <div className="usage-breakdown-list">
                              {usageBreakdown.map((entry, index) => (
                                <div key={index} className="usage-breakdown-item">
                                  <div className="usage-api-info">
                                    <span className="api-name">
                                      {USAGE_API_LABELS[entry.api] || `🔧 ${providerLabel(entry.api)}`}
                                    </span>
                                    <span className="api-date">{entry.fullDate}</span>
                                  </div>
                                  <div className="usage-details">
                                    <span className="usage-amount">{entry.usage}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="planit-profile-state">
                            <span className="planit-profile-state-icon">📭</span>
                            <div>
                              <strong>No recent usage yet</strong>
                              <p>Once you start using automation tools, the latest entries will show up here.</p>
                            </div>
                          </div>
                        )}

                        {userUsage.membership === 'Free' && (
                          <div className="planit-profile-upgrade-prompt">
                            <div className="upgrade-message">
                              <span className="upgrade-icon">🚀</span>
                              <div className="upgrade-text">
                                <strong>Upgrade to Pro</strong>
                                  <p>{STORAGE_DISPLAY[PLAN_IDS.PRO]} storage + live phone viewing + email support.</p>
                              </div>
                            </div>
                            {purchasesEnabled ? (
                              <Link className="upgrade-button" to="/pay?plan=pro">
                                Upgrade Now
                              </Link>
                            ) : (
                              <PurchaseGateNotice message={gateMessage} compact />
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="planit-profile-state">
                        <span className="planit-profile-state-icon">📊</span>
                        <div>
                          <strong>Usage summary unavailable</strong>
                          <p>
                            Your plan still includes{' '}
                            {isProTier(currentPlan) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]} of automation commands.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </section>

            <section className="planit-profile-actions">
              <div className="planit-profile-actions-copy">
                <span className="planit-profile-section-kicker">Next steps</span>
                <h2 className="planit-profile-actions-title">Keep your workspace tuned up</h2>
              </div>
              <div className="planit-profile-actions-buttons">
                <button className="planit-profile-edit-button planit-profile-edit-button-solid" onClick={navigateToSettings}>
                  ✏️ Edit profile
                </button>
                {/* The public page a stranger can see. `/u/<username>` is built in
                    one place (`profilePath`) so a link can never disagree with the
                    route about how a nickname is encoded. */}
                {user.nickname && (
                  <Link className="planit-profile-net-button" to={profilePath(user.nickname)}>
                    ↗ View public page
                  </Link>
                )}
                <button className="planit-profile-net-button" onClick={() => navigate('/talk')}>
                  💬 Talk
                </button>
                <button className="planit-profile-net-button" onClick={() => navigate('/net')}>
                  💬 Open AI Chat
                </button>
                <button className="planit-profile-settings-button" onClick={() => navigate('/simple')}>
                  🎛️ Control center
                </button>
                <button className="planit-profile-logout-button" onClick={onLogout}>
                  🚪 Sign Out
                </button>
              </div>
            </section>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return null;
}

export default Profile;
