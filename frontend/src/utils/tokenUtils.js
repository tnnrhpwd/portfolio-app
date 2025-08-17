// Utility functions for JWT token handling

/**
 * Check if a JWT token is expired
 * @param {string} token - JWT token
 * @returns {boolean} - true if token is expired, false otherwise
 */
export const isTokenExpired = (token) => {
  if (!token) return true;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
  } catch (error) {
    console.error('Failed to parse token:', error);
    return true; // Treat invalid tokens as expired
  }
};

/**
 * Get token expiration date
 * @param {string} token - JWT token
 * @returns {Date|null} - Expiration date or null if invalid
 */
export const getTokenExpiration = (token) => {
  if (!token) return null;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return new Date(payload.exp * 1000);
  } catch (error) {
    console.error('Failed to parse token:', error);
    return null;
  }
};

/**
 * Get user ID from JWT token
 * @param {string} token - JWT token
 * @returns {string|null} - User ID or null if invalid
 */
export const getUserIdFromToken = (token) => {
  if (!token) return null;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id;
  } catch (error) {
    console.error('Failed to parse token:', error);
    return null;
  }
};

/**
 * Check if token is valid (exists and not expired)
 * @param {string} token - JWT token
 * @returns {boolean} - true if valid, false otherwise
 */
export const isTokenValid = (token) => {
  return token && !isTokenExpired(token);
};
