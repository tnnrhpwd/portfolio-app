require('dotenv').config();
const AWS = require('aws-sdk');
const useragent = require('useragent');
const ipinfo = require('ipinfo');

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

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
            await dynamodb.put(params).promise();
            console.log('Access log recorded successfully. Item ID:', params.Item.id);
        } catch (error) {
            console.error('Error recording access log to DynamoDB:', error);
        }
    } else {
        // console.log('Skipping localhost IP, not recording');
    }
}

module.exports = { checkIP };
