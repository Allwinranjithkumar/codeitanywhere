/**
 * judge.routes.js — Code execution & submission endpoints
 *
 * All routes require valid JWT authentication.
 * PostgreSQL is the only persistence layer — no in-memory fallback.
 *
 * Routes:
 *   GET  /api/judge/problems              — all active problems (no contest) — sample cases only
 *   POST /api/judge/run                   — run code against sample test cases only
 *   POST /api/judge/submit                — run against all test cases, persist submission
 *   GET  /api/judge/submissions/:problemId — student's own submission history for a problem
 *   GET  /api/judge/leaderboard           — global leaderboard from DB
 *   POST /api/judge/log-violation         — record an anti-cheat violation
 */

const express        = require('express');
const router         = express.Router();
const db             = require('../db');
const { authenticateToken } = require('../middleware/auth.middleware');
const problemService = require('../services/problemService');
const judgeService   = require('../services/judgeService');
const contestService = require('../services/contestService');

// All judge routes require authentication
router.use(authenticateToken);

const SUPPORTED_LANGUAGES = ['python', 'javascript', 'cpp', 'c', 'java'];

// ──────────────────────────────────────────────
// GET /api/judge/problems — all active problems (sample cases only)
// ──────────────────────────────────────────────

router.get('/problems', async (req, res, next) => {
    try {
        const problems = await problemService.getProblemsForStudent();
        res.json(problems);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// POST /api/judge/run — run against sample cases only (no DB write)
// ──────────────────────────────────────────────

router.post('/run', async (req, res, next) => {
    try {
        const { code, language, problemId } = req.body;

        if (!code || !language || problemId === undefined) {
            return res.status(400).json({ error: 'code, language, and problemId are required.' });
        }
        if (!SUPPORTED_LANGUAGES.includes(language)) {
            return res.status(400).json({ error: `Unsupported language. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` });
        }

        const problem = await problemService.getProblemWithTestCases(problemId);
        if (!problem) return res.status(404).json({ error: 'Problem not found.' });

        // Run only sample test cases — never expose hidden ones during "run"
        const sampleCases = problem.testCases.filter(tc => tc.isSample).slice(0, 3);
        if (sampleCases.length === 0) {
            return res.status(400).json({ error: 'No sample test cases available for this problem.' });
        }

        const { results, executionTimeMs } = await judgeService.testCode(
            code, language, problem.functionName, sampleCases
        );

        res.json({ results, executionTimeMs });

    } catch (err) {
        // Return compile/runtime errors as structured responses, not 500s
        if (err.message && !err.message.includes('FATAL')) {
            return res.status(422).json({ error: err.message });
        }
        next(err);
    }
});

// ──────────────────────────────────────────────
// POST /api/judge/submit — run all test cases, persist to DB
// ──────────────────────────────────────────────

router.post('/submit', async (req, res, next) => {
    try {
        const { code, language, problemId, contestId } = req.body;

        if (!code || !language || problemId === undefined) {
            return res.status(400).json({ error: 'code, language, and problemId are required.' });
        }
        if (!SUPPORTED_LANGUAGES.includes(language)) {
            return res.status(400).json({ error: `Unsupported language. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` });
        }

        // If a contestId is provided, verify contest is still active before accepting submission
        if (contestId) {
            const { active } = await contestService.getContestStatus(contestId);
            if (!active) {
                return res.status(403).json({ error: 'The contest has ended. Submissions are no longer accepted.' });
            }
        }

        const problem = await problemService.getProblemWithTestCases(problemId);
        if (!problem) return res.status(404).json({ error: 'Problem not found.' });

        // Run against ALL test cases
        const { results, executionTimeMs } = await judgeService.testCode(
            code, language, problem.functionName, problem.testCases
        );

        const passed    = results.filter(r => r.passed).length;
        const total     = results.length;
        const allPassed = passed === total;
        const score     = allPassed ? problem.points : Math.floor((passed / total) * problem.points);
        const status    = allPassed ? 'Accepted'
                        : results.some(r => r.actual && String(r.actual).startsWith('Error:')) ? 'Runtime Error'
                        : 'Wrong Answer';

        // Find the first error message if any
        const errorMsg = results.find(r => r.error)?.error || null;

        // Persist submission (new row every time — full history)
        await db.query(
            `INSERT INTO submissions
             (user_id, contest_id, problem_id, language, source_code, status, score,
              passed_tests, total_tests, execution_time_ms, error_message)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                req.user.id,
                contestId || null,
                problemId,
                language,
                code,
                status,
                score,
                passed,
                total,
                executionTimeMs,
                errorMsg
            ]
        );

        // Return results but HIDE expected output for hidden test cases
        const safeResults = results.map((r, i) => {
            const isSample = problem.testCases[i]?.isSample;
            return {
                passed:   r.passed,
                input:    isSample ? r.input    : '[hidden]',
                expected: isSample ? r.expected : '[hidden]',
                actual:   r.actual,
                error:    r.error  || null
            };
        });

        res.json({
            results:        safeResults,
            passed,
            total,
            allPassed,
            score,
            status,
            executionTimeMs
        });

    } catch (err) {
        if (err.message && !err.message.includes('FATAL')) {
            // Compilation error / runtime error
            await db.query(
                `INSERT INTO submissions
                 (user_id, contest_id, problem_id, language, source_code, status, score,
                  passed_tests, total_tests, error_message)
                 VALUES ($1,$2,$3,$4,$5,'Compilation Error',0,0,0,$6)`,
                [req.user.id, req.body.contestId || null, req.body.problemId, req.body.language, req.body.code, err.message]
            ).catch(() => {}); // Best-effort persist
            return res.status(422).json({ error: err.message, status: 'Compilation Error' });
        }
        next(err);
    }
});

// ──────────────────────────────────────────────
// GET /api/judge/submissions/:problemId — own submission history
// ──────────────────────────────────────────────

router.get('/submissions/:problemId', async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT id, language, status, score, passed_tests, total_tests,
                    execution_time_ms, error_message, submitted_at
             FROM submissions
             WHERE user_id = $1 AND problem_id = $2
             ORDER BY submitted_at DESC`,
            [req.user.id, req.params.problemId]
        );
        // source_code is intentionally excluded — students can see their history but
        // we don't resend potentially large code blocks unless explicitly needed
        res.json(result.rows);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/judge/leaderboard — global leaderboard from DB
// ──────────────────────────────────────────────

router.get('/leaderboard', async (req, res, next) => {
    try {
        const leaderboard = await contestService.getLeaderboard(null);
        res.json(leaderboard);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// POST /api/judge/log-violation — anti-cheat violation event
// ──────────────────────────────────────────────

router.post('/log-violation', async (req, res, next) => {
    try {
        const { violationType, contestId, metadata } = req.body;

        if (!violationType || typeof violationType !== 'string') {
            return res.status(400).json({ error: 'violationType is required.' });
        }

        // Validate violation type
        const allowedTypes = ['tab_switch','visibility_change','copy','paste','right_click','devtools','fullscreen_exit','blur'];
        if (!allowedTypes.includes(violationType)) {
            return res.status(400).json({ error: 'Invalid violation type.' });
        }

        await db.query(
            `INSERT INTO violations (user_id, contest_id, type, metadata)
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, contestId || null, violationType, metadata ? JSON.stringify(metadata) : null]
        );

        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
