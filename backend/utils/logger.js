const winston = require('winston');
const path = require('path');

// Some test environments (e.g. this repo's Jest config uses jsdom for
// backend tests) don't provide `setImmediate`, which winston's Console
// transport relies on internally. Polyfill it before winston is used; real
// Node runtimes already have `setImmediate`, so this is a no-op there.
if (typeof setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'portfolio-app-backend' },
  transports: [
    // Write to all logs with level 'info' and below to 'combined.log'
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/combined.log') 
    }),
  ],
});

// If we're not in production then also log to the console. Keep the console
// output terse (level + message only) — the full JSON with timestamp/service
// metadata is still written to the log files above for later inspection.
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message }) => `${level}: ${message}`)
);

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Security logger for authentication and security events
const securityLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'portfolio-app-security' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/security.log') 
    }),
  ],
});

// In dev, also surface security events on the console so auth failures are visible
if (process.env.NODE_ENV !== 'production') {
  securityLogger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    };
    
    // Successful requests are debug-level noise during normal development —
    // enable with LOG_LEVEL=debug for a full request trace. Client errors
    // (4xx) are warnings; server errors (5xx) are logged as errors so
    // problems remain visible by default.
    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request failed', logData);
    } else {
      logger.debug('Request completed', logData);
    }
  });
  
  next();
};

// Security event logger
const logSecurityEvent = (event, details, req = null) => {
  const logData = {
    event,
    details,
    timestamp: new Date().toISOString(),
    ip: req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.get('User-Agent'),
    userId: req?.user?.id
  };
  
  securityLogger.warn('Security event', logData);
};

module.exports = {
  logger,
  securityLogger,
  requestLogger,
  logSecurityEvent
};
