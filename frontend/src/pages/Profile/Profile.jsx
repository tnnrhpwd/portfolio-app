import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logout, resetDataSlice, resetDataSuccess, getUserSubscription, getUserUsage } from './../../features/data/dataSlice.js';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import { isTokenValid, getTokenExpiration } from '../../utils/tokenUtils.js';
import { toast } from 'react-toastify';
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
    dataIsSuccess, 
    dataIsError, 
    dataMessage,
    userUsage,
    userUsageIsLoading,
    userUsageIsError,
    userUsageMessage
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
    
    if (!user) {
      navigate('/login');
      return;
    }

    if (dataIsError) {
      toast.error(dataMessage);
      console.log('Toast error message:', dataMessage);
      dispatch(resetDataSuccess());
    }

    if (dataIsSuccess && dataMessage) {
      toast.success(dataMessage);
      console.log('Toast success message:', dataMessage);
      dispatch(resetDataSuccess());
    }

    return () => {
      // Don't reset the entire data slice - this was causing userUsage to be cleared
      // dispatch(resetDataSlice());
    };
  }, [user, dataIsSuccess, dataIsError, dataMessage, navigate, dispatch]);

  // Only fetch subscription data once when component mounts
  useEffect(() => {
    if (user && !subscriptionLoaded) {
      // Debug: Check user token
      console.log('User object:', user);
      console.log('User token exists:', !!user.token);
      
      if (!user.token) {
        console.log('No token found, logging out');
        dispatch(logout());
        navigate('/login');
        return;
      }
      
      // Check if token is valid using utility function
      if (!isTokenValid(user.token)) {
        const expiration = getTokenExpiration(user.token);
        console.log('Token is invalid or expired');
        console.log('Token expiration:', expiration);
        toast.error('Your session has expired. Please log in again.');
        dispatch(logout());
        navigate('/login');
        return;
      }
      
      console.log('Token is valid, fetching subscription and usage data');
      
      // Use a local try-catch to prevent the component from crashing
      try {
        dispatch(getUserSubscription())
          .unwrap()
          .then((subscriptionData) => {
            console.log('Successfully fetched subscription:', subscriptionData);
            setUserSubscription(subscriptionData);
            setSubscriptionLoaded(true);
            // Don't reset success state as it might interfere with other actions
            // dispatch(resetDataSuccess());
          })
          .catch((error) => {
            console.error('Failed to fetch subscription:', error);
            
            // If it's an authentication error, redirect to login
            if (error.includes('Not authorized') || error.includes('token expired')) {
              toast.error('Your session has expired. Please log in again.');
              dispatch(logout());
              navigate('/login');
            } else {
              // For other errors, just mark as loaded and set default subscription
              setUserSubscription({ subscriptionPlan: 'Free', subscriptionDetails: null });
              setSubscriptionLoaded(true);
            }
            // Don't reset success state as it might interfere with other actions
            // dispatch(resetDataSuccess());
          });

        // Fetch usage data
        dispatch(getUserUsage())
          .unwrap()
          .then((usageData) => {
            console.log('Successfully fetched usage data:', usageData);
            
            // Show warning toast if usage is getting high
            if (usageData && usageData.membership !== 'Premium') {
              const percentUsed = usageData.percentUsed || 0;
              if (percentUsed >= 90) {
                toast.warning('⚠️ API usage is at 90%! Consider upgrading soon.', {
                  position: 'top-right',
                  autoClose: 8000,
                  hideProgressBar: false,
                  closeOnClick: true,
                  pauseOnHover: true,
                });
              } else if (percentUsed >= 75) {
                toast.info('📊 API usage is at 75%. Keep an eye on your remaining balance!', {
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

      } catch (error) {
        console.error('Error dispatching subscription/usage actions:', error);
        setSubscriptionLoaded(true);
      }
    }
  }, [user, subscriptionLoaded, dispatch, navigate]);

  // Debug effect to monitor userUsage changes
  useEffect(() => {
    console.log('🔍 userUsage state changed:', userUsage);
    console.log('🔍 userUsage type:', typeof userUsage);
    console.log('🔍 userUsage keys:', userUsage ? Object.keys(userUsage) : 'no keys');
  }, [userUsage]);

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
                      <option value="Flex">⚡ Flex Plan</option>
                      <option value="Premium">👑 Premium Plan</option>
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
                <h3 className="planit-profile-section-title">API Usage & Limits</h3>
                {userUsageIsLoading ? (
                  <div className="planit-profile-usage-loading">Loading usage data...</div>
                ) : userUsageIsError ? (
                  <div className="planit-profile-usage-error">
                    Error loading usage data: {userUsageMessage}
                  </div>
                ) : userUsage && typeof userUsage === 'object' && 'totalUsage' in userUsage ? (
                  <div className="planit-profile-usage-container">
                    <div className="planit-profile-usage-overview">
                      <div className="usage-stat">
                        <span className="usage-label">💰 Current Usage</span>
                        <span className="usage-value">
                          ${userUsage?.totalUsage !== undefined ? 
                            Number(userUsage.totalUsage).toFixed(4) : 
                            '0.0000'
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">🎯 Monthly Limit</span>
                        <span className="usage-value">
                          {userUsage?.membership === 'Premium' ? 
                            '∞ Unlimited' : 
                            `$${userUsage?.limit !== undefined ? Number(userUsage.limit).toFixed(2) : '0.00'}`
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">💸 Remaining</span>
                        <span className="usage-value">
                          {userUsage?.membership === 'Premium' 
                            ? '∞ Unlimited' 
                            : `$${userUsage?.remainingBalance !== undefined ? 
                                Number(userUsage.remainingBalance).toFixed(4) : 
                                '0.0000'
                              }`
                          }
                        </span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-label">📊 Usage %</span>
                        <span className="usage-value">
                          {userUsage?.membership === 'Premium' ? 
                            'N/A' : 
                            `${userUsage?.percentUsed !== undefined ? 
                              Number(userUsage.percentUsed).toFixed(1) : 
                              '0.0'
                            }%`
                          }
                        </span>
                      </div>
                    </div>
                    
                    {userUsage?.percentUsed > 0 && userUsage?.membership !== 'Premium' && (
                      <div className="planit-profile-usage-bar">
                        <div className="usage-bar-track">
                          <div 
                            className={`usage-bar-fill ${
                              userUsage.percentUsed >= 90 ? 'danger' : 
                              userUsage.percentUsed >= 75 ? 'warning' : 
                              'normal'
                            }`}
                            style={{ width: `${Math.min(Number(userUsage.percentUsed) || 0, 100)}%` }}
                          ></div>
                        </div>
                        <div className="usage-bar-label">
                          {userUsage.percentUsed >= 90 && '⚠️ Nearly Full'}
                          {userUsage.percentUsed >= 75 && userUsage.percentUsed < 90 && '🔶 High Usage'}
                          {userUsage.percentUsed < 75 && '✅ Good'}
                        </div>
                      </div>
                    )}

                    {userUsage.usageBreakdown && userUsage.usageBreakdown.length > 0 && (
                      <div className="planit-profile-usage-breakdown">
                        <h4 className="usage-breakdown-title">Recent API Usage</h4>
                        <div className="usage-breakdown-list">
                          {userUsage.usageBreakdown.slice(-5).map((entry, index) => (
                            <div key={index} className="usage-breakdown-item">
                              <div className="usage-api-info">
                                <span className="api-name">
                                  {entry.api === 'openai' && '🤖 OpenAI'}
                                  {entry.api === 'rapidword' && '📝 Word Generator'}
                                  {entry.api === 'rapiddef' && '📚 Dictionary'}
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
                            <strong>Upgrade to Flex or Premium</strong>
                            <p>Get $10 monthly API usage allowance and access to AI-powered features!</p>
                          </div>
                        </div>
                        <button 
                          className="upgrade-button"
                          onClick={() => navigate('/pay?plan=flex')}
                        >
                          Upgrade Now
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="planit-profile-usage-placeholder">
                    <div className="usage-stat">
                      <span className="usage-label">💰 Current Usage</span>
                      <span className="usage-value">$0.0000</span>
                    </div>
                    <div className="usage-stat">
                      <span className="usage-label">🎯 Monthly Limit</span>
                      <span className="usage-value">
                        {currentPlan === 'Premium' ? '∞ Unlimited' : currentPlan === 'Free' ? '$0.00' : '$10.00'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
            
            <section className="planit-profile-actions">
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