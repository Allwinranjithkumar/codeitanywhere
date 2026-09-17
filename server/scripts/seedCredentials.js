/**
 * seedCredentials.js
 * Ensures:
 * 1. codeitanywhere@gmail.com is ADMIN with password 'admin'
 * 2. test@gmail.com is STUDENT/TESTER with password 'test'
 */

const db = require('../db');
const bcrypt = require('bcrypt');

async function seedUsers() {
    console.log('[SeedCredentials] Setting up accounts...');

    const adminHash = await bcrypt.hash('admin', 12);
    const testHash = await bcrypt.hash('test', 12);

    // 1. Admin
    const adminRes = await db.query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ('CodeItAnywhere Admin', 'codeitanywhere@gmail.com', $1, 'admin', TRUE)
         ON CONFLICT (email) DO UPDATE 
         SET role = 'admin', password_hash = $1, name = 'CodeItAnywhere Admin', is_active = TRUE
         RETURNING id, name, email, role`,
        [adminHash]
    );
    console.log('[SeedCredentials] Admin account ready:', adminRes.rows[0]);

    // 2. Tester
    const testRes = await db.query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ('Platform Tester', 'test@gmail.com', $1, 'student', TRUE)
         ON CONFLICT (email) DO UPDATE 
         SET role = 'student', password_hash = $1, name = 'Platform Tester', is_active = TRUE
         RETURNING id, name, email, role`,
        [testHash]
    );
    console.log('[SeedCredentials] Tester account ready:', testRes.rows[0]);

    // 3. Set anti_cheat to FALSE on all existing contests
    const contestRes = await db.query(`UPDATE contests SET anti_cheat = FALSE`);
    console.log(`[SeedCredentials] Updated ${contestRes.rowCount} contest(s) to have anti_cheat = FALSE.`);
}

if (require.main === module) {
    seedUsers()
        .then(() => {
            console.log('[SeedCredentials] Completed successfully.');
            process.exit(0);
        })
        .catch(err => {
            console.error('[SeedCredentials] Error:', err);
            process.exit(1);
        });
}

module.exports = seedUsers;
