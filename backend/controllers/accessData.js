require('dotenv').config();
const Data = require('../models/dataModel');
const useragent = require('useragent');
const ipinfo = require('ipinfo');

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

        const existing = await Data.findOne({
            'data': { text: text }
        });

        if (!existing) {
            await Data.create({
                data: { text: text }
            });
        }
    }
}

module.exports = { checkIP };
