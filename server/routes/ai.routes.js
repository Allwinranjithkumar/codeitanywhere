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

        const points = diffNormalized === 'Easy' ? 10 : (diffNormalized === 'Medium' ? 20 : 30);
        const constraintsStr = Array.isArray(draft.constraints) ? draft.constraints.join('\n') : JSON.stringify(draft.constraints);

        const existingProb = await db.query(`SELECT id FROM problems WHERE title = $1`, [draft.title]);
        let publishedProblem;

        if (existingProb.rowCount > 0) {
            const updateSql = `
                UPDATE problems
                SET description = $1, difficulty = $2, points = $3, function_name = $4, constraints = $5,
                    input_format = $6, output_format = $7, pattern_tags = $8, ai_generated = TRUE,
                    source_reference = $9, reference_approach = $10, is_active = TRUE, updated_at = NOW()
                WHERE id = $11
                RETURNING *;
            `;
            const { rows } = await db.query(updateSql, [
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
                existingProb.rows[0].id
            ]);
            publishedProblem = rows[0];
            await db.query('DELETE FROM test_cases WHERE problem_id = $1', [publishedProblem.id]);
        } else {
            const insertProblemSql = `
                INSERT INTO problems (
                    title, description, difficulty, points, function_name, constraints,
                    input_format, output_format, pattern_tags, ai_generated,
                    source_reference, reference_approach, created_by, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11, $12, TRUE)
                RETURNING *;
            `;
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
            publishedProblem = newProblems[0];
        }

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

const { generateContestReport, getLatestContestReport } = require('../services/reportService');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/analyze-contest/:contestId — AI Post-Contest Intelligence Report
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze-contest/:contestId', async (req, res) => {
    try {
        const contestId = parseInt(req.params.contestId, 10);
        if (isNaN(contestId)) {
            return res.status(400).json({ success: false, error: 'Invalid contest ID.' });
        }

        const result = await generateContestReport(contestId);

        res.status(200).json({
            success: true,
            message: 'Contest intelligence report generated and persisted.',
            report: result.report_data,
            metrics: result.deterministic_metrics,
            analysis: result.report_data,
            id: result.id,
            created_at: result.created_at
        });

    } catch (err) {
        console.error('[AI Analyst] Report generation error:', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/contest-analysis/:contestId — Fetch latest report
// ─────────────────────────────────────────────────────────────────────────────
router.get('/contest-analysis/:contestId', async (req, res) => {
    try {
        const contestId = parseInt(req.params.contestId, 10);
        if (isNaN(contestId)) {
            return res.status(400).json({ success: false, error: 'Invalid contest ID.' });
        }

        const reportRecord = await getLatestContestReport(contestId);

        if (!reportRecord) {
            return res.status(404).json({ success: false, error: 'No report found for this contest yet.' });
        }

        res.json({
            success: true,
            report: reportRecord.report_data,
            metrics: reportRecord.deterministic_metrics,
            analysis: reportRecord.report_data,
            id: reportRecord.id,
            created_at: reportRecord.created_at
        });
    } catch (err) {
        console.error('[AI Analyst] Fetch report error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
