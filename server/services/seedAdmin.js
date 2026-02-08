const db = require('../db');
const bcrypt = require('bcrypt');

async function seedAdmin() {
    try {
        const email = 'admin@codeitanywhere.com';
        const password = 'admin';
        const name = 'System Administrator';
        const reg_no = 'ADMIN001';

        // Check if exists
        const check = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (check.rowCount > 0) {
            console.log('✅ Admin user already exists.');
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO users (name, email, reg_no, password_hash, role) 
             VALUES ($1, $2, $3, $4, 'admin')`,
            [name, email, reg_no, hashedPassword]
        );

        console.log('🎉 Admin user created successfully: admin@codeitanywhere.com / admin');

    } catch (error) {
        console.error('❌ Failed to seed admin:', error.message);
    }
}

module.exports = seedAdmin;
