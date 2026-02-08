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

// Get all submissions
router.get('/submissions', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT s.*, u.name, u.reg_no, u.email
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.warn('⚠️ Admin Submissions Load Failed (Partial Mode):', error.message);
        try {
            const memoryStore = require('../services/memoryStore');
            const submissions = memoryStore.getSubmissions();
            const users = memoryStore.getAllUsers();

            // Join manually
            const joined = submissions.map(s => {
                const user = users.find(u => u.id === s.user_id) || { name: 'Unknown', reg_no: 'N/A', email: 'N/A' };
                return { ...s, name: user.name, reg_no: user.reg_no, email: user.email };
            }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.json(joined);
        } catch (memErr) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Export data (CSV)
router.get('/export', async (req, res) => {
    try {
        let users, submissions, violations;

        try {
            // Try DB First
            const usersResult = await db.query('SELECT * FROM users');
            const submissionsResult = await db.query('SELECT * FROM submissions');
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
        }

        // Logic to aggregate data similar to original server.js
        let csv = 'Student Name,Register Number,Email,Score,Problems Solved,Violations,Ai Detected\n';

        for (const user of users) {
            const userSubmissions = submissions.filter(s => s.user_id === user.id);
            const userViolations = violations.filter(v => v.user_id === user.id);

            const score = userSubmissions.reduce((acc, curr) => acc + (curr.status === 'Accepted' ? curr.score : 0), 0);
            const solved = new Set(userSubmissions.filter(s => s.status === 'Accepted').map(s => s.problem_id)).size;
            const violationCount = userViolations.length;
            const aiDetected = userViolations.some(v => v.type === 'ai_used') ? 'Yes' : 'No';

            csv += `${user.name},${user.reg_no},${user.email},${score},${solved},${violationCount},${aiDetected}\n`;
        }

        res.header('Content-Type', 'text/csv');
        res.attachment('contest_report.csv');
        return res.send(csv);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
