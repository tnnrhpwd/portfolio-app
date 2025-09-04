require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const useragent = require('useragent');
const ipinfo = require('ipinfo');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

async function checkIP(req) {
    // console.log('checkIP function called');
    
    let ipFromHeader = req.headers['x-forwarded-for']
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress;

    // console.log('Original IP from headers:', ipFromHeader);

    if (ipFromHeader) {
        // Handle multiple IPs in the x-forwarded-for header
        ipFromHeader = ipFromHeader.split(',').shift().trim();
        // console.log('IP after splitting and trimming:', ipFromHeader);
    }

    // Handle IPv6 localhost address
    if (ipFromHeader === '::1' || ipFromHeader === '127.0.0.1') {
        ipFromHeader = '127.0.0.1';
        // console.log('Localhost IP detected, setting to 127.0.0.1');
    } else if (req.headers['x-forwarded-for']) {
        ipFromHeader = req.headers['x-forwarded-for'].split(',')[0].trim();
        console.log('Using x-forwarded-for header, IP:', ipFromHeader);
    }
    
    // Skip recording localhost IP
    if (ipFromHeader !== '127.0.0.1') {
        console.log('Processing non-localhost IP:', ipFromHeader);
        
        let text = `IP:${ipFromHeader}`;
        if (req.user && req.user.id) {
            text += `|User:${req.user.id}`;
            console.log('User ID added to log:', req.user.id);
        }

        // Extract user agent information
        console.log('Extracting user agent information...');
        const agent = useragent.parse(req.headers['user-agent']);
        console.log('User agent parsed:', agent.toString());
        
        const deviceInfo = `|Device:${agent.device.toString()}|OS:${agent.os.toString()}|Browser:${agent.toAgent()}`;
        console.log('Device info:', deviceInfo);

        text += deviceInfo;

        // Add request method, URL, and timestamp
        const requestInfo = `|Method:${req.method}|URL:${req.originalUrl}`;
        console.log('Request info:', requestInfo);
        text += requestInfo;

        // Add HTTP referer information
        const referer = req.headers['referer'] || req.headers['referrer'] || null;
        const userAgent = req.headers['user-agent'] || '';
        
        console.log('Raw referer header:', referer);
        console.log('User agent:', userAgent);
        console.log('Current host:', req.headers['host'] || req.get('host'));
        
        // Check for Instagram app user agent patterns
        const isInstagramApp = userAgent.includes('Instagram') || 
                              userAgent.includes('FBAN') || 
                              userAgent.includes('FBAV');
        
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                console.log('Parsed referer URL - hostname:', refererUrl.hostname, 'pathname:', refererUrl.pathname);
                
                const refererInfo = `|Referer:${referer}|RefererHost:${refererUrl.hostname}|RefererPath:${refererUrl.pathname}`;
                console.log('Referer info:', refererInfo);
                text += refererInfo;
                
                // Add additional referer analysis
                if (refererUrl.search) {
                    const refererQuery = `|RefererQuery:${refererUrl.search}`;
                    console.log('Referer query params:', refererQuery);
                    text += refererQuery;
                }

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
                    console.log('Detected Instagram app with internal referer - overriding to social_instagram');
                }

                const refererCategoryInfo = `|RefererCategory:${refererCategory}`;
                console.log('Referer category:', refererCategoryInfo);
                text += refererCategoryInfo;

            } catch (refererError) {
                // If referer URL is malformed, still record the raw value
                let refererCategory = 'malformed';
                
                // Even with malformed referer, check user agent for app detection
                if (isInstagramApp) {
                    refererCategory = 'social_instagram';
                }
                
                const refererInfo = `|Referer:${referer}|RefererHost:invalid|RefererPath:invalid|RefererCategory:${refererCategory}`;
                console.log('Referer info (invalid URL):', refererInfo);
                text += refererInfo;
                console.warn('Invalid referer URL format:', refererError.message);
            }
        } else {
            // Record when no referer is present (direct access, bookmark, etc.)
            let refererCategory = 'direct';
            
            // Check if this might be from a social media app that doesn't send referers
            if (isInstagramApp) {
                refererCategory = 'social_instagram';
                console.log('No referer but detected Instagram app user agent');
            }
            
            const refererInfo = `|Referer:direct|RefererHost:none|RefererPath:none|RefererCategory:${refererCategory}`;
            console.log('Referer info (direct access):', refererInfo);
            text += refererInfo;
        }

        // Add system platform information
        const platformInfo = `|Platform:${process.platform}`;
        console.log('Platform info:', platformInfo);
        text += platformInfo;

        // Get geolocation information
        console.log('Fetching geolocation information for IP:', ipFromHeader);
        try {
            const geoInfo = await new Promise((resolve, reject) => {
                ipinfo(ipFromHeader, (err, cLoc) => {
                    if (err) {
                        console.error('Error getting IP info:', err);
                        reject(err);
                    }
                    console.log('Geolocation data received:', cLoc);
                    resolve(cLoc);
                });
            });

            if (geoInfo) {
                const locationInfo = `|City:${geoInfo.city}|Region:${geoInfo.region}|Country:${geoInfo.country}`;
                console.log('Location info:', locationInfo);
                text += locationInfo;
            } else {
                console.log('No geolocation data available');
            }
        } catch (geoError) {
            console.error('Failed to get geolocation data:', geoError);
        }

        const params = {
            TableName: 'Simple', 
            Item: {
                id: require('crypto').randomBytes(16).toString("hex"),
                text: text,
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            },
            ConditionExpression: 'attribute_not_exists(id)'
        };

        console.log('Preparing to save data to DynamoDB:', params);

        try {
            await dynamodb.send(new PutCommand(params));
            console.log('Access log recorded successfully. Item ID:', params.Item.id);
        } catch (error) {
            console.error('Error recording access log to DynamoDB:', error);
        }
    } else {
        // console.log('Skipping localhost IP, not recording');
    }
}

module.exports = { checkIP };
