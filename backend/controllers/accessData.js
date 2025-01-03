require('dotenv').config();
const Data = require('../models/dataModel');

async function checkIP(req) {
    let ipFromHeader = req.headers['x-forwarded-for']
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress;

    // Handle multiple IPs in the x-forwarded-for header
    if (ipFromHeader) {
        ipFromHeader = ipFromHeader.split(',').shift().trim();
    }

    // Handle IPv6 localhost address
    if (ipFromHeader === '::1') {
        ipFromHeader = '127.0.0.1';
    }
    console.log(`IP:${ipFromHeader}`);

    // Skip recording localhost IP
    if (ipFromHeader !== '127.0.0.1') {
        const existing = await Data.findOne({
            'data.text': { $regex: `IP:${ipFromHeader}`, $options: 'i' }
        });

        if (!existing) {
            await Data.create({
                data: { text: `IP:${ipFromHeader}` }
            });
        }
    }
}

module.exports = { checkIP };
