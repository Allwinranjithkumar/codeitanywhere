/**
 * seedAdmin.js — Creates the admin user on first startup.
 *
 * Security:
 * - Admin credentials are read from environment variables ONLY.
 * - The function will refuse to create an admin if env vars are missing.
 * - Credentials are NEVER printed to console.
 * - bcrypt cost factor 12.
 */

const db     = require('../db');
const bcrypt = require('bcrypt');

async function seedAdmin() {
    const email    = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const name     = process.env.ADMIN_NAME     || 'System Administrator';
    const reg_no   = process.env.ADMIN_REG_NO   || 'ADMIN001';

    if (!email || !password) {
        console.warn('[Admin Seed] ADMIN_EMAIL or ADMIN_PASSWORD not set in .env — skipping admin creation.');
        console.warn('[Admin Seed] Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file to create the admin account.');
        return;
    }

    try {
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rowCount > 0) {
            console.log('[Admin Seed] Admin user already exists.');
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await db.query(
            `INSERT INTO users (name, email, reg_no, password_hash, role)
             VALUES ($1, $2, $3, $4, 'admin')`,
            [name, email, reg_no, hashedPassword]
        );

        // Do NOT log the admin password
        console.log(`[Admin Seed] Admin user created: ${email}`);

    } catch (error) {
        console.error('[Admin Seed] Failed to seed admin user:', error.message);
    }
}

module.exports = seedAdmin;
