// This file exports a function used as middleware to made errors readable in json format
const { logger } = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    // Use err.statusCode first (set by controllers), then res.statusCode only
    // if explicitly set to a non-200 value, otherwise default to 500.
    // Express defaults res.statusCode to 200, so we must not trust it blindly.
    const statusCode = err.statusCode || err.status || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);

    // Log the error for debugging / monitoring
    logger.error(`[${statusCode}] ${req.method} ${req.originalUrl} — ${err.message}`, {
        statusCode,
        method: req.method,
        url: req.originalUrl,
        stack: err.stack,
    });

    res.status(statusCode);

    res.json({
        dataMessage: process.env.NODE_ENV === 'production' && statusCode >= 500
            ? 'Internal server error'
            : err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
}

module.exports = {
  errorHandler,
}
  