const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, verifyAdmin } = require('../middleware/auth.middleware');

// Protect all admin routes
router.use(authenticateToken);
router.use(verifyAdmin); // Assuming this middleware checks for role === 'admin'

// Get all violations
router.get('/violations', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT v.*, u.name, u.reg_no 
            FROM violations v
            JOIN users u ON v.user_id = u.id
            ORDER BY v.timestamp DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.warn('⚠️ Admin Violations Load Failed (Partial Mode):', error.message);
        try {
            const memoryStore = require('../services/memoryStore');
            const violations = memoryStore.getViolations();
            const users = memoryStore.getAllUsers();

            // Join manually
            const joined = violations.map(v => {
                const user = users.find(u => u.id === v.user_id) || { name: 'Unknown', reg_no: 'N/A' };
                return { ...v, name: user.name, reg_no: user.reg_no };
            }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.json(joined);
        } catch (memErr) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Get all submissions with optional filters
router.get('/submissions', async (req, res) => {
    try {
        const { batch, department, class: className } = req.query;
        let query = `
            SELECT s.*, u.name, u.reg_no, u.email, u.batch_year, u.department, u.class_name
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (batch) {
            query += ` AND u.batch_year = $${paramIndex++}`;
            params.push(batch);
        }
        if (department) {
            query += ` AND u.department = $${paramIndex++}`;
            params.push(department);
        }
        if (className) {
            query += ` AND u.class_name = $${paramIndex++}`;
            params.push(className);
        }

        query += ` ORDER BY s.created_at DESC`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.warn('⚠️ Admin Submissions Load Failed (Partial Mode):', error.message);
        // Fallback to memory store (simplified, no filtering implemented for memory store)
        try {
            const memoryStore = require('../services/memoryStore');
            const submissions = memoryStore.getSubmissions();
            const users = memoryStore.getAllUsers();

            // Join manually
            let joined = submissions.map(s => {
                const user = users.find(u => u.id === s.user_id) || { name: 'Unknown', reg_no: 'N/A', email: 'N/A', batch_year: '', department: '', class_name: '' };
                return { ...s, name: user.name, reg_no: user.reg_no, email: user.email, batch_year: user.batch_year, department: user.department, class_name: user.class_name };
            });

            // Filter in memory
            const { batch, department, class: className } = req.query;
            if (batch) joined = joined.filter(s => s.batch_year === batch);
            if (department) joined = joined.filter(s => s.department === department);
            if (className) joined = joined.filter(s => s.class_name === className);

            joined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.json(joined);
        } catch (memErr) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Export data (CSV)
router.get('/export', async (req, res) => {
    try {
        const { batch, department, class: className } = req.query;
        let users, submissions, violations;

        try {
            // Build Users Query with Filters
            let userQuery = `SELECT * FROM users WHERE 1=1`;
            const params = [];
            let paramIndex = 1;

            if (batch) {
                userQuery += ` AND batch_year = $${paramIndex++}`;
                params.push(batch);
            }
            if (department) {
                userQuery += ` AND department = $${paramIndex++}`;
                params.push(department);
            }
            if (className) {
                userQuery += ` AND class_name = $${paramIndex++}`;
                params.push(className);
            }

            // Try DB First
            const usersResult = await db.query(userQuery, params);
            const submissionsResult = await db.query('SELECT * FROM submissions'); // Fetch all subs, filter in loop
            const violationsResult = await db.query('SELECT * FROM violations');

            users = usersResult.rows;
            submissions = submissionsResult.rows;
            violations = violationsResult.rows;
        } catch (dbErr) {
            console.warn('⚠️ Export DB Failed (Partial Mode). Using Memory Store.');
            const memoryStore = require('../services/memoryStore');
            users = memoryStore.getAllUsers();
            submissions = memoryStore.getSubmissions();
            violations = memoryStore.getViolations();

            // Apply filters in memory
            if (batch) users = users.filter(u => u.batch_year === batch);
            if (department) users = users.filter(u => u.department === department);
            if (className) users = users.filter(u => u.class_name === className);
        }

        // Generate CSV - Detailed Submissions Report
        let csv = 'Student Name,Register Number,Batch,Department,Class,Problem ID,Language,Status,Score,Submission Time\n';

        // Helper Map for Users
        const userMap = new Map();
        users.forEach(u => userMap.set(u.id, u));

        // Filter submissions based on filtered users
        // If users were filtered (by batch/dept), we only want submissions from those users.
        const filteredUserIds = new Set(users.map(u => u.id));
        const filteredSubmissions = submissions.filter(s => filteredUserIds.has(s.user_id));

        // Sort by time desc
        filteredSubmissions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        for (const sub of filteredSubmissions) {
            const user = userMap.get(sub.user_id);
            if (!user) continue;

            const time = new Date(sub.created_at).toLocaleString();
            // Escape commas in name
            const name = user.name ? `"${user.name}"` : 'Unknown';

            csv += `${name},${user.reg_no},${user.batch_year || ''},${user.department || ''},${user.class_name || ''},${sub.problem_id},${sub.language},${sub.status},${sub.score},"${time}"\n`;
        }

        res.header('Content-Type', 'text/csv');
        res.attachment('contest_submissions_report.csv');
        return res.send(csv);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
