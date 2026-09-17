/**
 * admin.routes.js — Admin-only management endpoints
 *
 * All routes require: valid JWT + role = 'admin'
 * PostgreSQL is the only data source — no in-memory fallback.
 *
 * Routes:
 *   GET    /api/admin/stats                      — dashboard summary
 *   GET    /api/admin/users                      — list all students
 *   GET    /api/admin/submissions                — all submissions with filters
 *   GET    /api/admin/violations                 — all violations
 *   GET    /api/admin/classes                    — distinct class list
 *   GET    /api/admin/export                     — Excel export (students + scores)
 *   POST   /api/admin/sync-excel                 — import students from Excel file
 *
 *   GET    /api/admin/problems                   — all problems (admin view, full test cases)
 *   POST   /api/admin/problems                   — create problem
 *   PUT    /api/admin/problems/:id               — update problem
 *   DELETE /api/admin/problems/:id               — deactivate problem
 *   POST   /api/admin/problems/:id/testcases     — add test case
 *   DELETE /api/admin/problems/:id/testcases/:tcId — remove test case
 *   POST   /api/admin/problems/import-json       — import from problems.json format
 *
 *   DELETE /api/admin/reset                      — wipe submissions + violations
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcrypt');
const path    = require('path');
const fs      = require('fs').promises;
const { authenticateToken, verifyAdmin } = require('../middleware/auth.middleware');
const problemService = require('../services/problemService');
const bedrockService = require('../services/bedrockService');

router.use(authenticateToken);
router.use(verifyAdmin);

// ──────────────────────────────────────────────
// GET /api/admin/stats — dashboard summary
// ──────────────────────────────────────────────

router.get('/stats', async (req, res, next) => {
    try {
        const [students, contests, submissions, violations, problems, accepted] = await Promise.all([
            db.query(`SELECT COUNT(*) FROM users WHERE role='student' AND is_active=TRUE`),
            db.query(`SELECT COUNT(*) FROM contests`),
            db.query(`SELECT COUNT(*) FROM submissions`),
            db.query(`SELECT COUNT(*) FROM violations`),
            db.query(`SELECT COUNT(*) FROM problems WHERE is_active=TRUE`),
            db.query(`SELECT COUNT(*) FROM submissions WHERE status='Accepted'`)
        ]);

        const activeContest = await db.query(
            `SELECT id, name, end_time FROM contests WHERE status='ACTIVE' AND start_time<=NOW() AND end_time>=NOW() LIMIT 1`
        );

        res.json({
            totalStudents:       parseInt(students.rows[0].count),
            totalContests:       parseInt(contests.rows[0].count),
            totalSubmissions:    parseInt(submissions.rows[0].count),
            acceptedSubmissions: parseInt(accepted.rows[0].count),
            totalViolations:     parseInt(violations.rows[0].count),
            totalProblems:       parseInt(problems.rows[0].count),
            activeContest:       activeContest.rows[0] || null
        });
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/admin/users — list all students
// ──────────────────────────────────────────────

router.get('/users', async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT id, name, email, reg_no, batch_year, department, class_name, is_active, created_at
             FROM users WHERE role='student' ORDER BY reg_no`
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/admin/classes — distinct class names
// ──────────────────────────────────────────────

router.get('/classes', async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT DISTINCT class_name, department, batch_year, COUNT(*) as student_count
             FROM users WHERE role='student' AND is_active=TRUE
             GROUP BY class_name, department, batch_year
             ORDER BY batch_year DESC, department`
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/admin/submissions — all submissions with filters
// ──────────────────────────────────────────────

router.get('/submissions', async (req, res, next) => {
    try {
        const { batch, department, class: className, contest_id } = req.query;
        const params = [];
        let idx = 1;

        let sql = `
            SELECT s.id, s.language, s.status, s.score, s.passed_tests, s.total_tests,
                   s.execution_time_ms, s.error_message, s.submitted_at,
                   u.name, u.reg_no, u.email, u.batch_year, u.department, u.class_name,
                   p.title AS problem_title, p.id AS problem_id,
                   c.name AS contest_name
            FROM submissions s
            JOIN users u    ON u.id = s.user_id
            JOIN problems p ON p.id = s.problem_id
            LEFT JOIN contests c ON c.id = s.contest_id
            WHERE 1=1
        `;

        if (batch)      { sql += ` AND u.batch_year = $${idx++}`;  params.push(batch); }
        if (department) { sql += ` AND u.department = $${idx++}`;  params.push(department); }
        if (className)  { sql += ` AND u.class_name = $${idx++}`;  params.push(className); }
        if (contest_id) { sql += ` AND s.contest_id = $${idx++}`;  params.push(contest_id); }

        sql += ` ORDER BY s.submitted_at DESC LIMIT 500`;

        const result = await db.query(sql, params);
        // source_code is intentionally omitted — admin can view via individual submission endpoint
        res.json(result.rows);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/admin/violations — all violations
// ──────────────────────────────────────────────

router.get('/violations', async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT v.id, v.type, v.metadata, v.occurred_at,
                    u.name, u.reg_no,
                    c.name AS contest_name
             FROM violations v
             JOIN users u ON u.id = v.user_id
             LEFT JOIN contests c ON c.id = v.contest_id
             ORDER BY v.occurred_at DESC
             LIMIT 1000`
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// GET /api/admin/export — Excel download with filters
// ──────────────────────────────────────────────

router.get('/export', async (req, res, next) => {
    try {
        const xlsx = require('xlsx');
        const { batch, department, class: className, contest_id } = req.query;

        // Build user query
        const userParams = [];
        let userIdx = 1;
        let userSql = `SELECT * FROM users WHERE role='student' AND is_active=TRUE`;
        if (batch)      { userSql += ` AND batch_year=$${userIdx++}`;  userParams.push(batch); }
        if (department) { userSql += ` AND department=$${userIdx++}`;  userParams.push(department); }
        if (className)  { userSql += ` AND class_name=$${userIdx++}`;  userParams.push(className); }
        userSql += ` ORDER BY reg_no`;

        const usersResult = await db.query(userSql, userParams);
        const users = usersResult.rows;

        if (users.length === 0) {
            return res.status(404).json({ error: 'No students found for the selected filters.' });
        }

        const userIds = users.map(u => u.id);

        // Get unique problem titles
        let problemSql = `SELECT DISTINCT p.id, p.title FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE s.user_id=ANY($1)`;
        const problemParams = [userIds];
        if (contest_id) { problemSql += ` AND s.contest_id=$2`; problemParams.push(contest_id); }
        problemSql += ` ORDER BY p.id`;
        const problemsResult = await db.query(problemSql, problemParams);

        // Get best submission per student per problem
        let subSql = `
            SELECT s.user_id, s.problem_id, MAX(s.score) as best_score, COUNT(*) as attempts
            FROM submissions s
            WHERE s.user_id=ANY($1)`;
        const subParams = [userIds];
        if (contest_id) { subSql += ` AND s.contest_id=$2`; subParams.push(contest_id); }
        subSql += ` GROUP BY s.user_id, s.problem_id`;
        const subsResult = await db.query(subSql, subParams);

        // Get violation counts
        const violResult = await db.query(
            `SELECT user_id, type, COUNT(*) as count FROM violations WHERE user_id=ANY($1) GROUP BY user_id, type`,
            [userIds]
        );

        // Build Excel rows
        const excelData = users.map((student, i) => {
            const studentSubs  = subsResult.rows.filter(s => s.user_id === student.id);
            const studentViols = violResult.rows.filter(v => v.user_id === student.id);

            let tabSwitches = 0, copyPastes = 0, otherViols = 0;
            studentViols.forEach(v => {
                const n = parseInt(v.count);
                if (['tab_switch','visibility_change','blur'].includes(v.type))    tabSwitches += n;
                else if (['copy','paste'].includes(v.type))                        copyPastes  += n;
                else                                                               otherViols  += n;
            });

            const row = {
                'S.No':                i + 1,
                'Name':                student.name,
                'Email':               student.email,
                'Registration Number': student.reg_no,
                'Batch':               student.batch_year,
                'Department':          student.department,
                'Class':               student.class_name
            };

            let totalScore = 0;
            problemsResult.rows.forEach(p => {
                const sub   = studentSubs.find(s => s.problem_id === p.id);
                const score = sub ? parseInt(sub.best_score) : 0;
                row[`P: ${p.title}`] = score;
                totalScore += score;
            });

            row['Total Score']    = totalScore;
            row['Attempts']       = studentSubs.reduce((a, s) => a + parseInt(s.attempts), 0);
            row['Tab Switches']   = tabSwitches;
            row['Copy/Pastes']    = copyPastes;
            row['Other Violations'] = otherViols;
            row['Total Violations'] = tabSwitches + copyPastes + otherViols;
            row['Status']         = studentSubs.length > 0 ? 'Submitted' : 'Not Submitted';

            return row;
        });

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(excelData);
        ws['!cols'] = Object.keys(excelData[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }));
        xlsx.utils.book_append_sheet(wb, ws, 'Students');

        // Summary sheet
        const filterInfo = [];
        if (batch)      filterInfo.push(`Batch: ${batch}`);
        if (department) filterInfo.push(`Dept: ${department}`);
        if (className)  filterInfo.push(`Class: ${className}`);
        if (contest_id) filterInfo.push(`Contest ID: ${contest_id}`);
        const summarySheet = xlsx.utils.json_to_sheet([
            { Metric: 'Filters',            Value: filterInfo.join(', ') || 'None' },
            { Metric: 'Total Students',     Value: users.length },
            { Metric: 'Submitted',          Value: new Set(subsResult.rows.map(s => s.user_id)).size },
            { Metric: 'Not Submitted',      Value: users.length - new Set(subsResult.rows.map(s => s.user_id)).size },
            { Metric: 'Total Problems',     Value: problemsResult.rows.length },
            { Metric: 'Generated On',       Value: new Date().toLocaleString() }
        ]);
        xlsx.utils.book_append_sheet(wb, summarySheet, 'Summary');

        const buffer   = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = className ? `${className.replace(/ /g,'_')}_report.xlsx` : `report_${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// POST /api/admin/sync-excel — import students from uploaded Excel data
// ──────────────────────────────────────────────

router.post('/sync-excel', async (req, res, next) => {
    try {
        const xlsx = require('xlsx');
        const excelPath = path.join(__dirname, '..', '..', 'data', 'allowed_users.xlsx');

        let data;
        try {
            const wb = xlsx.readFile(excelPath);
            const ws = wb.Sheets[wb.SheetNames[0]];
            data = xlsx.utils.sheet_to_json(ws);
        } catch (e) {
            return res.status(400).json({ error: `Failed to read Excel file: ${e.message}` });
        }

        const defaultHash = await bcrypt.hash('student123', 12);
        let added = 0, skipped = 0, failed = 0;

        for (const row of data) {
            const email  = row['Official Email']?.toString().trim().toLowerCase();
            const regNo  = row['Roll_No']?.toString().trim();
            const first  = row['First_Name']?.toString().trim() || '';
            const last   = row['Last_Name']?.toString().trim()  || '';
            const name   = `${first} ${last}`.trim();

            if (!email || !regNo || !name) { skipped++; continue; }

            // Parse department/batch from reg number
            let batchYear = null, department = null, className = null;
            if (regNo.startsWith('7155') && regNo.length >= 10) {
                const yr   = regNo.substring(4, 6);
                const dept = { '1050':'EEE','1053':'EEE','1120':'ICE' }[regNo.substring(6,10)] || 'Unknown';
                batchYear  = `20${yr}`;
                department = dept;
                className  = `${yr} ${dept}`;
            }

            try {
                const existing = await db.query('SELECT id FROM users WHERE email=$1 OR reg_no=$2', [email, regNo]);
                if (existing.rowCount > 0) { skipped++; continue; }

                await db.query(
                    `INSERT INTO users (name, email, reg_no, password_hash, role, batch_year, department, class_name)
                     VALUES ($1,$2,$3,$4,'student',$5,$6,$7)`,
                    [name, email, regNo, defaultHash, batchYear, department, className]
                );
                added++;
            } catch (e) { failed++; }
        }

        res.json({
            message: `Excel sync complete: ${added} added, ${skipped} skipped/duplicates, ${failed} errors.`,
            added, skipped, failed
        });
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Problems Management (DB-backed CRUD)
// ──────────────────────────────────────────────

// GET /api/admin/problems — all problems (admin view)
router.get('/problems', async (req, res, next) => {
    try {
        const problems = await problemService.getProblemsForAdmin();
        res.json(problems);
    } catch (err) { next(err); }
});

// POST /api/admin/problems — create new problem
router.post('/problems', async (req, res, next) => {
    try {
        const { title, description, difficulty, points, functionName, constraints, testCases, starterCode } = req.body;
        if (!title || !description) {
            return res.status(400).json({ error: 'title and description are required.' });
        }
        const id = await problemService.createProblem({
            title, description, difficulty, points, functionName, constraints,
            testCases:   testCases   || [],
            starterCode: starterCode || {},
            createdBy:   req.user.id
        });
        res.status(201).json({ message: 'Problem created.', id });
    } catch (err) { next(err); }
});

// POST /api/admin/problems/generate-ai — Generate problem via Bedrock AI
router.post('/problems/generate-ai', async (req, res, next) => {
    try {
        const { prompt, difficulty, topic } = req.body;
        if (!prompt && !topic) {
            return res.status(400).json({ error: 'Prompt or topic is required for AI generation.' });
        }
        const problem = await bedrockService.generateProblem({ prompt, difficulty, topic });
        res.json({
            success: true,
            problem
        });
    } catch (err) {
        console.error('[Bedrock API Error]', err);
        res.status(500).json({ error: 'AI Generation failed: ' + err.message });
    }
});

// POST /api/admin/problems/chat — Interactive AI Problem Architect Chatbot
router.post('/problems/chat', async (req, res, next) => {
    try {
        const { messages, currentProblem, customConfig } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Messages array is required.' });
        }
        const result = await bedrockService.chatProblemGenerator({ messages, currentProblem, customConfig });
        res.json({
            success: true,
            message: result.message,
            problem: result.problem,
            engine: result.engine
        });
    } catch (err) {
        console.error('[Problem Architect Chat Error]', err);
        res.status(500).json({ error: 'Problem Architect failed: ' + err.message });
    }
});

// PUT /api/admin/problems/:id — update problem fields
router.put('/problems/:id', async (req, res, next) => {
    try {
        const { title, description, difficulty, points, functionName, constraints } = req.body;
        await problemService.updateProblem(req.params.id, {
            title, description, difficulty, points, functionName, constraints
        });
        res.json({ message: 'Problem updated.' });
    } catch (err) { next(err); }
});

// PATCH /api/admin/problems/:id/toggle — toggle active / hidden status
router.patch('/problems/:id/toggle', async (req, res, next) => {
    try {
        const { is_active } = req.body || {};
        const problem = await problemService.toggleProblemActive(req.params.id, is_active !== undefined ? is_active : null);
        res.json({
            message: `Problem "${problem.title}" is now ${problem.is_active ? 'Active' : 'Hidden'}.`,
            problem
        });
    } catch (err) { next(err); }
});

// DELETE /api/admin/problems/:id — soft-delete / hide
router.delete('/problems/:id', async (req, res, next) => {
    try {
        const problem = await problemService.toggleProblemActive(req.params.id, false);
        res.json({ message: `Problem "${problem ? problem.title : req.params.id}" deactivated.` });
    } catch (err) { next(err); }
});

// GET /api/admin/export-contest-post-mortem/:contestId — Test-wise Excel export
router.get('/export-contest-post-mortem/:contestId', async (req, res, next) => {
    try {
        const contestId = parseInt(req.params.contestId, 10);
        if (isNaN(contestId)) {
            return res.status(400).json({ error: 'Invalid contest ID.' });
        }
        const { exportContestPostMortemExcel } = require('../services/reportService');
        const { buffer, filename } = await exportContestPostMortemExcel(contestId);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (err) {
        console.error('Export contest report error:', err);
        next(err);
    }
});

// POST /api/admin/problems/:id/testcases — add test case
router.post('/problems/:id/testcases', async (req, res, next) => {
    try {
        const { input, output, isSample } = req.body;
        if (input === undefined || output === undefined) {
            return res.status(400).json({ error: 'input and output are required.' });
        }
        await db.query(
            `INSERT INTO test_cases (problem_id, input_data, output_data, is_sample)
             VALUES ($1,$2,$3,$4)`,
            [req.params.id, JSON.stringify(input), JSON.stringify(output), isSample || false]
        );
        res.status(201).json({ message: 'Test case added.' });
    } catch (err) { next(err); }
});

// DELETE /api/admin/problems/:id/testcases/:tcId — remove test case
router.delete('/problems/:id/testcases/:tcId', async (req, res, next) => {
    try {
        await db.query(
            'DELETE FROM test_cases WHERE id=$1 AND problem_id=$2',
            [req.params.tcId, req.params.id]
        );
        res.json({ message: 'Test case removed.' });
    } catch (err) { next(err); }
});

// POST /api/admin/problems/import-json — bulk import or update from JSON
router.post('/problems/import-json', async (req, res, next) => {
    try {
        let problems = req.body;
        if (!Array.isArray(problems)) {
            if (problems && typeof problems === 'object' && problems.title) {
                problems = [problems];
            } else {
                return res.status(400).json({ error: 'Expected a problem object or array of problem objects.' });
            }
        }
        const result = await problemService.upsertFromJson(problems, true);
        res.json({
            message: `Successfully processed ${result.total} problems (${result.created} created, ${result.updated} updated).`,
            ...result
        });
    } catch (err) { next(err); }
});

// GET /api/admin/problems/export-json — export all active problems in problems.json format
router.get('/problems/export-json', async (req, res, next) => {
    try {
        const json = await problemService.exportProblemsJson();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="problems.json"');
        res.send(JSON.stringify(json, null, 2));
    } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// DELETE /api/admin/reset — wipe contest data
// ──────────────────────────────────────────────

router.delete('/reset', async (req, res, next) => {
    try {
        await db.query('BEGIN');
        await db.query('DELETE FROM submissions');
        await db.query('DELETE FROM violations');
        await db.query('DELETE FROM contest_participants');
        await db.query('COMMIT');
        res.json({ message: 'All submissions, violations, and contest participation records cleared.' });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        next(err);
    }
});

module.exports = router;
