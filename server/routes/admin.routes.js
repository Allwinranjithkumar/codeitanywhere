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

// Export data (Excel with filters)
router.get('/export', async (req, res) => {
    try {
        const { batch, department, class: className } = req.query;
        const xlsx = require('xlsx');

        console.log('📥 Export request with filters:', { batch, department, className });

        // Build Users Query with Filters
        let userQuery = `SELECT * FROM users WHERE role = 'student'`;
        const params = [];
        let paramIndex = 1;

        if (batch) {
            // Clean batch: remove non-digits, handle 2 vs 4 digits
            // "23 Batch" -> "23" -> "2023"
            // "2024" -> "2024"
            let cleanBatch = batch.replace(/\D/g, '');
            if (cleanBatch.length === 2) cleanBatch = `20${cleanBatch}`;

            userQuery += ` AND batch_year = $${paramIndex++}`;
            params.push(cleanBatch);
            console.log(`  Batch filter: '${batch}' -> '${cleanBatch}'`);
        }
        if (department) {
            userQuery += ` AND department = $${paramIndex++}`;
            params.push(department.trim());
            console.log(`  Department filter: '${department}'`);
        }
        if (className) {
            // Clean class: replace hyphens with spaces
            // "23-EEE" -> "23 EEE"
            const cleanClass = className.replace(/-/g, ' ').trim();
            userQuery += ` AND class_name = $${paramIndex++}`;
            params.push(cleanClass);
            console.log(`  Class filter: '${className}' -> '${cleanClass}'`);
        }

        userQuery += ` ORDER BY reg_no`;

        console.log('  Query:', userQuery);
        console.log('  Params:', params);

        // Get filtered users
        const usersResult = await db.query(userQuery, params);
        const users = usersResult.rows;

        console.log(`✅ Found ${users.length} students`);

        // Get all unique problems (even if no students found)
        const problemsResult = await db.query(`
            SELECT DISTINCT problem_id FROM submissions ORDER BY problem_id
        `);
        const problemIds = problemsResult.rows.map(p => p.problem_id);

        // Get submissions and violations for filtered users
        const userIds = users.map(u => u.id);
        let submissionsResult, violationsResult;

        if (userIds.length > 0) {
            // Get Submissions
            submissionsResult = await db.query(`
                SELECT s.user_id, s.problem_id, MAX(s.score) as best_score,
                       COUNT(*) as attempts,
                       MAX(s.created_at) as last_submission
                FROM submissions s
                WHERE s.user_id = ANY($1)
                GROUP BY s.user_id, s.problem_id
            `, [userIds]);

            // Get Violations
            violationsResult = await db.query(`
                SELECT user_id, type, COUNT(*) as count
                FROM violations
                WHERE user_id = ANY($1)
                GROUP BY user_id, type
            `, [userIds]);
        } else {
            submissionsResult = { rows: [] };
            violationsResult = { rows: [] };
        }

        // Build Excel data
        const excelData = users.map((student, index) => {
            const studentSubmissions = submissionsResult.rows.filter(s => s.user_id === student.id);
            const studentViolations = violationsResult.rows.filter(v => v.user_id === student.id);

            // Calculate violation counts
            let tabSwitches = 0;
            let copyPastes = 0;
            let otherViolations = 0;

            studentViolations.forEach(v => {
                const count = parseInt(v.count);
                if (v.type === 'tab_switch' || v.type === 'visibility_change' || v.type === 'blur') {
                    tabSwitches += count;
                } else if (v.type === 'copy_paste' || v.type === 'paste') {
                    copyPastes += count;
                } else {
                    otherViolations += count;
                }
            });

            const totalViolations = tabSwitches + copyPastes + otherViolations;

            const row = {
                'S.No': index + 1,
                'Name': student.name,
                'Email': student.email,
                'Registration Number': student.reg_no,
                'Batch': student.batch_year,
                'Department': student.department,
                'Class': student.class_name
            };

            // Add problem scores (0 by default, updated if submitted)
            let totalScore = 0;
            problemIds.forEach(problemId => {
                const submission = studentSubmissions.find(s => s.problem_id === problemId);
                const score = submission ? parseInt(submission.best_score) : 0;
                row[`Problem ${problemId}`] = score;
                totalScore += score;
            });

            row['Total Score'] = totalScore;
            row['Attempts'] = studentSubmissions.reduce((sum, s) => sum + parseInt(s.attempts || 0), 0);
            row['Tab Switches'] = tabSwitches;
            row['Copy Pastes'] = copyPastes;
            row['Total Violations'] = totalViolations;
            row['Status'] = studentSubmissions.length > 0 ? 'Submitted' : 'Not Submitted';

            return row;
        });

        // Build filter info for summary (used in both normal and empty cases)
        const filterInfo = [];
        if (batch) filterInfo.push(`Batch: ${batch}`);
        if (department) filterInfo.push(`Department: ${department}`);
        if (className) filterInfo.push(`Class: ${className}`);

        // Create workbook
        const wb = xlsx.utils.book_new();

        // If no students found, create a message sheet
        if (users.length === 0) {
            const messageData = [{
                'Message': 'No students found for the selected filters',
                'Filters': filterInfo.length > 0 ? filterInfo.join(', ') : 'None selected',
                'Suggestion': 'Try selecting different filter combinations'
            }];
            const messageSheet = xlsx.utils.json_to_sheet(messageData);
            xlsx.utils.book_append_sheet(wb, messageSheet, 'No Data');
        } else {
            // Normal case: create students sheet
            const ws = xlsx.utils.json_to_sheet(excelData);

            // Auto-size columns
            const colWidths = Object.keys(excelData[0] || {}).map(key => ({
                wch: Math.max(key.length, 15)
            }));
            ws['!cols'] = colWidths;

            xlsx.utils.book_append_sheet(wb, ws, 'Students');
        }

        // Add summary sheet

        const summary = [
            { 'Metric': 'Filters Applied', 'Value': filterInfo.join(', ') || 'None' },
            { 'Metric': 'Total Students', 'Value': users.length },
            { 'Metric': 'Students Submitted', 'Value': new Set(submissionsResult.rows.map(s => s.user_id)).size },
            { 'Metric': 'Students Not Submitted', 'Value': users.length - new Set(submissionsResult.rows.map(s => s.user_id)).size },
            { 'Metric': 'Total Problems', 'Value': problemIds.length },
            { 'Metric': 'Generated On', 'Value': new Date().toLocaleString() }
        ];
        const summarySheet = xlsx.utils.json_to_sheet(summary);
        xlsx.utils.book_append_sheet(wb, summarySheet, 'Summary');

        // Generate Excel file
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = className
            ? `${className.replace(/ /g, '_')}_students.xlsx`
            : `filtered_students_${Date.now()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all classes (unique class names)
router.get('/classes', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT class_name, department, batch_year, COUNT(*) as student_count
            FROM users
            WHERE role = 'student'
            GROUP BY class_name, department, batch_year
            ORDER BY batch_year DESC, department
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get marksheet for a specific class
router.get('/marksheet/:className', async (req, res) => {
    try {
        const { className } = req.params;

        // Get all students in the class
        const studentsResult = await db.query(`
            SELECT id, name, email, reg_no, batch_year, department, class_name
            FROM users
            WHERE class_name = $1 AND role = 'student'
            ORDER BY reg_no
        `, [className]);

        // Get all problems
        const problemsResult = await db.query(`
            SELECT DISTINCT problem_id FROM submissions
        `);
        const problemIds = problemsResult.rows.map(p => p.problem_id);

        // Get submissions for all students in this class
        const submissionsResult = await db.query(`
            SELECT s.user_id, s.problem_id, MAX(s.score) as best_score
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            WHERE u.class_name = $1
            GROUP BY s.user_id, s.problem_id
        `, [className]);

        // Build marksheet data
        const marksheet = studentsResult.rows.map(student => {
            const studentSubmissions = submissionsResult.rows.filter(s => s.user_id === student.id);

            // Calculate scores per problem
            const problemScores = {};
            let totalScore = 0;

            problemIds.forEach(problemId => {
                const submission = studentSubmissions.find(s => s.problem_id === problemId);
                const score = submission ? parseInt(submission.best_score) : 0;
                problemScores[problemId] = score;
                totalScore += score;
            });

            return {
                ...student,
                problemScores,
                totalScore,
                hasLoggedIn: studentSubmissions.length > 0
            };
        });

        res.json({
            className,
            students: marksheet,
            problemIds
        });
    } catch (error) {
        console.error('Get marksheet error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export class marksheet as Excel
router.get('/export/marksheet/:className', async (req, res) => {
    try {
        const { className } = req.params;
        const xlsx = require('xlsx');

        // Get all students in the class
        const studentsResult = await db.query(`
            SELECT id, name, email, reg_no, batch_year, department, class_name
            FROM users
            WHERE class_name = $1 AND role = 'student'
            ORDER BY reg_no
        `, [className]);

        // Get all unique problems from submissions
        const problemsResult = await db.query(`
            SELECT DISTINCT problem_id FROM submissions ORDER BY problem_id
        `);
        const problemIds = problemsResult.rows.map(p => p.problem_id);

        // Get submissions for all students in this class
        const submissionsResult = await db.query(`
            SELECT s.user_id, s.problem_id, MAX(s.score) as best_score, 
                   COUNT(*) as attempts,
                   MAX(s.created_at) as last_submission
            FROM submissions s
            JOIN users u ON s.user_id = u.id
            WHERE u.class_name = $1
            GROUP BY s.user_id, s.problem_id
        `, [className]);

        // Build marksheet data
        const marksheetData = studentsResult.rows.map((student, index) => {
            const studentSubmissions = submissionsResult.rows.filter(s => s.user_id === student.id);

            const row = {
                'S.No': index + 1,
                'Name': student.name,
                'Email': student.email,
                'Registration Number': student.reg_no,
                'Batch': student.batch_year,
                'Department': student.department
            };

            // Add problem scores
            let totalScore = 0;
            problemIds.forEach(problemId => {
                const submission = studentSubmissions.find(s => s.problem_id === problemId);
                const score = submission ? parseInt(submission.best_score) : 0;
                row[`Problem ${problemId}`] = score;
                totalScore += score;
            });

            row['Total Score'] = totalScore;
            row['Status'] = studentSubmissions.length > 0 ? 'Attempted' : 'Not Attempted';

            return row;
        });

        // Create workbook
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(marksheetData);

        // Auto-size columns
        const colWidths = Object.keys(marksheetData[0] || {}).map(key => ({
            wch: Math.max(key.length, 15)
        }));
        ws['!cols'] = colWidths;

        xlsx.utils.book_append_sheet(wb, ws, 'Marksheet');

        // Add summary sheet
        const summary = [
            { 'Metric': 'Class', 'Value': className },
            { 'Metric': 'Total Students', 'Value': studentsResult.rows.length },
            { 'Metric': 'Students Attempted', 'Value': new Set(submissionsResult.rows.map(s => s.user_id)).size },
            { 'Metric': 'Students Not Attempted', 'Value': studentsResult.rows.length - new Set(submissionsResult.rows.map(s => s.user_id)).size },
            { 'Metric': 'Total Problems', 'Value': problemIds.length },
            { 'Metric': 'Generated On', 'Value': new Date().toLocaleString() }
        ];
        const summarySheet = xlsx.utils.json_to_sheet(summary);
        xlsx.utils.book_append_sheet(wb, summarySheet, 'Summary');

        // Generate Excel file
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${className.replace(/ /g, '_')}_marksheet.xlsx"`);
        res.send(buffer);

    } catch (error) {
        console.error('Export marksheet error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
