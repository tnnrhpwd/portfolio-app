import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice, getUserSubscription, getUserUsage, getUserStorage } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import { isTokenValid } from '../../utils/tokenUtils.js';
import { toast } from 'react-toastify';
import {
  PLAN_IDS, QUOTA_SHORT, STORAGE_DISPLAY,
  isProTier,
} from '../../constants/pricing.js';
import usePurchaseGate from '../../hooks/usePurchaseGate.js';
import './Profile.css';
import HeaderLogo from '../../../src/assets/Checkmark512.png';

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
    const body = document.body;
    if (body.classList.contains('dark-theme')) {
      setCurrentColorMode('dark');
    } else if (body.classList.contains('light-theme')) {
      setCurrentColorMode('light');
    } else {
      setCurrentColorMode('system');
    }

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
  const themeModeLabel = currentColorMode === 'system'
    ? 'System'
    : `${currentColorMode.charAt(0).toUpperCase()}${currentColorMode.slice(1)}`;

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
                <div className="planit-profile-avatar">
                  <img src={HeaderLogo} alt="Profile Avatar" className="profile-picture" />
                </div>
                <div className="planit-profile-heading-copy">
                  <span className="planit-profile-eyebrow">Account hub</span>
                  <h1 className="planit-profile-heading-title">Welcome back, {user.nickname}!</h1>
                </div>
              </div>
            </section>

            <section className="planit-profile-content">
              <div className="planit-profile-layout">
                  <div className="planit-profile-section planit-profile-section-identity">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Identity</span>
                        <h2 className="planit-profile-section-title">Account information</h2>
                      </div>
                    </div>

                    <div className="planit-profile-info-grid">
                      <div className="planit-profile-info-item">
                        <span className="planit-profile-info-label">👤 Profile name</span>
                        <span className="planit-profile-info-value">{user.nickname}</span>
                      </div>
                      <div className="planit-profile-info-item">
                        <span className="planit-profile-info-label">📧 Email</span>
                        <span className="planit-profile-info-value">{user.email || 'Not provided'}</span>
                      </div>
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

                  <div className="planit-profile-section planit-profile-section-preferences">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Experience</span>
                        <h2 className="planit-profile-section-title">Preferences</h2>
                      </div>
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
                        {!purchasesEnabled && (
                          <span className="planit-profile-setting-hint">
                            {gateMessage || 'Upgrading is temporarily paused. Please check back soon.'}
                          </span>
                        )}
                      </div>
                    </div>

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
                          <p>Upgrade whenever you want more quota, storage, and premium automation controls.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="planit-profile-section planit-profile-section-usage">
                    <div className="planit-profile-section-header">
                      <div>
                        <span className="planit-profile-section-kicker">Activity</span>
                        <h2 className="planit-profile-section-title">Usage &amp; quota</h2>
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
                          <p>Your latest quota activity will appear here in a moment.</p>
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
                            <span className="usage-label">⚡ Automation quota</span>
                            <span className="usage-value">
                              {isProTier(userUsage.membership) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]}
                            </span>
                          </div>
                          <div className="usage-stat">
                            <span className="usage-label">🔑 AI usage</span>
                            <span className="usage-value">Bring Your Own Key</span>
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
                                      {entry.api === 'bedrock' && '☁️ AWS Bedrock'}
                                      {(entry.api === 'openai' || entry.api === 'github') && '🤖 GitHub Models (legacy)'}
                                      {entry.api === 'rapidword' && '📝 Word Generator'}
                                      {entry.api === 'rapiddef' && '📚 Dictionary'}
                                      {!['bedrock', 'openai', 'github', 'rapidword', 'rapiddef'].includes(entry.api) && `🔧 ${entry.api}`}
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

                        {userUsage.membership === 'Free' && purchasesEnabled && (
                          <div className="planit-profile-upgrade-prompt">
                            <div className="upgrade-message">
                              <span className="upgrade-icon">🚀</span>
                              <div className="upgrade-text">
                                <strong>Upgrade to Pro</strong>
                                  <p>{STORAGE_DISPLAY[PLAN_IDS.PRO]} storage + live phone viewing + email support.</p>
                              </div>
                            </div>
                            <button
                              className="upgrade-button"
                              onClick={() => navigate('/pay?plan=pro')}
                            >
                              Upgrade Now
                            </button>
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
                            {isProTier(currentPlan) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]} of automation quota.
                          </p>
                        </div>
                      </div>
                    )}
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
                              {!isProTier(userStorage.membership) && purchasesEnabled && (
                                <button
                                  className="upgrade-button"
                                  onClick={() => navigate('/pay?plan=pro')}
                                >
                                  Upgrade to Pro
                                </button>
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

                        {!isProTier(userStorage.membership) && userStorage.storageUsagePercent > 50 && purchasesEnabled && (
                          <div className="planit-profile-upgrade-prompt">
                            <div className="upgrade-message">
                              <span className="upgrade-icon">💾</span>
                              <div className="upgrade-text">
                                <strong>Need more storage?</strong>
                                <p>Pro membership includes 50 GB of storage for all your data and files.</p>
                              </div>
                            </div>
                            <button
                              className="upgrade-button"
                              onClick={() => navigate('/pay?plan=pro')}
                            >
                              Upgrade Now
                            </button>
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
            </section>

            <section className="planit-profile-actions">
              <div className="planit-profile-actions-copy">
                <span className="planit-profile-section-kicker">Next steps</span>
                <h2 className="planit-profile-actions-title">Keep your workspace tuned up</h2>
                <p className="planit-profile-actions-description">
                  Jump into chat, manage deeper settings, or sign out when you&apos;re done.
                </p>
              </div>
              <div className="planit-profile-actions-buttons">
                <button className="planit-profile-net-button" onClick={() => navigate('/net')}>
                  🤖 Open AI Chat
                </button>
                <button className="planit-profile-settings-button" onClick={navigateToSettings}>
                  ⚙️ Advanced Settings
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
