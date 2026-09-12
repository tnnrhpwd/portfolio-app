/**
 * Small cached wrapper around the `ipinfo` package used elsewhere in this
 * codebase (see utils/accessData.js). Caches lookups in-memory for a short
 * TTL so repeat visitors / rapid requests don't hammer the ipinfo API.
 *
 * Why the cache and the timeout matter: `getGeoForIp` is awaited from inside
 * the request path (accessData.checkIP runs on essentially every non-localhost
 * API call). Without a cache, every request pays a third-party HTTP round-trip;
 * without a timeout, a hung ipinfo call stalls the response indefinitely.
 * Both are therefore correctness properties of this module, not optimisation.
 *
 * Failure is never an error to the caller: a missing lookup resolves `null`.
 */

const ipinfo = require('ipinfo');
const { logger } = require('./logger');

const CACHE_TTL = 60 * 60 * 1000; // 1 hour — a hit is a stable fact
// A miss is cached too, but briefly: it stops a single dead/hung lookup from
// re-calling ipinfo on every request, without pinning the IP as "unknown" for
// an hour if the failure was transient (rate limit, network blip).
const NEGATIVE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 2000;
const cache = new Map();

/** How long this entry stays usable: longer for a hit, briefly for a miss. */
function entryTtl(geo) {
  return geo ? CACHE_TTL : NEGATIVE_TTL;
}

/** Overridable so tests don't have to wait out the real timeout. */
function geoTimeoutMs() {
  const raw = parseInt(process.env.GEO_TIMEOUT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > value.ttl) cache.delete(key);
  }
}
setInterval(cleanupCache, 15 * 60 * 1000).unref?.();

/**
 * Parse ipinfo's `loc` field (a "lat,lng" string) into a pair of numbers.
 * @returns {number[]} [lat, lon], or [] when absent/unparseable
 */
function parseLoc(loc) {
  if (typeof loc !== 'string' || !loc.includes(',')) return [];
  const parts = loc.split(',').map((part) => parseFloat(String(part).trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return [];
  return parts;
}

/**
 * Shape an ipinfo payload into the fields this codebase consumes. Returns
 * `null` for "no data", which callers read as "no geo for this IP".
 * @returns {{ city: string, region: string, country: string, lat?: number, lon?: number }|null}
 */
function normalizeGeo(info) {
  if (!info) return null;

  const geo = {
    city: info.city || '',
    region: info.region || '',
    country: info.country || '',
  };

  // Coordinates feed the admin visitor map (accessData.js writes |Lat:|Lon:).
  const [lat, lon] = parseLoc(info.loc);
  if (lat !== undefined) {
    geo.lat = lat;
    geo.lon = lon;
  }

  return geo;
}

/**
 * One ipinfo call, guaranteed to settle within `timeoutMs`. Never rejects —
 * a failure, a hang and an empty payload are all just `null`.
 */
function lookupViaIpinfo(ip, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      logger.warn(`[geoLookup] Timed out after ${timeoutMs}ms resolving geo for IP:`, ip);
      finish(null);
    });
    timer.unref?.();

    try {
      ipinfo(ip, (err, info) => {
        if (err) {
          logger.error('[geoLookup] Failed to resolve geo for IP:', ip, err.message);
          return finish(null);
        }
        finish(info);
      });
    } catch (error) {
      logger.error('[geoLookup] Threw while resolving geo for IP:', ip, error.message);
      finish(null);
    }
  });
}

/**
 * @param {string} ip
 * @returns {Promise<{ city: string, region: string, country: string, lat?: number, lon?: number }|null>}
 */
async function getGeoForIp(ip) {
  try {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

    const cached = cache.get(ip);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.geo;
    }

    const geo = normalizeGeo(await lookupViaIpinfo(ip, geoTimeoutMs()));

    cache.set(ip, { geo, timestamp: Date.now(), ttl: entryTtl(geo) });
    return geo;
  } catch (error) {
    // Belt and braces: callers treat "no geo" as normal and must never have to
    // guard this call, so nothing escapes here.
    logger.error('[geoLookup] Unexpected failure resolving geo for IP:', ip, error.message);
    return null;
  }
}

/** Extracts the visitor's IP from an Express request, mirroring accessData.js. */
function extractIp(req) {
  // Prefer `req.ip`: Express derives it from the rightmost trusted proxy hop
  // (respecting `trust proxy`). The leftmost X-Forwarded-For entry is
  // client-supplied and spoofable, so it must not outrank `req.ip` — matching
  // the hardened behaviour in accessData.js.
  //
  // Below `req.ip` the original precedence is preserved (XFF first): behind a
  // proxy the raw socket address is the *proxy*, so the forwarded client IP is
  // the more useful fallback.
  let ip = req?.ip;

  if (!ip) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    ip = forwarded
      ? forwarded.split(',').shift().trim()
      : req?.connection?.remoteAddress || req?.socket?.remoteAddress;
  }

  if (ip === '::1') ip = '127.0.0.1';
  return ip || undefined;
}

module.exports = { getGeoForIp, extractIp };
