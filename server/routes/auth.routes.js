/**
 * auth.routes.js — Registration & Login
 *
 * Security principles:
 * - Passwords are hashed with bcrypt (cost factor 12)
 * - JWT secret is always read from environment — no hardcoded fallback
 * - If the database is unavailable, a 503 is returned — NO bypass
 * - Role is always sourced from the database — never from client input
 * - Rate limiting applied to prevent brute-force attacks
 */

const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const bcrypt    = require('bcrypt');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// ──────────────────────────────────────────────
// Rate Limiting
// ──────────────────────────────────────────────

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,                   // max 20 auth requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('FATAL: JWT_SECRET is not set.');
    return secret;
}

/**
 * Parse a registration number to extract batch year, department, and class name.
 * Format: 7155|YY|DDDD|NN  (e.g. 715523105001)
 */
function parseRegNo(regNo) {
    const str = String(regNo);
    if (str.startsWith('7155') && str.length >= 10) {
        const yearCode = str.substring(4, 6);
        const deptCode = str.substring(6, 10);

        const deptMap = { '1050': 'EEE', '1053': 'EEE', '1120': 'ICE' };
        const department = deptMap[deptCode] || 'Unknown';
        const batchYear  = `20${yearCode}`;
        const className  = `${yearCode} ${department}`;

        return { batchYear, department, className };
    }
    return { batchYear: null, department: null, className: null };
}

// ──────────────────────────────────────────────
// POST /api/register
// ──────────────────────────────────────────────

router.post('/register', authLimiter, async (req, res, next) => {
    try {
        const { name, email, reg_no, password } = req.body;

        // ── Input Validation ──────────────────
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required.' });
        }

        if (typeof name !== 'string' || name.trim().length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters.' });
        }

        if (typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }

        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }

        // Registration number: use provided value or generate a simple identifier
        const userRegNo = (reg_no && typeof reg_no === 'string' && reg_no.trim().length > 0)
            ? reg_no.trim()
            : `REG${Math.floor(100000 + Math.random() * 900000)}`;

        // Optional institution-specific validation (only if explicitly set in .env)
        const regNoPattern = process.env.REG_NO_REGEX;
        if (regNoPattern) {
            const regex = new RegExp(regNoPattern);
            if (!regex.test(userRegNo)) {
                return res.status(400).json({ error: 'Invalid Registration Number format.' });
            }
        }

        const emailDomain = process.env.ALLOWED_EMAIL_DOMAIN;
        if (emailDomain && !email.toLowerCase().endsWith(emailDomain.toLowerCase())) {
            return res.status(400).json({ error: `Email must belong to ${emailDomain}` });
        }

        // ── Check for existing user ───────────
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1 OR reg_no = $2',
            [email.toLowerCase().trim(), userRegNo]
        );

        if (existing.rowCount > 0) {
            const existingUser = existing.rows[0];

            // Allow "claiming" a pre-created account that still has the default password
            const defaultPwd = await db.query(
                'SELECT password_hash FROM users WHERE id = $1',
                [existingUser.id]
            );
            const isDefaultPwd = await bcrypt.compare('student123', defaultPwd.rows[0].password_hash);

            if (isDefaultPwd) {
                const newHash = await bcrypt.hash(password, 12);
                const updated = await db.query(
                    `UPDATE users SET name = $1, password_hash = $2, updated_at = NOW()
                     WHERE id = $3
                     RETURNING id, name, email, role`,
                    [name.trim(), newHash, existingUser.id]
                );
                return res.status(200).json({
                    message: 'Account activated successfully. You can now log in.',
                    user: updated.rows[0]
                });
            }

            return res.status(409).json({ error: 'An account with this email or registration number already exists.' });
        }

        // ── Parse reg number ──────────────────
        const { batchYear, department, className } = parseRegNo(userRegNo);

        // ── Create user ───────────────────────
        const hashedPassword = await bcrypt.hash(password, 12);
        const result = await db.query(
            `INSERT INTO users (name, email, reg_no, password_hash, batch_year, department, class_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, email, role, reg_no, batch_year, department, class_name`,
            [name.trim(), email.toLowerCase().trim(), userRegNo, hashedPassword, batchYear, department, className]
        );

        return res.status(201).json({
            message: 'Registration successful. You can now log in.',
            user: result.rows[0]
        });

    } catch (error) {
        next(error);
    }
});

// ──────────────────────────────────────────────
// POST /api/login
// ──────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        // Fetch user from DB — NO fallback if DB is down
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
            [email.toLowerCase()]
        );

        if (result.rowCount === 0) {
            // Use the same generic message to prevent user enumeration
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Backfill classification data if missing (for legacy accounts)
        if (!user.batch_year && user.reg_no) {
            const { batchYear, department, className } = parseRegNo(user.reg_no);
            if (batchYear) {
                await db.query(
                    'UPDATE users SET batch_year=$1, department=$2, class_name=$3, updated_at=NOW() WHERE id=$4',
                    [batchYear, department, className, user.id]
                ).catch(() => {}); // Non-critical, best-effort
                user.batch_year = batchYear;
                user.department = department;
                user.class_name = className;
            }
        }

        // Sign JWT — role is ALWAYS from DB, never from client
        const payload = {
            id:         user.id,
            email:      user.email,
            role:       user.role,         // from DB
            name:       user.name,
            reg_no:     user.reg_no,
            batch_year: user.batch_year,
            department: user.department,
            class_name: user.class_name
        };

        const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });

        return res.json({
            token,
            user: {
                id:         user.id,
                name:       user.name,
                email:      user.email,
                role:       user.role,
                reg_no:     user.reg_no,
                batch_year: user.batch_year,
                department: user.department,
                class_name: user.class_name
            }
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;
