const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth.middleware');
const problemService = require('../services/problemService');
const judgeService = require('../services/judgeService');
const contestState = require('../services/contestState');

// Protect all routes
router.use(authenticateToken);

// Check contest status
router.get('/status', (req, res) => {
    res.json({ active: contestState.isContestActive() });
});

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

        // Check for existing submission
        const existingSub = await db.query(
            'SELECT * FROM submissions WHERE user_id = $1 AND problem_id = $2',
            [req.user.id, problemId]
        );

        if (existingSub.rowCount > 0) {
            // Update existing
            const oldScore = existingSub.rows[0].score;
            // If already solved (score > 0), keep old score. Else take new score.
            // Requirement: "The latest submission can replace the previous one, but score remains unchanged"
            // Interpreted as: Don't lose marks if you already solved it. Don't add duplicate marks.
            const finalScore = (oldScore > 0) ? oldScore : score;

            // Allow status update to show 'Wrong Answer' for the specific code run, 
            // BUT if we want to preserve the "Fact that they solved it", we might want to keep status='Accepted'?
            // User requirement says: "Allow re-submission ONLY for viewing or overwrite... marks must not increase."
            // Let's update status to reflect THIS submission, but keep score fixed if it was already > 0.

            try {
                await db.query(
                    'UPDATE submissions SET language = $1, status = $2, score = $3, created_at = CURRENT_TIMESTAMP WHERE user_id = $4 AND problem_id = $5',
                    [language, status, finalScore, req.user.id, problemId]
                );
            } catch (dbErr) {
                console.warn('⚠️ DB Update Failed (Partial Mode):', dbErr.message);
            }

        } else {
            // Insert new
            try {
                await db.query(
                    'INSERT INTO submissions (user_id, problem_id, language, status, score) VALUES ($1, $2, $3, $4, $5)',
                    [req.user.id, problemId, language, status, score]
                );
            } catch (dbErr) {
                console.warn('⚠️ DB Save Failed (Partial Mode):', dbErr.message);
                // Save to Memory Store (Fallback)
                require('../services/memoryStore').saveSubmission({
                    user_id: req.user.id,
                    problem_id: problemId,
                    language,
                    status,
                    score,
                    timestamp: new Date()
                });
            }
        }

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

        try {
            await db.query(
                'INSERT INTO violations (user_id, type, timestamp) VALUES ($1, $2, $3)',
                [req.user.id, violationType, timestamp || new Date()]
            );
        } catch (dbErr) {
            console.warn('⚠️ Violation Log Failed (Partial Mode):', dbErr.message);
            // Save to Memory Store
            require('../services/memoryStore').saveViolation({
                user_id: req.user.id,
                type: violationType,
                timestamp: timestamp || new Date()
            });
        }

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
        console.warn('⚠️ Leaderboard Load Failed (Partial Mode):', error.message);

        // Fetch from Memory Store
        const memoryStore = require('../services/memoryStore');
        const users = memoryStore.getAllUsers();
        const submissions = memoryStore.getSubmissions();

        // Aggregate Data manually
        const leaderboard = users.map(user => {
            const userSubs = submissions.filter(s => s.user_id === user.id);
            const score = userSubs.reduce((acc, curr) => acc + (curr.status === 'Accepted' ? curr.score : 0), 0);
            const uniqueSolved = new Set(userSubs.filter(s => s.status === 'Accepted').map(s => s.problem_id)).size;

            return {
                name: user.name,
                reg_no: user.reg_no,
                total_score: score,
                problems_solved: uniqueSolved
            };
        });

        // Sort descending
        leaderboard.sort((a, b) => b.total_score - a.total_score);

        res.json(leaderboard);
    }
});

module.exports = router;
