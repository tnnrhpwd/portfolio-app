const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Validation rules for user registration
const validateRegistration = [
  body('nickname')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Nickname must be between 2 and 50 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Nickname can only contain letters, numbers, underscores, and hyphens'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
    .isLength({ max: 100 })
    .withMessage('Email must not exceed 100 characters'),
  
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'),
];

// Validation rules for user login
const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

// Validation rules for data creation
const validateDataCreation = [
  body('text')
    .optional()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Text content must not exceed 10,000 characters'),
];

// Validation rules for payment data
const validatePaymentData = [
  body('amount')
    .optional() // Make amount optional for setup intents
    .isNumeric()
    .withMessage('Amount must be a number')
    .custom((value) => {
      if (value !== undefined && value <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      if (value !== undefined && value > 999999) {
        throw new Error('Amount must be less than $999,999');
      }
      return true;
    }),
  
  body('currency')
    .optional() // Make currency optional for setup intents
    .matches(/^[A-Z]{3}$/)
    .withMessage('Currency must be a 3-letter ISO code (e.g., USD)'),
  
  // Custom validation to ensure amount and currency are both provided if either is provided
  body().custom((value, { req }) => {
    const { amount, currency } = req.body;
    
    // If paymentMethodId is provided, we don't need amount/currency validation
    if (req.body.paymentMethodId) {
      return true;
    }
    
    // If neither amount nor currency are provided, it's likely a setup intent request
    if (!amount && !currency) {
      return true;
    }
    
    // If one is provided but not the other, that's an error
    if ((amount && !currency) || (!amount && currency)) {
      throw new Error('Both amount and currency must be provided together');
    }
    
    return true;
  })
    .withMessage('Payment data validation failed'),
];

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Sanitize request body to prevent XSS
const sanitizeInput = (req, res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      // Remove potentially dangerous HTML/script tags
      return value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                  .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                  .replace(/javascript:/gi, '')
                  .replace(/on\w+\s*=/gi, '');
    } else if (typeof value === 'object' && value !== null) {
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  };

  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  
  next();
};

module.exports = {
  validateRegistration,
  validateLogin,
  validateDataCreation,
  validatePaymentData,
  handleValidationErrors,
  sanitizeInput
};
