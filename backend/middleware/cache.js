const NodeCache = require('node-cache');

// Create cache instances with different TTLs
const publicDataCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes for public data
  checkperiod: 60 // Check for expired keys every minute
});

const userDataCache = new NodeCache({ 
  stdTTL: 180, // 3 minutes for user-specific data
  checkperiod: 60 
});

const authCache = new NodeCache({ 
  stdTTL: 900, // 15 minutes for authentication data
  checkperiod: 120 
});

// Generic cache middleware factory
const createCacheMiddleware = (cache, keyGenerator, ttl = null) => {
  return (req, res, next) => {
    const cacheKey = keyGenerator(req);
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`Cache hit for key: ${cacheKey}`);
      return res.json(cachedData);
    }

    console.log(`Cache miss for key: ${cacheKey}`);
    
    // Store original res.json
    const originalJson = res.json;
    
    // Override res.json to cache the response
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        const cacheOptions = ttl ? { ttl } : {};
        cache.set(cacheKey, data, cacheOptions);
        console.log(`Cached data for key: ${cacheKey}`);
      }
      
      // Call original res.json
      return originalJson.call(this, data);
    };

    next();
  };
};

// Specific cache middleware functions
const cachePublicData = createCacheMiddleware(
  publicDataCache,
  (req) => `public_${req.method}_${req.originalUrl}`
);

const cacheUserData = createCacheMiddleware(
  userDataCache,
  (req) => `user_${req.user?.id || 'anonymous'}_${req.method}_${req.originalUrl}`
);

// Cache invalidation helpers
const invalidateUserCache = (userId) => {
  const keys = userDataCache.keys();
  const userKeys = keys.filter(key => key.includes(`user_${userId}_`));
  userKeys.forEach(key => userDataCache.del(key));
  console.log(`Invalidated ${userKeys.length} cache entries for user ${userId}`);
};

const invalidatePublicCache = () => {
  const keys = publicDataCache.keys();
  const publicKeys = keys.filter(key => key.includes('public_'));
  publicKeys.forEach(key => publicDataCache.del(key));
  console.log(`Invalidated ${publicKeys.length} public cache entries`);
};

// Cache statistics
const getCacheStats = () => {
  return {
    publicData: {
      keys: publicDataCache.keys().length,
      hits: publicDataCache.getStats().hits,
      misses: publicDataCache.getStats().misses
    },
    userData: {
      keys: userDataCache.keys().length,
      hits: userDataCache.getStats().hits,
      misses: userDataCache.getStats().misses
    },
    auth: {
      keys: authCache.keys().length,
      hits: authCache.getStats().hits,
      misses: authCache.getStats().misses
    }
  };
};

module.exports = {
  cachePublicData,
  cacheUserData,
  invalidateUserCache,
  invalidatePublicCache,
  getCacheStats,
  publicDataCache,
  userDataCache,
  authCache
};
