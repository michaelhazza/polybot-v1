/**
 * Input Validation Middleware
 * Uses Joi for comprehensive request validation
 */

import Joi from 'joi';

/**
 * Validation schemas for backtest endpoints
 */
export const schemas = {
  // POST /api/backtests - Create backtest
  createBacktest: Joi.object({
    asset: Joi.string()
      .valid('BTC', 'ETH', 'SOL')
      .required()
      .messages({
        'any.only': 'Asset must be one of: BTC, ETH, SOL',
        'any.required': 'Asset is required'
      }),

    timeframe: Joi.string()
      .valid('5min', '15min', '1hr')
      .required()
      .messages({
        'any.only': 'Timeframe must be one of: 5min, 15min, 1hr',
        'any.required': 'Timeframe is required'
      }),

    period: Joi.string()
      .valid('30d', '60d', '3m', '6m')
      .required()
      .messages({
        'any.only': 'Period must be one of: 30d, 60d, 3m, 6m',
        'any.required': 'Period is required'
      }),

    tradeSize: Joi.number()
      .min(1)
      .max(100000)
      .required()
      .messages({
        'number.min': 'Trade size must be at least $1',
        'number.max': 'Trade size cannot exceed $100,000',
        'any.required': 'Trade size is required'
      }),

    name: Joi.string()
      .max(100)
      .optional()
      .messages({
        'string.max': 'Name cannot exceed 100 characters'
      })
  }),

  // Query parameters for pagination/limits
  queryLimit: Joi.object({
    limit: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .default(10)
      .messages({
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 1000'
      })
  }),

  // UUID validation for route parameters
  uuidParam: Joi.object({
    id: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.guid': 'Invalid ID format - must be a valid UUID',
        'any.required': 'ID is required'
      })
  })
};

/**
 * Middleware factory for request validation
 * @param {Object} schema - Joi schema to validate against
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Return all errors, not just the first
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace request data with validated/sanitized data
    req[property] = value;
    next();
  };
}

/**
 * Sanitize HTML to prevent XSS
 * Simple implementation - removes < and > characters
 */
export function sanitizeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, '');
}

/**
 * Middleware to sanitize all string inputs
 */
export function sanitizeInputs(req, res, next) {
  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  next();
}

function sanitizeObject(obj) {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeHtml(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
