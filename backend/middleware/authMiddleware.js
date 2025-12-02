// This file exports protect -- async function that confirms that the request user is the same as the response user. DOES NOT CHECK PASSWORD or ANYTHING WITH UI -- only confirms that response is sent to the requester
const jwt = require('jsonwebtoken');                   // import web token library to get user's token
const asyncHandler = require('express-async-handler'); // sends the errors to the errorhandler
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { logger, securityLogger } = require('../utils/logger');

// Configure AWS DynamoDB Client with retry settings
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    maxAttempts: 3
});

const dynamodb = DynamoDBDocumentClient.from(client);

// Cache for user lookups to reduce DB calls (5 minute TTL)
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear expired cache entries
 */
const cleanupCache = () => {
  const now = Date.now();
  for (const [key, value] of userCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      userCache.delete(key);
    }
  }
};

// Run cache cleanup every minute
setInterval(cleanupCache, 60 * 1000);

/**
 * Get user from cache or database
 * @param {string} userId - The user ID to look up
 * @returns {Promise<Object|null>} The user object or null
 */
const getUserById = async (userId) => {
  // Check cache first
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.user;
  }

  // Try direct GetCommand first (most efficient)
  try {
    const getParams = {
      TableName: 'Simple',
      Key: { id: String(userId) }
    };
    
    const result = await dynamodb.send(new GetCommand(getParams));
    
    if (result.Item) {
      // Cache the result
      userCache.set(userId, { user: result.Item, timestamp: Date.now() });
      return result.Item;
    }
  } catch (getError) {
    // GetCommand failed, try QueryCommand as fallback
    logger.debug('GetCommand failed, trying QueryCommand', { userId, error: getError.message });
  }

  // Fallback to QueryCommand if table uses different key structure
  try {
    const queryParams = {
      TableName: 'Simple',
      KeyConditionExpression: 'id = :userId',
      ExpressionAttributeValues: {
        ':userId': String(userId)
      },
      Limit: 1
    };

    const result = await dynamodb.send(new QueryCommand(queryParams));
    
    if (result.Items && result.Items.length > 0) {
      userCache.set(userId, { user: result.Items[0], timestamp: Date.now() });
      return result.Items[0];
    }
  } catch (queryError) {
    logger.error('User lookup failed', { userId, error: queryError.message });
    throw queryError;
  }

  return null;
};

// This middleware async function is called anytime a user requests user information
const protect = asyncHandler(async (req, res, next) => {
  let token;
  
  // Log request info (not sensitive data)
  logger.debug('Auth middleware called', { 
    method: req.method, 
    path: req.originalUrl,
    hasAuth: !!req.headers.authorization 
  });

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')  // if HTTP request header exists and starts with Bearer -- IF USER HAS JWT ( LOGGED IN )
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];     // set token as just the token, ignore the "Bearer "

      // Validate token format before verification
      if (!token || token.split('.').length !== 3) {
        securityLogger.warn('Malformed token received', { 
          ip: req.ip, 
          path: req.originalUrl 
        });
        res.status(401);
        return res.json({ dataMessage: 'Not authorized, invalid token format' });
      }

      // Verify token with additional options
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'], // Explicitly specify allowed algorithms
        maxAge: '7d' // Reject tokens older than 7 days even if not expired
      });

      // Validate decoded payload
      if (!decoded.id) {
        securityLogger.warn('Token missing user ID', { ip: req.ip });
        res.status(401);
        return res.json({ dataMessage: 'Not authorized, invalid token' });
      }

      logger.debug('Token verified', { userId: decoded.id });

      // Use efficient lookup instead of scan
      const user = await getUserById(decoded.id);

      if (!user) {
        securityLogger.warn('Token valid but user not found', { 
          userId: decoded.id, 
          ip: req.ip 
        });
        res.status(401);
        return res.json({ dataMessage: 'User not found' });
      }

      // Remove sensitive fields before attaching to request
      const { password, ...safeUser } = user;
      req.user = safeUser;
      
      logger.debug('User authenticated successfully', { userId: decoded.id });

      next();    // goes to next middleware function
    } catch (error) {     
      // Log security events
      securityLogger.warn('Authentication failed', { 
        error: error.name, 
        message: error.message,
        ip: req.ip,
        path: req.originalUrl 
      });

      res.status(401);
      
      if (error.name === 'TokenExpiredError') {
        return res.json({ dataMessage: 'Not authorized, token expired' });
      } else if (error.name === 'JsonWebTokenError') {
        return res.json({ dataMessage: 'Not authorized, invalid token' });
      } else if (error.name === 'NotBeforeError') {
        return res.json({ dataMessage: 'Not authorized, token not yet valid' });
      } else {
        return res.json({ dataMessage: 'Not authorized' });
      }
    }
  }

  // if NOT LOGGED IN -- throw error
  if (!token) { 
    logger.debug('No authorization token provided', { ip: req.ip });
    res.status(401);
    return res.json({ dataMessage: 'Not authorized, no token' });
  }
});

/**
 * Optional authentication middleware - doesn't fail if no token
 * Useful for routes that work differently for logged-in users
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  if (!req.headers.authorization?.startsWith('Bearer')) {
    return next(); // Continue without user
  }

  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256']
    });
    
    const user = await getUserById(decoded.id);
    if (user) {
      const { password, ...safeUser } = user;
      req.user = safeUser;
    }
  } catch (error) {
    // Silently continue without user for optional auth
    logger.debug('Optional auth token invalid', { error: error.name });
  }
  
  next();
});

module.exports = { protect, optionalAuth };module.exports = { protect }  // exported to userRoutes
