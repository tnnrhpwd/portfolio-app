require('dotenv').config();
const Data = require('../models/dataModel');

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
        const existing = await Data.findOne({
            'data.text': { text: text }
        });

        if (!existing) {

            await Data.create({
                data: { text: text }
            });
        }
    }
}

module.exports = { checkIP };
