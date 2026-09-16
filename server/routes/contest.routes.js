/**
 * contest.routes.js — Contest management & participation endpoints
 *
 * Student routes:
 *   GET  /api/contests                  — list all contests
 *   GET  /api/contests/active           — get currently active contest
 *   GET  /api/contests/:id              — get contest details + server time for client timer
 *   GET  /api/contests/:id/status       — server-authoritative active/ended/upcoming
 *   GET  /api/contests/:id/problems     — problems for this contest (sample cases only)
 *   POST /api/contests/:id/join         — register as participant
 *   GET  /api/contests/:id/leaderboard  — contest leaderboard
 *
 * Admin routes:
 *   POST /api/contests                  — create contest
 *   PUT  /api/contests/:id              — update contest
 *   POST /api/contests/:id/problems     — assign problem to contest
 */

const express  = require('express');
const router   = express.Router();
const { authenticateToken, verifyAdmin } = require('../middleware/auth.middleware');
const contestService = require('../services/contestService');
const problemService = require('../services/problemService');

// ──────────────────────────────────────────────
// Student Routes (authenticated)
// ──────────────────────────────────────────────

// GET /api/contests — list all contests
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const contests = await contestService.getAllContests();
        res.json(contests);
    } catch (err) { next(err); }
});

// GET /api/contests/active — currently active contest
router.get('/active', authenticateToken, async (req, res, next) => {
    try {
        const contest = await contestService.getActiveContest();
        if (!contest) return res.json({ active: false, contest: null });
        res.json({ active: true, contest });
    } catch (err) { next(err); }
});

// GET /api/contests/:id — contest details with server timestamp for client timer
router.get('/:id', authenticateToken, async (req, res, next) => {
    try {
        const contest = await contestService.getContestById(req.params.id);
        if (!contest) return res.status(404).json({ error: 'Contest not found.' });

        // Return server time alongside contest so client can compute accurate remaining time
        res.json({
            ...contest,
            serverTime: new Date().toISOString()
        });
    } catch (err) { next(err); }
});

// GET /api/contests/:id/status — server-authoritative contest status
router.get('/:id/status', authenticateToken, async (req, res, next) => {
    try {
        const status = await contestService.getContestStatus(req.params.id);
        res.json({
            ...status,
            serverTime: new Date().toISOString()
        });
    } catch (err) { next(err); }
});

// GET /api/contests/:id/problems — contest problems (NO hidden test cases)
router.get('/:id/problems', authenticateToken, async (req, res, next) => {
    try {
        const { active } = await contestService.getContestStatus(req.params.id);
        if (!active) {
            return res.status(403).json({ error: 'Contest is not currently active.' });
        }
        const problems = await problemService.getProblemsForStudent(req.params.id);
        res.json(problems);
    } catch (err) { next(err); }
});

// POST /api/contests/:id/join — student joins a contest
router.post('/:id/join', authenticateToken, async (req, res, next) => {
    try {
        await contestService.joinContest(req.params.id, req.user.id);
        res.json({ message: 'Successfully joined the contest.' });
    } catch (err) {
        if (err.message === 'Contest is not currently active.') {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});

// GET /api/contests/:id/leaderboard — contest leaderboard from DB
router.get('/:id/leaderboard', authenticateToken, async (req, res, next) => {
    try {
        const leaderboard = await contestService.getLeaderboard(req.params.id);
        res.json(leaderboard);
    } catch (err) { next(err); }
});

// GET /api/leaderboard — global leaderboard (all submissions, no contest filter)
router.get('/global/leaderboard', authenticateToken, async (req, res, next) => {
    try {
        const leaderboard = await contestService.getLeaderboard(null);
        res.json(leaderboard);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Admin Routes
// ──────────────────────────────────────────────

// POST /api/contests — create a new contest
router.post('/', authenticateToken, verifyAdmin, async (req, res, next) => {
    try {
        const { name, description, startTime, endTime, durationMinutes, antiCheat } = req.body;
        if (!name || !startTime || !endTime) {
            return res.status(400).json({ error: 'name, startTime, and endTime are required.' });
        }
        const contest = await contestService.createContest({
            name, description, startTime, endTime,
            durationMinutes: durationMinutes || 60,
            antiCheat:       antiCheat !== false,
            createdBy:       req.user.id
        });
        res.status(201).json({ message: 'Contest created.', contest });
    } catch (err) { next(err); }
});

// PUT /api/contests/:id — update contest
router.put('/:id', authenticateToken, verifyAdmin, async (req, res, next) => {
    try {
        const { name, description, startTime, endTime, durationMinutes, status, antiCheat } = req.body;
        const valid = ['DRAFT','UPCOMING','ACTIVE','ENDED'];
        if (status && !valid.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
        }
        const updated = await contestService.updateContest(req.params.id, {
            name, description, startTime, endTime, durationMinutes, status, antiCheat
        });
        if (!updated) return res.status(404).json({ error: 'Contest not found.' });
        res.json({ message: 'Contest updated.', contest: updated });
    } catch (err) { next(err); }
});

// POST /api/contests/:id/problems — assign problem to contest
router.post('/:id/problems', authenticateToken, verifyAdmin, async (req, res, next) => {
    try {
        const { problemId, orderIndex } = req.body;
        if (!problemId) return res.status(400).json({ error: 'problemId is required.' });
        await contestService.assignProblemToContest(req.params.id, problemId, orderIndex || 0);
        res.json({ message: 'Problem assigned to contest.' });
    } catch (err) { next(err); }
});

module.exports = router;
