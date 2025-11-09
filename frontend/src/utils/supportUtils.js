/**
 * Support utility functions
 */

/**
 * Get user identifier from user object
 * @param {Object} user - User object
 * @returns {string} User identifier
 */
export const getUserIdentifier = (user) => {
  if (!user) return 'Anonymous';
  
  // Check for direct email property first (most likely in frontend user object)
  if (user.email) return user.email;
  
  // Check for email in the text field (backend format)
  if (user.text && user.text.includes('Email:')) {
    const emailMatch = user.text.match(/Email:([^|]+)/);
    if (emailMatch) return emailMatch[1];
  }
  
  // Fallback to other identifiers
  return user.id || user.nickname || 'Anonymous';
};

/**
 * Get browser information
 * @returns {string} Browser info string
 */
export const getBrowserInfo = () => {
  const userAgent = navigator.userAgent;
  let browser = 'Unknown';
  
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';
  
  return `${browser} (${userAgent})`;
};

/**
 * Get device information
 * @returns {string} Device info string
 */
export const getDeviceInfo = () => {
  const { screen, navigator } = window;
  return `${navigator.platform} - ${screen.width}x${screen.height} - ${navigator.language}`;
};

/**
 * Scroll to support content section
 */
export const scrollToContent = () => {
  const contentElement = document.querySelector('.support-content');
  if (contentElement) {
    contentElement.scrollIntoView({ 
      behavior: 'smooth',
      block: 'start'
    });
  }
};
