/**
 * seedAdmin.js — Seeds admin and tester accounts on startup.
 */

const db     = require('../db');
const bcrypt = require('bcrypt');

async function seedAdmin() {
    const adminEmail    = (process.env.ADMIN_EMAIL || 'codeitanywhere@gmail.com').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    const adminName     = process.env.ADMIN_NAME     || 'CodeItAnywhere Admin';
    const adminRegNo    = process.env.ADMIN_REG_NO   || 'ADMIN001';

    try {
        // 1. Seed or update Admin
        const hashedAdminPassword = await bcrypt.hash(adminPassword, 12);
        await db.query(
            `INSERT INTO users (name, email, reg_no, password_hash, role, is_active)
             VALUES ($1, $2, $3, $4, 'admin', TRUE)
             ON CONFLICT (email) DO UPDATE
             SET role = 'admin', password_hash = $4, name = $1, is_active = TRUE`,
            [adminName, adminEmail, adminRegNo, hashedAdminPassword]
        );
        console.log(`[Admin Seed] Admin account verified: ${adminEmail}`);

        // 2. Seed or update Tester (test@gmail.com / test)
        const hashedTestPassword = await bcrypt.hash('test', 12);
        await db.query(
            `INSERT INTO users (name, email, reg_no, password_hash, role, is_active)
             VALUES ('Platform Tester', 'test@gmail.com', 'TEST001', $1, 'student', TRUE)
             ON CONFLICT (email) DO UPDATE
             SET role = 'student', password_hash = $1, name = 'Platform Tester', is_active = TRUE`,
            [hashedTestPassword]
        );
        console.log('[Admin Seed] Tester account verified: test@gmail.com');

    } catch (error) {
        console.error('[Admin Seed] Failed to seed admin/tester user:', error.message);
    }
}

module.exports = seedAdmin;
