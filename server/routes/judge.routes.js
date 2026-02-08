const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth.middleware');
const problemService = require('../services/problemService');
const judgeService = require('../services/judgeService');

// Get all problems
router.get('/problems', authenticateToken, (req, res) => {
    res.json(problemService.getProblems());
});

// Run code (sample test cases)
router.post('/run', authenticateToken, async (req, res) => {
    try {
        const { code, language, problemId } = req.body;
        const problem = problemService.getProblem(problemId);

        if (!problem) {
            return res.status(404).json({ error: 'Problem not found' });
        }

        const sampleCases = problem.testCases.slice(0, 2);
        const results = await judgeService.testCode(code, language, problem.functionName, sampleCases);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Submit code (all test cases)
router.post('/submit', authenticateToken, async (req, res) => {
    try {
        const { code, language, problemId } = req.body;
        const problem = problemService.getProblem(problemId);

        if (!problem) {
            return res.status(404).json({ error: 'Problem not found' });
        }

        const results = await judgeService.testCode(code, language, problem.functionName, problem.testCases);
        const passed = results.filter(r => r.passed).length;
        const total = results.length;
        const allPassed = passed === total;
        const score = allPassed ? problem.points : 0;
        const status = allPassed ? 'Accepted' : 'Wrong Answer';

        // Store submission in DB
        await db.query(
            'INSERT INTO submissions (user_id, problem_id, language, status, score) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, problemId, language, status, score]
        );

        res.json({
            results,
            passed,
            total,
            allPassed,
            score
        });

    } catch (error) {
        console.error('Submission error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Log Violation
router.post('/log-violation', authenticateToken, async (req, res) => {
    try {
        const { violationType, timestamp } = req.body;

        await db.query(
            'INSERT INTO violations (user_id, type, timestamp) VALUES ($1, $2, $3)',
            [req.user.id, violationType, timestamp || new Date()]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Violation logging error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Leaderboard
router.get('/leaderboard', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                u.name, 
                u.reg_no, 
                SUM(s.score) as total_score,
                COUNT(DISTINCT s.problem_id) FILTER (WHERE s.status = 'Accepted') as problems_solved
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            GROUP BY u.id
            ORDER BY total_score DESC, problems_solved DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
