/**
 * Small cached wrapper around the `ipinfo` package used elsewhere in this
 * codebase (see utils/accessData.js). Caches lookups in-memory for a short
 * TTL so repeat visitors / rapid requests don't hammer the ipinfo API.
 */

const ipinfo = require('ipinfo');

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const cache = new Map();

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) cache.delete(key);
  }
}
setInterval(cleanupCache, 15 * 60 * 1000).unref?.();

/**
 * @param {string} ip
 * @returns {Promise<{ city: string, region: string, country: string }|null>}
 */
async function getGeoForIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  const cached = cache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.geo;
  }

  try {
    const geo = await new Promise((resolve, reject) => {
      ipinfo(ip, (err, info) => {
        if (err) return reject(err);
        resolve(info);
      });
    });

    const result = geo
      ? { city: geo.city || '', region: geo.region || '', country: geo.country || '' }
      : null;

    cache.set(ip, { geo: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error('[geoLookup] Failed to resolve geo for IP:', ip, error.message);
    return null;
  }
}

/** Extracts the visitor's IP from an Express request, mirroring accessData.js. */
function extractIp(req) {
  let ip = req.headers['x-forwarded-for']
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress;

  if (ip) ip = ip.split(',').shift().trim();
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

module.exports = { getGeoForIp, extractIp };
