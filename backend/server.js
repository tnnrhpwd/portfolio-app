const path = require('path'); // module to read file locations
const express = require('express'); // import express to create REST API server
const helmet = require('helmet'); // security middleware
const compression = require('compression'); // compression middleware
const dotenv = require('dotenv').config();   // import env vars from .env
const { errorHandler } = require('./middleware/errorMiddleware');    // creates json of error
const { logger, requestLogger } = require('./utils/logger'); // logging middleware
const { apiLimiter } = require('./middleware/rateLimiter'); // rate limiting
const { sanitizeInput } = require('./middleware/validation'); // input sanitization
const port = process.env.PORT || 5000;  //set port to hold api server
var cors = require('cors')
const { loadDeepSeekKey, loadAllSecrets } = require('./utils/awsSecrets'); // Secrets Manager: all secrets + DeepSeek fallback

const app = express() // Calls the express function "express()" and puts new Express application inside the app variable

// Trust proxy settings for rate limiting
app.set('trust proxy', 1); // Trust first proxy

// Security middleware with development-friendly settings
if (process.env.NODE_ENV === 'production') {
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
} else {
  // More lenient helmet settings for development
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP in development
    hsts: false // Disable HSTS in development
  }));
}

// CORS configuration - simplified for development
if (process.env.NODE_ENV === 'production') {
  // Strict CORS for production
  const allowedOrigins = [
    'https://www.sthopwood.com',
    'https://sthopwood.com',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  console.log('Production CORS allowed origins:', allowedOrigins);

  app.use(cors({
    origin: function (origin, callback) {
      console.log('CORS check for origin:', origin);
      
      if (!origin) {
        console.log('No origin header, allowing request');
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        console.log('Origin allowed:', origin);
        callback(null, true);
      } else {
        console.warn('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} else {
  // Permissive CORS for development
  app.use(cors({
    origin: true, // Allow all origins in development
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
}

// Compression middleware
app.use(compression());

// Request logging
app.use(requestLogger);

// Rate limiting — applied once here globally (NOT duplicated in routeData.js)
app.use('/api/', apiLimiter);

// CSRF defense-in-depth: reject state-changing requests without a custom header.
// Browsers won't send custom headers in "simple" cross-origin requests without a
// CORS preflight, which is already restricted above. This adds an extra layer even
// though JWT bearer auth isn't vulnerable to classic CSRF.
app.use('/api/', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Stripe webhook sends application/json from server-to-server — exempt it
  if (req.originalUrl.includes('/webhook')) return next();
  const ct = (req.headers['content-type'] || '').toLowerCase();
  const hasCustomHeader = req.headers['authorization'] || req.headers['x-requested-with'];
  // Allow if there's a custom header OR a non-simple content-type (both trigger preflight)
  if (hasCustomHeader || (ct && !ct.startsWith('text/plain') && !ct.startsWith('application/x-www-form-urlencoded') && !ct.startsWith('multipart/form-data'))) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: missing required request headers.' });
});

// Stripe webhooks must be read as RAW bytes for signature verification —
// register this before the global JSON parser, which would otherwise consume
// the request stream and break `stripe.webhooks.constructEvent`.
app.use('/api/data/webhook', express.raw({ type: 'application/json' }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb for security
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Input sanitization
app.use(sanitizeInput);

// Funnel timing — records step timestamps when the test user hits key endpoints
const funnelTimingMiddleware = require('./middleware/funnelTiming');
app.use('/api/data', funnelTimingMiddleware);

// Route registration + server start are deferred so AWS Secrets Manager can
// populate process.env.DEEPSEEK_API_KEY before any route is loaded (routes
// transitively require llmProviders.js, which reads that env var at load).
async function start() {
  // Hydrate all non-AWS secrets from AWS Secrets Manager (single source of
  // truth). Values already in process.env — e.g. from the local `.env` loaded
  // by dotenv above — win; Secrets Manager only fills gaps.
  await loadAllSecrets();
  // DeepSeek-specific fallback (legacy `portfolio-app/deepseek` secret). This
  // is a no-op when loadAllSecrets already populated DEEPSEEK_API_KEY.
  await loadDeepSeekKey();

  app.use('/api/data', require('./routes/routeData')) // serve all data at /api/data (regardless of hit url)

  // Root endpoint for deployment health checks
  app.get('/', (req, res) => {
    res.status(200).json({
      message: 'Backend is running!',
      service: 'portfolio-app-backend',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // Silently handle common browser requests that aren't real API routes
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Client error telemetry. The React ErrorBoundary POSTs caught render errors
  // here (components/ErrorBoundary/ErrorBoundary.jsx). Without this route the
  // request 404'd, so every caught render error was silently dropped. Public by
  // necessity (a crash can happen before/without login); the global /api/
  // limiter bounds abuse, and the payload is clipped so a stack can't flood
  // the log. Only the fields we expect are read — never the raw body.
  const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);
  app.post('/api/log-error', (req, res) => {
    const body = req.body || {};
    logger.error('[client-error]', {
      message: clip(body.message, 500),
      stack: clip(body.stack, 4000),
      componentStack: clip(body.componentStack, 4000),
      timestamp: clip(body.timestamp, 40),
      userAgent: clip(body.userAgent, 300),
      url: clip(body.url, 500),
      userId: clip(String(body.userId ?? ''), 100),
      ip: req.ip,
    });
    res.status(204).end();
  });

  // Handle 404 for undefined routes
  app.use((req, res) => {
    logger.warn(`404 - Route not found: ${req.originalUrl}`, {
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(404).json({
      error: 'Route not found',
      path: req.originalUrl
    });
  });

  app.use(errorHandler) // adds middleware that returns errors in json format (regardless of hit url)

  const server = app.listen(port, () => {
    logger.info(`Server started on port ${port}`);
  }); // listen for incoming http requests on the PORT

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use.`);
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
}

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
