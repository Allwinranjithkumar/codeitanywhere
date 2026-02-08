const path = require('path');
// Force load .env from root, assuming this script is in server/scripts/
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { pool } = require('../db');
const bcrypt = require('bcrypt');

const DEFAULT_ADMIN_EMAIL = 'admin@codeitanywhere.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const ADMIN_NAME = 'System Admin';

async function createAdmin() {
    try {
        console.log('Connecting to DB:', process.env.DB_NAME, 'at', process.env.DB_HOST);

        // Ensure bcrypt hashes correctly
        const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

        // Upsert admin user
        const query = `
            INSERT INTO users (name, email, reg_no, password_hash, role)
            VALUES ($1, $2, 'ADMIN', $3, 'admin')
            ON CONFLICT (email) 
            DO UPDATE SET role = 'admin', password_hash = $3
            RETURNING id, email, role;
        `;

        const res = await pool.query(query, [ADMIN_NAME, DEFAULT_ADMIN_EMAIL, hashedPassword]);
        console.log('Admin user created successfully.');
        console.log('User:', res.rows[0].email);
        process.exit(0);
    } catch (err) {
        console.error('Error creating admin:', err);
        process.exit(1);
    }
}

createAdmin();
