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
  CREDITS, PLAN_IDS, QUOTA_SHORT, STORAGE_DISPLAY,
  isProTier, isSimpleTier, getCreditDisplay, getDefaultCreditLimit,
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
          .then((usageData) => {
            
            // Show warning toast based on available credits
            if (usageData && !isSimpleTier(usageData.membership) && usageData.availableCredits !== undefined) {
              const availableCredits = Number(usageData.availableCredits);
              const membershipLimit = isProTier(usageData.membership) ? CREDITS[PLAN_IDS.PRO].monthlyLimit : 0;
              
              if (availableCredits <= 0.05 && membershipLimit > 0) {
                toast.warning('🚨 API credits nearly depleted! Consider upgrading to Simple for unlimited usage.', {
                  position: 'top-right',
                  autoClose: 8000,
                  hideProgressBar: false,
                  closeOnClick: true,
                  pauseOnHover: true,
                });
              } else if (availableCredits <= 0.15 && membershipLimit > 0) {
                toast.info('⚠️ API credits running low. Keep an eye on your remaining balance!', {
                  position: 'top-right',
                  autoClose: 6000,
                  hideProgressBar: false,
                  closeOnClick: true,
                  pauseOnHover: true,
                });
              }
            }
          })
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
                      <option value="Simple">👑 Simple Plan</option>
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
                  API Credits & Usage
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
                ) : userUsage && typeof userUsage === 'object' && ('availableCredits' in userUsage || 'totalUsage' in userUsage) ? (
                  <div className="planit-profile-usage-container">
                    <div className="planit-profile-usage-overview">
                      <div className="usage-stat">
                        <span className="usage-label">� Available Credits</span>
                        <span className="usage-value">
                          {user?._id === '6770a067c725cbceab958619' ? 
                            '∞ (Unlimited)' : 
                            userUsage?.availableCredits !== undefined ? 
                              `$${Number(userUsage.availableCredits).toFixed(4)}` : 
                              '$0.0000'
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">🎯 Monthly Limit</span>
                        <span className="usage-value">
                          {user?._id === '6770a067c725cbceab958619' ? 
                            '∞ (Admin)' : 
                            isSimpleTier(userUsage?.membership) ? 
                              `$${userUsage?.customLimit !== undefined ? Number(userUsage.customLimit).toFixed(2) : CREDITS[PLAN_IDS.SIMPLE].defaultLimit.toFixed(2)}` : 
                              getCreditDisplay(userUsage?.membership || 'Free')
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">� Usage This Month</span>
                        <span className="usage-value">
                          ${userUsage?.totalUsage !== undefined ? 
                            Number(userUsage.totalUsage).toFixed(4) : 
                            '0.0000'
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">� Next Reset</span>
                        <span className="usage-value">
                          {userUsage?.nextReset ? 
                            new Date(userUsage.nextReset).toLocaleDateString() : 
                            new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString()
                          }
                        </span>
                      </div>
                    </div>
                    
                    {/* Credit Status Warnings */}
                    {userUsage?.availableCredits !== undefined && (
                      <div className="planit-profile-credit-status">
                        {userUsage.availableCredits <= 0 && isProTier(userUsage.membership) && (
                          <div className="credit-warning frozen">
                            <span className="warning-icon">🚨</span>
                            <div className="warning-content">
                              <strong>Usage Frozen</strong>
                              <p>Your Pro membership has no remaining credits. API usage is frozen until next month or upgrade to Simple for unlimited usage.</p>
                              <button 
                                className="upgrade-premium-button"
                                onClick={() => navigate('/pay?plan=simple')}
                              >
                                Upgrade to Simple
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {userUsage.availableCredits <= 0 && isSimpleTier(userUsage.membership) && (
                          <div className="credit-warning premium-empty">
                            <span className="warning-icon">⚠️</span>
                            <div className="warning-content">
                              <strong>Credits Depleted</strong>
                              <p>Your Simple plan limit has been reached. Increase your limit to continue API usage.</p>
                            </div>
                          </div>
                        )}
                        
                        {userUsage.availableCredits > 0 && userUsage.availableCredits <= 0.10 && (
                          <div className="credit-warning low">
                            <span className="warning-icon">🔔</span>
                            <div className="warning-content">
                              <strong>Credits Running Low</strong>
                              <p>You have ${userUsage.availableCredits.toFixed(4)} remaining. 
                                {isProTier(userUsage.membership)
                                  ? ' Consider upgrading to Simple for unlimited usage.' 
                                  : ' Consider increasing your Simple limit.'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Simple Custom Limit Setting */}
                    {isSimpleTier(userUsage?.membership) && (
                      <div className="planit-profile-custom-limit">
                        <h4 className="custom-limit-title">💎 Simple Custom Limit</h4>
                        <div className="custom-limit-controls">
                          <input 
                            type="number" 
                            step={CREDITS[PLAN_IDS.SIMPLE].minLimit} 
                            min={CREDITS[PLAN_IDS.SIMPLE].minLimit} 
                            placeholder="Enter custom limit" 
                            className="custom-limit-input"
                            id="customLimitInput"
                          />
                          <button 
                            className="custom-limit-button"
                            onClick={async () => {
                              const input = document.getElementById('customLimitInput');
                              const newLimit = parseFloat(input.value);
                              if (newLimit && newLimit >= CREDITS[PLAN_IDS.SIMPLE].minLimit) {
                                try {
                                  const token = localStorage.getItem('token');
                                  const response = await fetch('/api/data/custom-limit', {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ customLimit: newLimit })
                                  });
                                  
                                  const result = await response.json();
                                  
                                  if (result.success) {
                                    toast.success(`✅ ${result.message}`);
                                    input.value = ''; // Clear input
                                    // Refresh usage data to show updated credits
                                    setTimeout(() => {
                                      dispatch(getUserUsage());
                                    }, 1000);
                                  } else {
                                    toast.error(`❌ ${result.message || 'Failed to set custom limit'}`);
                                  }
                                } catch (error) {
                                  console.error('Error setting custom limit:', error);
                                  toast.error('❌ Network error. Please try again.');
                                }
                              } else {
                                toast.error(`Please enter a valid limit (minimum $${CREDITS[PLAN_IDS.SIMPLE].minLimit.toFixed(2)})`);
                              }
                            }}
                          >
                            Set Limit
                          </button>
                        </div>
                        <div className="custom-limit-info">
                          <small>Current limit: ${userUsage?.customLimit !== undefined ? Number(userUsage.customLimit).toFixed(2) : CREDITS[PLAN_IDS.SIMPLE].defaultLimit.toFixed(2)}</small>
                          <small>You'll be charged for any limit increases immediately.</small>
                        </div>
                      </div>
                    )}

                    {/* Credit Usage Bar */}
                    {userUsage?.availableCredits !== undefined && userUsage?.membership !== 'Free' && (
                      <div className="planit-profile-usage-bar">
                        <div className="usage-bar-track">
                          <div 
                            className={`usage-bar-fill ${
                              userUsage.availableCredits <= 0.10 ? 'danger' : 
                              userUsage.availableCredits <= 0.25 ? 'warning' : 
                              'normal'
                            }`}
                            style={{ 
                              width: `${Math.min(
                                ((userUsage.customLimit || (isProTier(userUsage.membership) ? CREDITS[PLAN_IDS.PRO].monthlyLimit : CREDITS[PLAN_IDS.SIMPLE].defaultLimit)) - userUsage.availableCredits) / 
                                (userUsage.customLimit || (isProTier(userUsage.membership) ? CREDITS[PLAN_IDS.PRO].monthlyLimit : CREDITS[PLAN_IDS.SIMPLE].defaultLimit)) * 100, 100
                              )}%` 
                            }}
                          ></div>
                        </div>
                        <div className="usage-bar-label">
                          {userUsage.availableCredits <= 0.10 && '🚨 Credits Low'}
                          {userUsage.availableCredits > 0.10 && userUsage.availableCredits <= 0.25 && '⚠️ Credits Running Low'}
                          {userUsage.availableCredits > 0.25 && '✅ Credits Available'}
                        </div>
                      </div>
                    )}

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
                                <span className="usage-cost">${entry.cost?.toFixed(4)}</span>
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
                            <strong>Upgrade to Get More</strong>
                            <p>Pro: {QUOTA_SHORT[PLAN_IDS.PRO]} + {STORAGE_DISPLAY[PLAN_IDS.PRO]} storage | Simple: {QUOTA_SHORT[PLAN_IDS.SIMPLE]} + phone control!</p>
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
                      <span className="usage-label">� Available Credits</span>
                      <span className="usage-value">$0.0000</span>
                    </div>
                    <div className="usage-stat">
                      <span className="usage-label">🎯 Monthly Limit</span>
                      <span className="usage-value">
                        {getCreditDisplay(currentPlan || 'Free')}
                      </span>
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
                          {!isSimpleTier(userStorage.membership) && (
                            <button 
                              className="upgrade-premium-button"
                              onClick={() => navigate('/pay?plan=simple')}
                            >
                              Upgrade to Simple
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
                    {!isSimpleTier(userStorage.membership) && userStorage.storageUsagePercent > 50 && (
                      <div className="planit-profile-upgrade-prompt">
                        <div className="upgrade-message">
                          <span className="upgrade-icon">💾</span>
                          <div className="upgrade-text">
                            <strong>Need More Storage?</strong>
                            <p>Simple membership includes unlimited storage for all your data and files!</p>
                          </div>
                        </div>
                        <button 
                          className="upgrade-button"
                          onClick={() => navigate('/pay?plan=simple')}
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
                        {isSimpleTier(currentPlan) ? STORAGE_DISPLAY[PLAN_IDS.SIMPLE] : 
                         isProTier(currentPlan) ? STORAGE_DISPLAY[PLAN_IDS.PRO] : 
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