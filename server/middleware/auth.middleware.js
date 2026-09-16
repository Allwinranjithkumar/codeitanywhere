/**
 * auth.middleware.js — JWT Authentication & Authorization Middleware
 *
 * Security notes:
 * - JWT_SECRET MUST be set in environment variables.
 * - The server will refuse to start without it (enforced in server.js).
 * - Role is read from the verified JWT payload (signed server-side).
 * - Client-supplied role claims are NEVER trusted.
 */

const jwt = require('jsonwebtoken');

function getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('FATAL: JWT_SECRET environment variable is not set.');
    }
    return secret;
}

/**
 * Verify Bearer JWT token on incoming request.
 * Attaches the decoded payload to req.user on success.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
        const user = jwt.verify(token, getSecret());
        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        return res.status(403).json({ error: 'Invalid token.' });
    }
}

/**
 * Require the authenticated user to have the 'admin' role.
 * Must be used AFTER authenticateToken.
 */
function verifyAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.status(403).json({ error: 'Admin access required.' });
}

module.exports = { authenticateToken, verifyAdmin };
