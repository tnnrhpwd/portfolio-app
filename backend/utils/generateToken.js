const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for authenticated users
 * @param {string} id - The user's unique identifier
 * @param {object} options - Optional token configuration
 * @param {string} options.expiresIn - Token expiration time (default: '7d')
 * @returns {string} Signed JWT token
 */
const generateToken = (id, options = {}) => {
  const { expiresIn = '7d' } = options;
  
  return jwt.sign(
    { 
      id,
      iat: Math.floor(Date.now() / 1000), // Issued at time
    }, 
    process.env.JWT_SECRET, 
    {
      expiresIn,
      algorithm: 'HS256', // Explicitly specify algorithm for security
    }
  );
};

/**
 * Generate a short-lived token for sensitive operations
 * @param {string} id - The user's unique identifier  
 * @param {string} purpose - The purpose of the token (e.g., 'password-reset')
 * @returns {string} Signed JWT token with 1 hour expiry
 */
const generateShortLivedToken = (id, purpose) => {
  return jwt.sign(
    { 
      id,
      purpose,
      iat: Math.floor(Date.now() / 1000),
    }, 
    process.env.JWT_SECRET, 
    {
      expiresIn: '1h',
      algorithm: 'HS256',
    }
  );
};

module.exports = { generateToken, generateShortLivedToken };