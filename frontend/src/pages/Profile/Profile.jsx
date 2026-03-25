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
  isProTier, isSimpleTier,
} from '../../constants/pricing.js';
import './Profile.css';
import HeaderLogo from '../../../src/assets/Checkmark512.png';

function Profile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [currentColorMode, setCurrentColorMode] = useState('system');
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [userSubscription, setUserSubscription] = useState(null);

  // Get user data from Redux state
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

  // Theme detection effect
  useEffect(() => {
    // Detect current theme on component mount
    const html = document.querySelector('html');
    if (html.classList.contains('dark')) {
      setCurrentColorMode('dark');
    } else if (html.classList.contains('light')) {
      setCurrentColorMode('light');
    } else {
      setCurrentColorMode('system');
    }
    
    // Simple auth check - no user means redirect to login immediately
    if (!user) {
      navigate('/login');
      return;
    }

    return () => {
      // Don't reset the entire data slice - this was causing userUsage to be cleared
      // dispatch(resetDataSlice());
    };
  }, [user, navigate, dispatch]);

  // Only fetch subscription data once when component mounts
  useEffect(() => {
    if (user && !subscriptionLoaded) {
      // Check if token is valid using utility function
      if (!user.token || !isTokenValid(user.token)) {
        // Session expired - logout first, then navigate
        dispatch(logout());
        // Use setTimeout to ensure logout completes before navigation
        setTimeout(() => {
          navigate('/login', { state: { sessionExpired: true } });
        }, 100);
        return;
      }
      
      // Use a local try-catch to prevent the component from crashing
      try {
        dispatch(getUserSubscription())
          .unwrap()
          .then((subscriptionData) => {
            setUserSubscription(subscriptionData);
            setSubscriptionLoaded(true);
          })
          .catch((error) => {
            // If it's an authentication error, redirect to login
            if (error.includes('Not authorized') || error.includes('token expired')) {
              dispatch(logout());
              // Use setTimeout to ensure logout completes before navigation
              setTimeout(() => {
                navigate('/login', { state: { sessionExpired: true } });
              }, 100);
            } else {
              // For other errors, just mark as loaded and set default subscription
              setUserSubscription({ subscriptionPlan: 'Free', subscriptionDetails: null });
              setSubscriptionLoaded(true);
            }
          });

        // Fetch usage data
        dispatch(getUserUsage())
          .unwrap()
          .catch((error) => {
            console.error('Failed to fetch usage data:', error);
          });

        // Fetch storage data
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

  // Add refresh handler
  const refreshUsageData = () => {
    if (user && user.token && isTokenValid(user.token)) {
      // Refresh usage data
      dispatch(getUserUsage())
        .unwrap()
        .catch((error) => {
          console.error('Failed to refresh usage data:', error);
        });

      // Refresh storage data
      dispatch(getUserStorage())
        .unwrap()
        .catch((error) => {
          console.error('Failed to refresh storage data:', error);
        });

      toast.success('Data refreshed!', { autoClose: 2000 });
    }
  };

  // Rest of handlers
  const onLogout = () => {
    setSubscriptionLoaded(false); // Reset subscription loaded state
    dispatch(logout());
    dispatch(resetDataSlice());
    navigate('/');
  };

  const navigateToSettings = () => {
    navigate('/settings');
  };

  const handleSubscriptionChange = (event) => {
    const newPlan = event.target.value;
    
    // Check if the user is trying to select their current plan
    if (newPlan.toLowerCase() === (userSubscription?.subscriptionPlan || 'Free').toLowerCase()) {
      // If selecting current plan, just ignore the selection and reset dropdown
      // This prevents the error message from showing
      event.target.value = userSubscription?.subscriptionPlan || 'Free';
      return;
    }
    
    // Navigate to the pay page with the selected plan as a URL parameter
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

  // Use the local state for subscription details
  const currentPlan = userSubscription?.subscriptionPlan || 'Free';
  const subscriptionDetails = userSubscription?.subscriptionDetails;

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
          <div className="planit-profile-card">
            <section className="planit-profile-heading">
              <div className="planit-profile-avatar">
                <img src={HeaderLogo} alt="Profile Avatar" className="profile-picture" />
              </div>
              <div className="planit-profile-heading-title">Welcome back, {user.nickname}!</div>
              <div className="planit-profile-heading-description">Manage your account settings and preferences</div>
            </section>
            
            <section className="planit-profile-content">
              <div className="planit-profile-section">
                <h3 className="planit-profile-section-title">Account Information</h3>
                <div className="planit-profile-info-grid">
                  <div className="planit-profile-info-item">
                    <span className="planit-profile-info-label">👤 Profile Name</span>
                    <span className="planit-profile-info-value">{user.nickname}</span>
                  </div>
                  <div className="planit-profile-info-item">
                    <span className="planit-profile-info-label">📧 Email</span>
                    <span className="planit-profile-info-value">{user.email || 'Not provided'}</span>
                  </div>
                  <div className="planit-profile-info-item">
                    <span className="planit-profile-info-label">📅 Account Created</span>
                    <span className="planit-profile-info-value">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                  <div className="planit-profile-info-item planit-profile-age-info">
                    <span className="planit-profile-info-label">⏰ Account Age</span>
                    <span className="planit-profile-info-value">
                      {user.createdAt ? (() => {
                        const birthDate = new Date(user.createdAt);
                        const now = new Date();
                        const diffTime = Math.abs(now - birthDate);
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        const diffMonths = Math.floor(diffDays / 30.44); // Average days per month
                        const diffYears = Math.floor(diffDays / 365.25); // Account for leap years
                        
                        if (diffYears > 0) {
                          const remainingMonths = Math.floor((diffDays % 365.25) / 30.44);
                          return `${diffYears} year${diffYears !== 1 ? 's' : ''}${remainingMonths > 0 ? `, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}` : ''}`;
                        } else if (diffMonths > 0) {
                          return `${diffMonths} month${diffMonths !== 1 ? 's' : ''}`;
                        } else if (diffDays > 0) {
                          return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
                        } else {
                          const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
                          return diffHours > 0 ? `${diffHours} hour${diffHours !== 1 ? 's' : ''}` : 'Just created';
                        }
                      })() : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="planit-profile-section">
                <h3 className="planit-profile-section-title">Preferences</h3>
                <div className="planit-profile-settings-grid">
                  <div className="planit-profile-setting-item">
                    <label className="planit-profile-setting-label">Theme Mode</label>
                    <select 
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
                    <label className="planit-profile-setting-label">Subscription Plan</label>
                    <select 
                      value={currentPlan} 
                      onChange={handleSubscriptionChange}
                      className="planit-profile-setting-select"
                    >
                      <option value="Free">🆓 Free Plan</option>
                      <option value="Pro">⚡ Pro Plan</option>
                    </select>
                  </div>
                </div>
                
                {subscriptionDetails && (
                  <div className="planit-profile-subscription-details">
                    <div className="subscription-info">
                      <span className="subscription-product">{subscriptionDetails.productName}</span>
                      <span className="subscription-renewal">
                        Renews on {new Date(subscriptionDetails.currentPeriodEnd).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="planit-profile-section">
                <h3 className="planit-profile-section-title">
                  Usage & Quota
                  <button 
                    onClick={refreshUsageData}
                    className="planit-profile-refresh-button"
                    title="Refresh usage and storage data"
                  >
                    🔄 <span className="refresh-text">Refresh</span>
                  </button>
                </h3>
                {userUsageIsLoading ? (
                  <div className="planit-profile-usage-loading">Loading usage data...</div>
                ) : userUsageIsError ? (
                  <div className="planit-profile-usage-error">
                    Error loading usage data: {userUsageMessage}
                  </div>
                ) : userUsage && typeof userUsage === 'object' ? (
                  <div className="planit-profile-usage-container">
                    <div className="planit-profile-usage-overview">
                      <div className="usage-stat">
                        <span className="usage-label">🎯 Plan</span>
                        <span className="usage-value">{userUsage?.membership || 'Free'}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">⚡ Automation Quota</span>
                        <span className="usage-value">
                          {isProTier(userUsage?.membership) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]}
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">🔑 AI Usage</span>
                        <span className="usage-value">Bring Your Own Key</span>
                      </div>
                    </div>

                    {userUsage.usageBreakdown && userUsage.usageBreakdown.length > 0 && (
                      <div className="planit-profile-usage-breakdown">
                        <h4 className="usage-breakdown-title">Recent Usage</h4>
                        <div className="usage-breakdown-list">
                          {userUsage.usageBreakdown.slice(-5).map((entry, index) => (
                            <div key={index} className="usage-breakdown-item">
                              <div className="usage-api-info">
                                <span className="api-name">
                                  {(entry.api === 'openai' || entry.api === 'github') && '🤖 GitHub Models'}
                                  {entry.api === 'rapidword' && '📝 Word Generator'}
                                  {entry.api === 'rapiddef' && '📚 Dictionary'}
                                  {!['openai', 'github', 'rapidword', 'rapiddef'].includes(entry.api) && `🔧 ${entry.api}`}
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
                    )}

                    {userUsage.membership === 'Free' && (
                      <div className="planit-profile-upgrade-prompt">
                        <div className="upgrade-message">
                          <span className="upgrade-icon">🚀</span>
                          <div className="upgrade-text">
                            <strong>Upgrade to Pro</strong>
                            <p>{QUOTA_SHORT[PLAN_IDS.PRO]} + {STORAGE_DISPLAY[PLAN_IDS.PRO]} storage + phone control!</p>
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
                  <div className="planit-profile-usage-placeholder">
                    <div className="usage-stat">
                      <span className="usage-label">⚡ Automation Quota</span>
                      <span className="usage-value">
                        {isProTier(currentPlan) ? QUOTA_SHORT[PLAN_IDS.PRO] : QUOTA_SHORT[PLAN_IDS.FREE]}
                      </span>
                    </div>
                    <div className="usage-stat">
                      <span className="usage-label">🔑 AI Usage</span>
                      <span className="usage-value">Bring Your Own Key</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="planit-profile-section">
                <h3 className="planit-profile-section-title">💾 Database Storage</h3>
                {userStorageIsLoading ? (
                  <div className="planit-profile-usage-loading">Loading storage data...</div>
                ) : userStorageIsError ? (
                  <div className="planit-profile-usage-error">
                    Error loading storage data: {userStorageMessage}
                  </div>
                ) : userStorage && typeof userStorage === 'object' ? (
                  <div className="planit-profile-storage-container">
                    <div className="planit-profile-usage-overview">
                      <div className="usage-stat">
                        <span className="usage-label">📊 Total Used</span>
                        <span className="usage-value">{userStorage.totalStorageFormatted}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">🎯 Storage Limit</span>
                        <span className="usage-value">{userStorage.storageLimitFormatted}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">📁 Total Items</span>
                        <span className="usage-value">{userStorage.itemCount}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">📄 Files Stored</span>
                        <span className="usage-value">{userStorage.fileCount}</span>
                      </div>
                    </div>

                    {/* Storage warnings */}
                    {userStorage.isOverLimit && (
                      <div className="credit-warning frozen">
                        <span className="warning-icon">🚨</span>
                        <div className="warning-content">
                          <strong>Storage Limit Exceeded</strong>
                          <p>You've exceeded your storage limit. Delete some items or upgrade to continue storing data.</p>
                          {!isProTier(userStorage.membership) && (
                            <button 
                              className="upgrade-premium-button"
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
                          <strong>Storage Nearly Full</strong>
                          <p>You're using {userStorage.storageUsagePercent.toFixed(1)}% of your storage limit.</p>
                        </div>
                      </div>
                    )}

                    {/* Storage usage bar */}
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
                          {userStorage.storageUsagePercent.toFixed(1)}% Used
                        </div>
                      </div>
                    )}

                    {/* Storage breakdown */}
                    {userStorage.storageBreakdown && userStorage.storageBreakdown.length > 0 && (
                      <div className="planit-profile-usage-breakdown">
                        <h4 className="usage-breakdown-title">Largest Items</h4>
                        <div className="usage-breakdown-list">
                          {userStorage.storageBreakdown.slice(0, 5).map((item, index) => (
                            <div key={index} className="usage-breakdown-item">
                              <div className="usage-api-info">
                                <span className="api-name">
                                  {item.hasFiles ? '📎 File Data' : '📝 Text Data'}
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
                    )}

                    {/* Storage upgrade prompt for non-Simple users */}
                    {!isProTier(userStorage.membership) && userStorage.storageUsagePercent > 50 && (
                      <div className="planit-profile-upgrade-prompt">
                        <div className="upgrade-message">
                          <span className="upgrade-icon">💾</span>
                          <div className="upgrade-text">
                            <strong>Need More Storage?</strong>
                            <p>Pro membership includes 50 GB of storage for all your data and files!</p>
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
                  <div className="planit-profile-usage-placeholder">
                    <div className="usage-stat">
                      <span className="usage-label">📊 Total Used</span>
                      <span className="usage-value">0 B</span>
                    </div>
                    <div className="usage-stat">
                      <span className="usage-label">🎯 Storage Limit</span>
                      <span className="usage-value">
                        {isProTier(currentPlan) ? STORAGE_DISPLAY[PLAN_IDS.PRO] : 
                         STORAGE_DISPLAY[PLAN_IDS.FREE]}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
            
            <section className="planit-profile-actions">
              <button className="planit-profile-net-button" onClick={() => navigate('/net')}>
                🤖 Open AI Chat
              </button>
              <button className="planit-profile-settings-button" onClick={navigateToSettings}>
                ⚙️ Advanced Settings
              </button>
              <button className="planit-profile-logout-button" onClick={onLogout}>
                🚪 Sign Out
              </button>
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