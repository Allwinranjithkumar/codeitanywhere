/**
 * contestService.js — Contest state management via PostgreSQL.
 *
 * Contest timing is SERVER-AUTHORITATIVE.
 * The server always determines whether a contest is active
 * based on DB start_time/end_time — never from in-memory state
 * or client-supplied values.
 */

const db = require('../db');

/**
 * Get a contest by ID.
 */
async function getContestById(contestId) {
    const result = await db.query(
        'SELECT * FROM contests WHERE id = $1',
        [contestId]
    );
    return result.rows[0] || null;
}

/**
 * Get all contests (with status computed from current time).
 */
async function getAllContests() {
    const result = await db.query(
        `SELECT id, name, description, start_time, end_time, duration_minutes, status, anti_cheat, created_at
         FROM contests ORDER BY created_at DESC`
    );
    return result.rows;
}

/**
 * Determine if a contest is currently active (server-side check using DB times).
 * Returns: { active, ended, upcoming, contest }
 */
async function getContestStatus(contestId) {
    const contest = await getContestById(contestId);
    if (!contest) return { active: false, ended: false, upcoming: false, contest: null };

    const now = new Date();
    const start = new Date(contest.start_time);
    const end   = new Date(contest.end_time);

    const active   = contest.status === 'ACTIVE' && now >= start && now <= end;
    const ended    = contest.status === 'ENDED'  || now > end;
    const upcoming = contest.status === 'UPCOMING' || (contest.status === 'DRAFT' && now < start);

    return { active, ended, upcoming, contest };
}

/**
 * Get the currently active contest (if any).
 */
async function getActiveContest() {
    const now = new Date();
    const result = await db.query(
        `SELECT * FROM contests
         WHERE status = 'ACTIVE' AND start_time <= $1 AND end_time >= $1
         ORDER BY start_time DESC LIMIT 1`,
        [now]
    );
    return result.rows[0] || null;
}

/**
 * Create a new contest.
 */
async function createContest({ name, description, startTime, endTime, durationMinutes, antiCheat, createdBy }) {
    const result = await db.query(
        `INSERT INTO contests (name, description, start_time, end_time, duration_minutes, anti_cheat, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'UPCOMING')
         RETURNING *`,
        [name, description || null, startTime, endTime, durationMinutes || 60, antiCheat === true, createdBy]
    );
    return result.rows[0];
}

/**
 * Update contest fields dynamically.
 */
async function updateContest(id, fields = {}) {
    const updates = [];
    const values = [];
    let idx = 1;

    if (fields.name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(fields.name);
    }
    if (fields.description !== undefined) {
        updates.push(`description = $${idx++}`);
        values.push(fields.description);
    }
    if (fields.startTime !== undefined) {
        updates.push(`start_time = $${idx++}`);
        values.push(fields.startTime);
    }
    if (fields.endTime !== undefined) {
        updates.push(`end_time = $${idx++}`);
        values.push(fields.endTime);
    } else if (fields.status === 'ENDED') {
        updates.push(`end_time = NOW()`);
    }
    if (fields.durationMinutes !== undefined) {
        updates.push(`duration_minutes = $${idx++}`);
        values.push(fields.durationMinutes);
    }
    if (fields.status !== undefined) {
        updates.push(`status = $${idx++}`);
        values.push(fields.status);
    }
    if (fields.antiCheat !== undefined) {
        updates.push(`anti_cheat = $${idx++}`);
        values.push(fields.antiCheat);
    }

    if (updates.length === 0) {
        const res = await db.query('SELECT * FROM contests WHERE id = $1', [id]);
        return res.rows[0] || null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
        `UPDATE contests SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
    );
    return result.rows[0] || null;
}

/**
 * Assign a problem to a contest.
 */
async function assignProblemToContest(contestId, problemId, orderIndex = 0) {
    await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, order_index)
         VALUES ($1, $2, $3)
         ON CONFLICT (contest_id, problem_id) DO UPDATE SET order_index = EXCLUDED.order_index`,
        [contestId, problemId, orderIndex]
    );
}

/**
 * Register a participant for a contest.
 */
async function joinContest(contestId, userId) {
    const { active } = await getContestStatus(contestId);
    if (!active) {
        throw new Error('Contest is not currently active.');
    }
    await db.query(
        `INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [contestId, userId]
    );
}

/**
 * Get leaderboard for a specific contest from PostgreSQL.
 */
async function getLeaderboard(contestId) {
    let queryText;
    let params;

    if (contestId) {
        queryText = `
            SELECT
                u.id,
                u.name,
                u.reg_no,
                u.department,
                u.class_name,
                COALESCE(SUM(best_sub.score), 0) AS total_score,
                COUNT(DISTINCT best_sub.problem_id) FILTER (WHERE best_sub.status = 'Accepted') AS problems_solved,
                MIN(best_sub.submitted_at) AS first_submission
            FROM contest_participants cp
            JOIN users u ON u.id = cp.user_id
            LEFT JOIN LATERAL (
                SELECT problem_id, MAX(score) AS score, MIN(status) AS status, MIN(submitted_at) AS submitted_at
                FROM submissions s
                WHERE s.user_id = cp.user_id AND s.contest_id = cp.contest_id
                GROUP BY problem_id
            ) best_sub ON TRUE
            WHERE cp.contest_id = $1
            GROUP BY u.id, u.name, u.reg_no, u.department, u.class_name
            ORDER BY total_score DESC, problems_solved DESC, first_submission ASC NULLS LAST
        `;
        params = [contestId];
    } else {
        queryText = `
            SELECT
                u.id,
                u.name,
                u.reg_no,
                u.department,
                u.class_name,
                COALESCE(SUM(s.score), 0) AS total_score,
                COUNT(DISTINCT s.problem_id) FILTER (WHERE s.status = 'Accepted') AS problems_solved
            FROM submissions s
            JOIN users u ON u.id = s.user_id
            GROUP BY u.id, u.name, u.reg_no, u.department, u.class_name
            ORDER BY total_score DESC, problems_solved DESC
        `;
        params = [];
    }

    const result = await db.query(queryText, params);
    return result.rows;
}

module.exports = {
    getContestById,
    getAllContests,
    getContestStatus,
    getActiveContest,
    createContest,
    updateContest,
    assignProblemToContest,
    joinContest,
    getLeaderboard
};
