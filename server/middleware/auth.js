/**
 * Authentication Middleware
 * Implements JWT-based authentication for API endpoints
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token for a user
 * @param {Object} payload - User data to include in token
 * @returns {string} JWT token
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
}

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Authentication middleware - requires valid JWT token
 * Token can be provided in:
 * - Authorization header: "Bearer <token>"
 * - x-auth-token header: "<token>"
 */
export function requireAuth(req, res, next) {
  try {
    // Extract token from headers
    let token = null;

    // Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Check x-auth-token header (alternative)
    if (!token && req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
    }

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No token provided'
      });
    }

    // Verify token
    const decoded = verifyToken(token);

    // Attach user info to request object
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Optional authentication - attaches user if token present, but doesn't require it
 */
export function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      req.user = decoded;
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }
  next();
}

/**
 * Development-only: Generate a test token
 * Usage: POST /api/auth/dev-token with { userId, username }
 */
export function generateDevToken(req, res) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  const { userId = 'dev-user', username = 'developer' } = req.body;

  const token = generateToken({ userId, username });

  res.json({
    token,
    expiresIn: JWT_EXPIRES_IN,
    user: { userId, username }
  });
}
