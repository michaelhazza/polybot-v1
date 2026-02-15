/**
 * Authentication Routes
 * Development-only endpoints for token generation
 */

import express from 'express';
import { generateDevToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/auth/dev-token - Generate development token
 * Only available in non-production environments
 *
 * Body: { userId?: string, username?: string }
 * Response: { token, expiresIn, user }
 */
router.post('/dev-token', generateDevToken);

export default router;
