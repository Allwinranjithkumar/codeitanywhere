/**
 * ai.routes.js — AI Co-Problem-Setter and AI Contest Analyst Router
 *
 * Endpoints:
 *   GET  /api/ai/patterns                    — Fetch DSA pattern taxonomy from sheet
 *   POST /api/ai/generate-problem            — Auto-Problem Studio (Generate & Stage Problem)
 *   GET  /api/ai/generated-problems          — List all AI-generated draft problems
 *   GET  /api/ai/generated-problems/:id      — Retrieve single AI draft
 *   POST /api/ai/publish-problem/:id         — Promote AI draft into live problems table
 *   POST /api/ai/analyze-contest/:contestId  — AI Post-Contest Intelligence generator
 *   GET  /api/ai/contest-analysis/:contestId — Fetch latest post-contest analysis report
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, verifyAdmin } = require('../middleware/auth.middleware');
const { getDSAPatterns } = require('../services/patternService');
const { callLLM, parseJsonSafely } = require('../services/aiService');

// All AI endpoints require authentication & admin/organizer privileges
router.use(authenticateToken);
router.use(verifyAdmin);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/patterns — Fetch DSA Pattern Taxonomy
// ─────────────────────────────────────────────────────────────────────────────
router.get('/patterns', async (req, res) => {
    try {
        const patterns = getDSAPatterns();
        res.json({
            success: true,
            total: patterns.length,
            patterns
        });
    } catch (err) {
        console.error('[AI Router] Error loading patterns:', err.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve pattern taxonomy.' });
    }
});

// Helper: convert problem title to camelCase function_name
function toCamelCase(str) {
    if (!str) return 'solution';
    const cleaned = str.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'solution';
    return parts.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
}

// Helper: generate starter code for multi-language judge
function generateStarterTemplates(funcName = 'solution') {
    return {
        python: `def ${funcName}(*args):\n    # Write your solution here\n    pass`,
        cpp: `class Solution {\npublic:\n    int ${funcName}(vector<int>& nums) {\n        // Write your solution here\n        return 0;\n    }\n};`,
        java: `class Solution {\n    public int ${funcName}(int[] nums) {\n        // Write your solution here\n        return 0;\n    }\n}`,
        javascript: `function ${funcName}(...args) {\n    // Write your solution here\n}`,
        c: `int ${funcName}(int* nums, int numsSize) {\n    // Write your solution here\n    return 0;\n}`
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/generate-problem — Auto-Problem Studio
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate-problem', async (req, res) => {
    try {
        const {
            topic_patterns,
            difficulty_target = 'medium',
            additional_notes = '',
            language_preference = 'C++'
        } = req.body;

        // 1. Validation
        if (!topic_patterns || !Array.isArray(topic_patterns) || topic_patterns.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one topic pattern must be provided in topic_patterns array.'
            });
        }

        const validDifficulties = ['easy', 'medium', 'hard'];
        const normalizedDiff = difficulty_target.toLowerCase();
        if (!validDifficulties.includes(normalizedDiff)) {
            return res.status(400).json({
                success: false,
                error: 'difficulty_target must be "easy", "medium", or "hard".'
            });
        }

        // 2. Construct Prompt Messages
        const systemMessage = {
            role: 'system',
            content: `You are an elite competitive programming problem setter and algorithms pedagogue for CodeItAnywhere.
Your task is to invent an original, mathematically sound problem adhering to DSA patterns.
Output STRICTLY a valid JSON object without conversational commentary.`
        };

        const userMessage = {
            role: 'user',
            content: `Create an original competitive programming problem.
Topic Patterns: ${JSON.stringify(topic_patterns)}
Target Difficulty: ${normalizedDiff}
Language Preference: ${language_preference}
Additional Author Notes: ${additional_notes || 'None'}

Return ONLY a valid JSON object matching this structure:
{
  "title": "string",
  "function_name": "camelCaseFunctionIdentifier (e.g. minRelayHops, maxSubarraySum)",
  "statement": "string (in Markdown with background context, clear rules, and problem objective)",
  "input_format": "string (precise line-by-line input specifications)",
  "output_format": "string (precise description of expected output)",
  "constraints": ["string (e.g. 1 <= N <= 10^5, 0 <= M <= 2 * 10^5)"],
  "starter_code": {
    "python": "def funcName(*args):\\n    pass",
    "cpp": "class Solution {\\npublic:\\n    int funcName(vector<int>& nums) {\\n        return 0;\\n    }\\n};",
    "java": "class Solution {\\n    public int funcName(int[] nums) {\\n        return 0;\\n    }\\n}",
    "javascript": "function funcName(...args) {\\n}",
    "c": "int funcName(int* nums, int numsSize) {\\n    return 0;\\n}"
  },
  "samples": [
    {
      "input": "string",
      "output": "string",
      "explanation": "string (explicit step-by-step trace showing why output was produced)"
    }
  ],
  "hidden_tests": [
    {
      "input": "string",
      "output": "string",
      "notes": "normal" | "edge" | "stress"
    }
  ],
  "pattern_tags": ${JSON.stringify(topic_patterns)},
  "difficulty_estimate": "${normalizedDiff}",
  "reference_approach": {
    "language": "${language_preference}",
    "idea": "string",
    "complexity": { "time": "string", "space": "string" }
  }
}`
        };

        // 3. Call LLM
        let rawResponse;
        try {
            rawResponse = await callLLM([systemMessage, userMessage], { responseFormatJson: true });
        } catch (llmErr) {
            console.error('[AI Studio] LLM call error:', llmErr.message);
            return res.status(502).json({
                success: false,
                error: `AI generation failed: ${llmErr.message}`
            });
        }

        // 4. Parse JSON
        let problemData;
        try {
            problemData = parseJsonSafely(rawResponse);
        } catch (parseErr) {
            console.error('[AI Studio] JSON parsing error:', parseErr.message, rawResponse);
            return res.status(502).json({
                success: false,
                error: 'AI response was not valid JSON. Please retry.',
                raw: rawResponse
            });
        }

        const funcName = problemData.function_name || toCamelCase(problemData.title || 'solution');
        const starterCode = problemData.starter_code || generateStarterTemplates(funcName);

        // 5. Persist into ai_generated_problems table
        const insertQuery = `
            INSERT INTO ai_generated_problems (
                title, statement, input_format, output_format,
                constraints, samples, hidden_tests, pattern_tags,
                difficulty_estimate, reference_approach,
                function_name, starter_code,
                ai_generated, source_reference, status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13, 'draft', $14)
            RETURNING *;
        `;

        const queryParams = [
            problemData.title || 'Untitled Problem',
            problemData.statement || problemData.description || '',
            problemData.input_format || problemData.inputFormat || '',
            problemData.output_format || problemData.outputFormat || '',
            JSON.stringify(problemData.constraints || []),
            JSON.stringify(problemData.samples || []),
            JSON.stringify(problemData.hidden_tests || []),
            JSON.stringify(problemData.pattern_tags || topic_patterns),
            normalizedDiff,
            JSON.stringify(problemData.reference_approach || {}),
            funcName,
            JSON.stringify(starterCode),
            process.env.GROQ_API_KEY ? 'Groq Llama-3.3-70B' : (process.env.GEMINI_API_KEY ? 'Google Gemini' : 'CodeItAnywhere AI Studio'),
            req.user?.id || null
        ];

        const { rows } = await db.query(insertQuery, queryParams);

        res.status(201).json({
            success: true,
            problem: rows[0]
        });

    } catch (err) {
        console.error('[AI Studio] Unexpected error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/generated-problems — List AI Draft Problems
// ─────────────────────────────────────────────────────────────────────────────
router.get('/generated-problems', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        let queryStr = `SELECT * FROM ai_generated_problems`;
        const params = [];

        if (status) {
            queryStr += ` WHERE status = $1`;
            params.push(status);
        }

        queryStr += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit) || 50);

        const { rows } = await db.query(queryStr, params);
        res.json({ success: true, count: rows.length, problems: rows });
    } catch (err) {
        console.error('[AI Studio] Fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch AI-generated problems.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/generated-problems/:id — Get Single AI Draft Problem
// ─────────────────────────────────────────────────────────────────────────────
router.get('/generated-problems/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { rows } = await db.query(`SELECT * FROM ai_generated_problems WHERE id = $1`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Generated problem not found.' });
        }
        res.json({ success: true, problem: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/publish-problem/:id — Promote Draft to Live Problem
// ─────────────────────────────────────────────────────────────────────────────
router.post('/publish-problem/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const draftRes = await db.query(`SELECT * FROM ai_generated_problems WHERE id = $1`, [id]);
        if (draftRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Draft problem not found.' });
        }

        const draft = draftRes.rows[0];

        // Format difficulty to Title Case ('Easy', 'Medium', 'Hard')
        const diffNormalized = draft.difficulty_estimate.charAt(0).toUpperCase() + draft.difficulty_estimate.slice(1).toLowerCase();

        const funcName = draft.function_name || toCamelCase(draft.title || 'solution');
        const starterCode = draft.starter_code || generateStarterTemplates(funcName);

        // 1. Insert into main problems table
        const insertProblemSql = `
            INSERT INTO problems (
                title, description, difficulty, points, function_name, constraints,
                input_format, output_format, pattern_tags, ai_generated,
                source_reference, reference_approach, created_by, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11, $12, TRUE)
            RETURNING *;
        `;

        const points = diffNormalized === 'Easy' ? 10 : (diffNormalized === 'Medium' ? 20 : 30);
        const constraintsStr = Array.isArray(draft.constraints) ? draft.constraints.join('\n') : JSON.stringify(draft.constraints);

        const { rows: newProblems } = await db.query(insertProblemSql, [
            draft.title,
            draft.statement,
            diffNormalized,
            points,
            funcName,
            constraintsStr,
            draft.input_format,
            draft.output_format,
            JSON.stringify(draft.pattern_tags),
            draft.source_reference,
            JSON.stringify(draft.reference_approach),
            req.user?.id || null
        ]);

        const publishedProblem = newProblems[0];

        // 2. Insert Starter Code for multi-language judge
        for (const [lang, code] of Object.entries(starterCode)) {
            await db.query(
                `INSERT INTO starter_code (problem_id, language, code)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (problem_id, language) DO UPDATE SET code = EXCLUDED.code`,
                [publishedProblem.id, lang, code]
            );
        }

        // 2. Insert Samples and Hidden Tests into test_cases table
        let order = 0;
        const samples = Array.isArray(draft.samples) ? draft.samples : [];
        for (const sample of samples) {
            await db.query(
                `INSERT INTO test_cases (problem_id, input_data, output_data, explanation, is_sample, order_index)
                 VALUES ($1, $2, $3, $4, TRUE, $5)`,
                [publishedProblem.id, JSON.stringify(sample.input), JSON.stringify(sample.output), sample.explanation || null, order++]
            );
        }

        const hidden = Array.isArray(draft.hidden_tests) ? draft.hidden_tests : [];
        for (const tc of hidden) {
            await db.query(
                `INSERT INTO test_cases (problem_id, input_data, output_data, explanation, is_sample, order_index)
                 VALUES ($1, $2, $3, $4, FALSE, $5)`,
                [publishedProblem.id, JSON.stringify(tc.input), JSON.stringify(tc.output), tc.notes || null, order++]
            );
        }

        // 3. Mark draft as published
        await db.query(`UPDATE ai_generated_problems SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

        res.status(201).json({
            success: true,
            message: 'Problem successfully published to active problem bank.',
            problem: publishedProblem
        });

    } catch (err) {
        console.error('[AI Studio] Publish error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/analyze-contest/:contestId — AI Post-Contest Intelligence
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze-contest/:contestId', async (req, res) => {
    try {
        const contestId = parseInt(req.params.contestId, 10);
        if (isNaN(contestId)) {
            return res.status(400).json({ success: false, error: 'Invalid contest ID.' });
        }

        // 1. Contest Details
        const contestRes = await db.query(
            `SELECT id, name, description, start_time, end_time, duration_minutes, status 
             FROM contests WHERE id = $1`,
            [contestId]
        );
        if (contestRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Contest not found.' });
        }
        const contest = contestRes.rows[0];

        // 2. Problem Performance Metrics
        const problemStatsQuery = `
            SELECT 
                p.id,
                p.title,
                p.difficulty,
                COALESCE(p.pattern_tags, '[]'::jsonb) AS pattern_tags,
                COUNT(s.id) AS total_submissions,
                COUNT(DISTINCT CASE WHEN s.status = 'Accepted' THEN s.user_id END) AS solve_count,
                COALESCE(
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (s.submitted_at - c.start_time))
                    ) FILTER (WHERE s.status = 'Accepted')), 
                    0
                ) AS avg_time_to_first_ac_seconds,
                COALESCE(
                    jsonb_object_agg(s.status, s.status_count) FILTER (WHERE s.status IS NOT NULL), 
                    '{}'::jsonb
                ) AS wrong_verdicts_distribution
            FROM contest_problems cp
            JOIN problems p ON p.id = cp.problem_id
            JOIN contests c ON c.id = cp.contest_id
            LEFT JOIN (
                SELECT 
                    id, contest_id, problem_id, user_id, status, submitted_at,
                    COUNT(*) OVER (PARTITION BY problem_id, status) AS status_count
                FROM submissions
                WHERE contest_id = $1
            ) s ON s.problem_id = p.id
            WHERE cp.contest_id = $1
            GROUP BY p.id, p.title, p.difficulty, p.pattern_tags;
        `;
        const problemStatsRes = await db.query(problemStatsQuery, [contestId]);

        // 3. Participant Telemetry (Leaderboard Sample)
        const participantsLeaderboardQuery = `
            SELECT 
                u.id AS participant_id,
                u.name,
                COUNT(DISTINCT CASE WHEN s.status = 'Accepted' THEN s.problem_id END) AS problems_solved,
                COALESCE(SUM(s.score), 0) AS total_score,
                COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (s.submitted_at - c.start_time)))), 0) AS total_time_seconds
            FROM contest_participants cp
            JOIN users u ON u.id = cp.user_id
            JOIN contests c ON c.id = cp.contest_id
            LEFT JOIN submissions s ON s.contest_id = cp.contest_id AND s.user_id = u.id
            WHERE cp.contest_id = $1
            GROUP BY u.id, u.name, c.start_time
            ORDER BY problems_solved DESC, total_score DESC, total_time_seconds ASC;
        `;
        const leaderboardRes = await db.query(participantsLeaderboardQuery, [contestId]);
        const participants = leaderboardRes.rows;
        const totalParticipants = participants.length;

        const topParticipants = participants.slice(0, 3);
        const bottomParticipants = participants.length > 3 ? participants.slice(-3) : [];

        // 4. Anti-cheat / Violations
        const violationsRes = await db.query(
            `SELECT type, metadata, occurred_at FROM violations WHERE contest_id = $1`,
            [contestId]
        );

        const telemetrySnapshot = {
            contest_id: contest.id,
            contest_name: contest.name,
            num_participants: totalParticipants,
            duration_minutes: contest.duration_minutes,
            problems: problemStatsRes.rows,
            plagiarism_flags: violationsRes.rows,
            top_participants: topParticipants,
            bottom_participants: bottomParticipants
        };

        // 5. Build Prompts
        const systemMessage = {
            role: 'system',
            content: `You are an executive contest director, psychometrics analyst, and algorithmic coach for CodeItAnywhere.
Ground your analysis strictly on the provided contest telemetry. Produce actionable, constructive post-mortem intelligence.
Output STRICTLY a valid JSON object.`
        };

        const userMessage = {
            role: 'user',
            content: `Analyze the post-contest telemetry for Contest #${contest.id}: "${contest.name}".

Telemetry Data:
${JSON.stringify(telemetrySnapshot, null, 2)}

Produce a JSON response strictly conforming to:
{
  "organizer_summary": "3-6 sentences reviewing turnout, problem balance, difficulty trajectory, and bottlenecks.",
  "key_insights": [
    "3-5 deep quantitative insights directly referencing problem titles, pattern tags, and verdicts."
  ],
  "suggestions": [
    "2-3 concrete pedagogical and operational suggestions for faculty/organizers for future contests."
  ],
  "participant_feedback": [
    {
      "participant_id": 1,
      "feedback": "constructive, encouraging 1-2 sentence tip tailored to performance"
    }
  ]
}`
        };

        // 6. Call LLM
        let rawAnalysis;
        try {
            rawAnalysis = await callLLM([systemMessage, userMessage], { responseFormatJson: true });
        } catch (llmErr) {
            console.error('[AI Analyst] LLM call failed:', llmErr.message);
            return res.status(502).json({
                success: false,
                error: `Analysis failed: ${llmErr.message}`
            });
        }

        // 7. Parse JSON
        let parsedAnalysis;
        try {
            parsedAnalysis = parseJsonSafely(rawAnalysis);
        } catch (err) {
            return res.status(502).json({
                success: false,
                error: 'Could not parse AI analysis into valid JSON.',
                raw: rawAnalysis
            });
        }

        // 8. Save into contest_ai_analyses Table
        const insertAnalysisQuery = `
            INSERT INTO contest_ai_analyses (
                contest_id, organizer_summary, key_insights,
                suggestions, participant_feedback, metrics_snapshot
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;

        const { rows: savedRows } = await db.query(insertAnalysisQuery, [
            contestId,
            parsedAnalysis.organizer_summary || 'Analysis generated successfully.',
            JSON.stringify(parsedAnalysis.key_insights || []),
            JSON.stringify(parsedAnalysis.suggestions || []),
            JSON.stringify(parsedAnalysis.participant_feedback || []),
            JSON.stringify(telemetrySnapshot)
        ]);

        res.status(200).json({
            success: true,
            analysis: savedRows[0]
        });

    } catch (err) {
        console.error('[AI Analyst] Unexpected error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/contest-analysis/:contestId — Fetch latest analysis
// ─────────────────────────────────────────────────────────────────────────────
router.get('/contest-analysis/:contestId', async (req, res) => {
    try {
        const contestId = parseInt(req.params.contestId, 10);
        const { rows } = await db.query(
            `SELECT * FROM contest_ai_analyses WHERE contest_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [contestId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No analysis found for this contest yet.' });
        }

        res.json({ success: true, analysis: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
