const path = require('path'); // module to read file locations
const express = require('express'); // import express to create REST API server
const colors = require('colors'); // allows the console to print colored text
const helmet = require('helmet'); // security middleware
const compression = require('compression'); // compression middleware
const dotenv = require('dotenv').config();   // import env vars from .env
const { errorHandler } = require('./middleware/errorMiddleware');    // creates json of error
const { logger, requestLogger } = require('./middleware/logger'); // logging middleware
const { apiLimiter } = require('./middleware/rateLimiter'); // rate limiting
const { sanitizeInput } = require('./middleware/validation'); // input sanitization
const port = process.env.PORT || 5000;  //set port to hold api server
var cors = require('cors')

const app = express() // Calls the express function "express()" and puts new Express application inside the app variable

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || 'https://sthopwood.com'
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Compression middleware
app.use(compression());

// Request logging
app.use(requestLogger);

// Rate limiting
app.use('/api/', apiLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb for security
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Input sanitization
app.use(sanitizeInput);

app.use('/api/data', require('./routes/routeData')) // serve all data at /api/data (regardless of hit url)

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

app.use(errorHandler) // adds middleware that returns errors in json format (regardless of hit url)

  logger.info('Connected to DynamoDB');  // print confirmation
  const server = app.listen(port, () => {
    logger.info(`Server started on port ${port}`);
    console.log(`Server started on port ${port}`.green.bold);
  }); // listen for incoming http requests on the PORT && print PORT in console
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use.`);
      console.error(`Port ${port} is already in use.`.red);
      process.exit(1);
    } else {
      logger.error('Server error:', err);
      throw err;
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
      logger.info('Process terminated');
      process.exit(0);
    });
  });