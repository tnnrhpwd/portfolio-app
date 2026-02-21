/**
 * Format price from cents to dollars with proper formatting
 * @param {number} priceInCents - Price in cents
 * @returns {string} Formatted price string
 */
export const formatPrice = (priceInCents) => {
  if (!priceInCents) return 'Free';
  const dollars = priceInCents / 100;
  // Use toFixed(2) to preserve cents, then remove trailing zeros
  return `$${dollars.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`;
};

/**
 * Validate custom price based on membership type
 * @param {string} membershipType - Type of membership (pro or simple)
 * @param {number} customPrice - Custom price value
 * @returns {Object} Validation result with valid flag and error message
 */
export const validateCustomPrice = (membershipType, customPrice) => {
  // Fixed pricing — no custom price validation needed for pro/simple
  return { valid: true, error: '' };
};

/**
 * Parse error object to extract meaningful error message
 * @param {Object} error - Error object from API call
 * @returns {Object} Parsed error with message and status
 */
export const parseErrorMessage = (error) => {
  let errorMessage = '';
  let errorStatus = null;
  
  if (error?.message) {
    errorMessage = error.message;
    errorStatus = error.status;
  } else if (error?.response?.data) {
    if (typeof error.response.data === 'string') {
      errorMessage = error.response.data;
    } else if (error.response.data.message) {
      errorMessage = error.response.data.message;
    } else if (error.response.data.error) {
      errorMessage = error.response.data.error;
    } else {
      errorMessage = JSON.stringify(error.response.data);
    }
    errorStatus = error.response.status;
  } else {
    errorMessage = error?.toString() || 'An unknown error occurred';
  }
  
  return { message: errorMessage, status: errorStatus };
};

/**
 * Check if error indicates customer needs to be created
 * @param {string} errorMessage - Error message string
 * @param {number} errorStatus - HTTP status code
 * @returns {boolean} True if customer creation is needed
 */
export const needsCustomerCreation = (errorMessage, errorStatus) => {
  return errorMessage.includes('customer') || 
         errorMessage.includes('Customer') || 
         errorMessage.includes('No customer ID') ||
         (errorStatus === 400 && errorMessage.includes('customer'));
};

/**
 * Get default custom price based on membership type
 * @param {string} membershipType - Type of membership
 * @returns {number} Default price
 */
export const getDefaultCustomPrice = (membershipType) => {
  return 0;
};
