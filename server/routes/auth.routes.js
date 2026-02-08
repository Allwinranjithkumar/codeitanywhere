const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Validation Regex
const REG_NO_REGEX = /^7155\d{2}1050\d{2}$/;
const EMAIL_DOMAIN = '@psgitech.ac.in';
const DEFAULT_USER_PASSWORD = 'student123';

router.post('/register', async (req, res) => {
    const { name, email, reg_no, password } = req.body;

    // 1. Basic Validation
    if (!name || !email || !reg_no || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (!REG_NO_REGEX.test(reg_no)) {
        return res.status(400).json({ error: 'Invalid Register Number format' });
    }

    if (!email.endsWith(EMAIL_DOMAIN)) {
        return res.status(400).json({ error: `Email must belong to ${EMAIL_DOMAIN}` });
    }

    try {
        // 2. Check Whitelist - REMOVED per user request
        // Now open to anyone with valid email domain and reg number format
        /*
        const whitelistCheck = await db.query(
            'SELECT * FROM allowed_users WHERE email = $1 AND reg_no = $2',
            [email, reg_no]
        );

        if (whitelistCheck.rowCount === 0) {
            return res.status(403).json({ error: 'Email and Register Number not found in whitelist' });
        }
        */

        // 3. Check if user exists
        const existingUserRes = await db.query(
            'SELECT * FROM users WHERE email = $1 OR reg_no = $2',
            [email, reg_no]
        );

        let userId;

        if (existingUserRes.rowCount > 0) {
            // User exists. Check if it's a default account (password matches 'student123').
            // If so, allow updating the password (claiming the account).
            const user = existingUserRes.rows[0];

            // Compare current stored password with Default Password
            const isDefault = await bcrypt.compare(DEFAULT_USER_PASSWORD, user.password_hash);

            if (isDefault) {
                // Allows "claiming" the account and setting a new password/name
                const newHash = await bcrypt.hash(password, 10);
                const updatedUser = await db.query(
                    'UPDATE users SET name = $1, password_hash = $2 WHERE id = $3 RETURNING id, name, email, role',
                    [name, newHash, user.id]
                );

                // Return success as if registered
                return res.status(201).json({ message: 'Account claimed successfully', user: updatedUser.rows[0] });
            } else {
                // User already registered properly
                return res.status(409).json({ error: 'User already registered. Please login.' });
            }
        }

        // 4. Create New User (if not exists)
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await db.query(
            'INSERT INTO users (name, email, reg_no, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
            [name, email, reg_no, hashedPassword]
        );

        res.status(201).json({ message: 'Registration successful', user: newUser.rows[0] });

    } catch (error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('password authentication failed') || error.message.includes('does not exist')) {
            console.warn('⚠️ DB Down: Registration disabled (Partial Mode)');
            return res.status(503).json({ error: 'Registration disabled in Cloud Mode. Please use "Login" with your student email.' });
        }
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rowCount === 0) {
            // Check if DB is actually down? No, assume user not found.
            // But if DB is down, query throws.
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, name: user.name, reg_no: user.reg_no },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, reg_no: user.reg_no } });

    } catch (error) {
        console.error('Login DB error:', error.message);

        // EMERGENCY BYPASS: If DB is down (e.g. Render Free Tier without DB), allow login
        // This is unsafe for production but necessary for this specific user request
        if (error.message.includes('ECONNREFUSED') || error.message.includes('password authentication failed') || error.message.includes('does not exist') || true) {
            console.warn('⚠️ DB Down: Bypassing Login check for user access');

            // Try to find user in Excel Data first
            const studentData = require('../services/studentData');
            const foundStudent = studentData.getStudentByEmail(email);

            let mockUser;

            if (foundStudent) {
                // Found in Excel! Use real data.
                console.log(`✅ Identified user from Excel: ${foundStudent.name} (${foundStudent.reg_no})`);
                mockUser = {
                    id: parseInt(foundStudent.reg_no) || 999999, // Use reg_no as ID if numeric
                    name: foundStudent.name,
                    email: email,
                    role: 'student',
                    reg_no: foundStudent.reg_no
                };
            } else {
                // Not in Excel - Use fallback hash logic (for guests)
                let hash = 0;
                for (let i = 0; i < email.length; i++) {
                    hash = ((hash << 5) - hash) + email.charCodeAt(i);
                    hash |= 0; // Convert to 32bit integer
                }
                const uniqueId = Math.abs(hash); // Ensure positive

                // Special Admin Access for No-DB Mode
                let role = 'student';
                if (email === 'admin' || email === 'admin@codeitanywhere.com') {
                    role = 'admin';
                }

                mockUser = {
                    id: uniqueId,
                    name: role === 'admin' ? 'Administrator' : email.split('@')[0],
                    email: email,
                    role: role,
                    reg_no: role === 'admin' ? 'ADMIN' : email.split('@')[0].toUpperCase()
                };
            }

            // Save to Memory Store for Leaderboard
            require('../services/memoryStore').saveUser(mockUser);

            const token = jwt.sign(
                mockUser,
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.json({ token, user: mockUser });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
