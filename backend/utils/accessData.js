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
    let ipFromHeader = req.headers['x-forwarded-for']
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress;

    if (ipFromHeader) {
        // Handle multiple IPs in the x-forwarded-for header
        ipFromHeader = ipFromHeader.split(',').shift().trim();
    }

    // Handle IPv6 localhost address
    if (ipFromHeader === '::1' || ipFromHeader === '127.0.0.1') {
        ipFromHeader = '127.0.0.1';
    } else if (req.headers['x-forwarded-for']) {
        ipFromHeader = req.headers['x-forwarded-for'].split(',')[0].trim();
    }
    
    // Skip recording localhost IP
    if (ipFromHeader !== '127.0.0.1') {
        let text = `IP:${ipFromHeader}`;
        if (req.user && req.user.id) {
            text += `|User:${req.user.id}`;
        }

        // Extract user agent information
        const agent = useragent.parse(req.headers['user-agent']);
        const deviceInfo = `|Device:${agent.device.toString()}|OS:${agent.os.toString()}|Browser:${agent.toAgent()}`;

        text += deviceInfo;

        // Add request method, URL, and timestamp
        const requestInfo = `|Method:${req.method}|URL:${req.originalUrl}`;
        text += requestInfo;

        // Add system platform information
        const platformInfo = `|Platform:${process.platform}`;
        text += platformInfo;

        // Get geolocation information
        const geoInfo = await new Promise((resolve, reject) => {
            ipinfo(ipFromHeader, (err, cLoc) => {
                if (err) reject(err);
                resolve(cLoc);
            });
        });

        if (geoInfo) {
            const locationInfo = `|City:${geoInfo.city}|Region:${geoInfo.region}|Country:${geoInfo.country}`;
            text += locationInfo;
        }

        const params = {
            TableName: 'Simple', 
            Item: {
                id: require('crypto').randomBytes(16).toString("hex"), // Generate a unique ID
                logData: text,
                timestamp: new Date().toISOString()
            },
            ConditionExpression: 'attribute_not_exists(id)' // Prevent overwrites
        };

        try {
            await dynamodb.put(params).promise();
            console.log('Access log recorded.');
        } catch (error) {
            console.error('Error recording access log:', error);
        }
    }
}

module.exports = { checkIP };
