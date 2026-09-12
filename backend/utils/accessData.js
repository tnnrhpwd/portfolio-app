require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const useragent = require('useragent');
const { logger } = require('./logger');
const { getGeoForIp } = require('./geoLookup');
const { expiresAtSeconds, TTL_ATTRIBUTE } = require('./analyticsRetention');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// Hosts that indicate the request originated from a local development frontend
// (e.g. Vite dev server at http://localhost:3000 hitting the production backend).
// Requests from these origins should not be logged to analytics.
const DEV_ORIGIN_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
]);

function isDevOrigin(req) {
    const candidates = [
        req.headers['origin'],
        req.headers['referer'],
        req.headers['referrer'],
    ].filter(Boolean);

    for (const raw of candidates) {
        try {
            const { hostname } = new URL(raw);
            if (DEV_ORIGIN_HOSTS.has(hostname)) return true;
        } catch {
            // Ignore malformed values
        }
    }
    return false;
}

async function checkIP(req) {
    // logger.debug('checkIP function called');

    // Skip analytics entirely when the request comes from a local dev frontend
    // (e.g. http://localhost:3000) hitting the production backend.
    if (isDevOrigin(req)) {
        return;
    }

    // Use req.ip (Express derives it from the rightmost trusted proxy hop,
    // respecting `trust proxy`) instead of parsing X-Forwarded-For manually —
    // the leftmost XFF entry is client-supplied and spoofable.
    let ipFromHeader = req.ip
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress;

    // Handle IPv6 localhost address
    if (ipFromHeader === '::1' || ipFromHeader === '127.0.0.1') {
        ipFromHeader = '127.0.0.1';
        // logger.debug('Localhost IP detected, setting to 127.0.0.1');
    }
    
    // Skip recording localhost IP
    if (ipFromHeader !== '127.0.0.1') {
        logger.debug('Processing non-localhost IP:', ipFromHeader);
        
        let text = `IP:${ipFromHeader}`;
        if (req.user && req.user.id) {
            text += `|User:${req.user.id}`;
            logger.debug('User ID added to log:', req.user.id);
        }

        // Extract user agent information
        logger.debug('Extracting user agent information...');
        const agent = useragent.parse(req.headers['user-agent']);
        logger.debug('User agent parsed:', agent.toString());
        
        const deviceInfo = `|Device:${agent.device.toString()}|OS:${agent.os.toString()}|Browser:${agent.toAgent()}`;
        logger.debug('Device info:', deviceInfo);

        text += deviceInfo;

        // Add request method, URL, and timestamp. Strip the query string so
        // token-bearing URLs (password-reset links, OAuth callbacks) aren't
        // persisted to the access log.
        const requestUrl = (req.originalUrl || req.url || '').split('?')[0];
        const requestInfo = `|Method:${req.method}|URL:${requestUrl}`;
        logger.debug('Request info:', requestInfo);
        text += requestInfo;

        // Add HTTP referer information
        const referer = req.headers['referer'] || req.headers['referrer'] || null;
        const userAgent = req.headers['user-agent'] || '';
        
        logger.debug('Raw referer header:', referer);
        logger.debug('User agent:', userAgent);
        logger.debug('Current host:', req.headers['host'] || req.get('host'));
        
        // Check for Instagram app user agent patterns
        const isInstagramApp = userAgent.includes('Instagram') || 
                              userAgent.includes('FBAN') || 
                              userAgent.includes('FBAV');
        
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                logger.debug('Parsed referer URL - hostname:', refererUrl.hostname, 'pathname:', refererUrl.pathname);
                
                // Strip the query string before persisting — referer query
                // strings can carry sensitive tokens (password-reset codes,
                // OAuth `code`, session params) from inbound links.
                const refererSansQuery = `${refererUrl.origin}${refererUrl.pathname}`;
                const refererInfo = `|Referer:${refererSansQuery}|RefererHost:${refererUrl.hostname}|RefererPath:${refererUrl.pathname}`;
                logger.debug('Referer info:', refererInfo);
                text += refererInfo;

                // Categorize referer source for analytics
                let refererCategory = 'external';
                const currentHost = req.headers['host'] || req.get('host');
                
                // Check for internal navigation (same domain)
                if (refererUrl.hostname === currentHost || 
                    refererUrl.hostname === 'sthopwood.com' || 
                    currentHost.includes(refererUrl.hostname) || 
                    refererUrl.hostname.includes(currentHost.replace('www.', ''))) {
                    refererCategory = 'internal';
                } else if (refererUrl.hostname.includes('google.')) {
                    refererCategory = 'search_google';
                } else if (refererUrl.hostname.includes('bing.')) {
                    refererCategory = 'search_bing';
                } else if (refererUrl.hostname.includes('yahoo.')) {
                    refererCategory = 'search_yahoo';
                } else if (refererUrl.hostname.includes('facebook.') || refererUrl.hostname.includes('fb.')) {
                    refererCategory = 'social_facebook';
                } else if (refererUrl.hostname.includes('instagram.') || 
                          refererUrl.hostname.includes('ig.') || 
                          refererUrl.hostname.includes('l.instagram.com') ||
                          refererUrl.hostname === 'l.instagram.com') {
                    refererCategory = 'social_instagram';
                } else if (refererUrl.hostname.includes('twitter.') || refererUrl.hostname.includes('t.co') || refererUrl.hostname.includes('x.com')) {
                    refererCategory = 'social_twitter';
                } else if (refererUrl.hostname.includes('linkedin.')) {
                    refererCategory = 'social_linkedin';
                } else if (refererUrl.hostname.includes('tiktok.')) {
                    refererCategory = 'social_tiktok';
                } else if (refererUrl.hostname.includes('youtube.') || refererUrl.hostname.includes('youtu.be')) {
                    refererCategory = 'social_youtube';
                } else if (refererUrl.hostname.includes('github.')) {
                    refererCategory = 'development_github';
                } else if (refererUrl.hostname.includes('reddit.')) {
                    refererCategory = 'social_reddit';
                }

                // Override category if we detect Instagram app but internal referer
                if (isInstagramApp && refererCategory === 'internal') {
                    refererCategory = 'social_instagram';
                    logger.debug('Detected Instagram app with internal referer - overriding to social_instagram');
                }

                const refererCategoryInfo = `|RefererCategory:${refererCategory}`;
                logger.debug('Referer category:', refererCategoryInfo);
                text += refererCategoryInfo;

            } catch (refererError) {
                // If referer URL is malformed, still record the raw value
                let refererCategory = 'malformed';
                
                // Even with malformed referer, check user agent for app detection
                if (isInstagramApp) {
                    refererCategory = 'social_instagram';
                }
                
                const refererInfo = `|Referer:${referer}|RefererHost:invalid|RefererPath:invalid|RefererCategory:${refererCategory}`;
                logger.debug('Referer info (invalid URL):', refererInfo);
                text += refererInfo;
                logger.warn('Invalid referer URL format:', refererError.message);
            }
        } else {
            // Record when no referer is present (direct access, bookmark, etc.)
            let refererCategory = 'direct';
            
            // Check if this might be from a social media app that doesn't send referers
            if (isInstagramApp) {
                refererCategory = 'social_instagram';
                logger.debug('No referer but detected Instagram app user agent');
            }
            
            const refererInfo = `|Referer:direct|RefererHost:none|RefererPath:none|RefererCategory:${refererCategory}`;
            logger.debug('Referer info (direct access):', refererInfo);
            text += refererInfo;
        }

        // Add system platform information
        const platformInfo = `|Platform:${process.platform}`;
        logger.debug('Platform info:', platformInfo);
        text += platformInfo;

        // Get geolocation information.
        //
        // This is served from geoLookup's per-IP cache: checkIP runs on
        // essentially every non-localhost request and its caller awaits it
        // before responding, so a direct ipinfo call here would put a
        // third-party HTTP round-trip on every request's critical path (and
        // let a slow/hung ipinfo stall the response). geoLookup also never
        // throws — a failed lookup is simply "no geo".
        logger.debug('Fetching geolocation information for IP:', ipFromHeader);
        const geoInfo = await getGeoForIp(ipFromHeader);

        if (geoInfo) {
            const locationInfo = `|City:${geoInfo.city}|Region:${geoInfo.region}|Country:${geoInfo.country}`;
            logger.debug('Location info:', locationInfo);
            text += locationInfo;

            // Capture real coordinates for the admin visitor map, when ipinfo
            // supplied them (`loc` is a "lat,lng" string).
            if (typeof geoInfo.lat === 'number' && typeof geoInfo.lon === 'number') {
                text += `|Lat:${geoInfo.lat}|Lon:${geoInfo.lon}`;
            }
        } else {
            logger.debug('No geolocation data available');
        }

        const now = new Date().toISOString();

        const params = {
            TableName: 'Simple', 
            Item: {
                id: require('crypto').randomBytes(16).toString("hex"),
                text: text,
                updatedAt: now,
                createdAt: now,
                // Retention. Access logs are written per request (an authorised
                // or anonymous hit each costs a row), so they carry a DynamoDB
                // TTL. Requires table TTL enabled on this attribute — see
                // scripts/configure-analytics-ttl.js. Durable rows (users,
                // workspace items) don't carry the attribute and are never
                // expired by it.
                [TTL_ATTRIBUTE]: expiresAtSeconds(now),
            },
            ConditionExpression: 'attribute_not_exists(id)'
        };

        logger.debug('Preparing to save data to DynamoDB:', params);

        try {
            await dynamodb.send(new PutCommand(params));
            logger.debug('Access log recorded successfully. Item ID:', params.Item.id);
        } catch (error) {
            logger.error('Error recording access log to DynamoDB:', error);
        }
    } else {
        // logger.debug('Skipping localhost IP, not recording');
    }
}

module.exports = { checkIP };
