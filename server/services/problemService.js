/**
 * problemService.js — Problem management backed by PostgreSQL.
 *
 * PostgreSQL is the single source of truth for all problems and test cases.
 * Test cases are NEVER sent to the student-facing API — only sample cases.
 *
 * Provides:
 *   getProblemsForStudent(contestId?) — public fields + sample test cases only
 *   getProblemsForAdmin()             — all fields + all test cases
 *   getProblemWithTestCases(id)       — full problem + all test cases (for judge)
 *   createProblem(data)               — insert new problem + test cases
 *   updateProblem(id, data)           — update problem fields
 *   deactivateProblem(id)             — soft delete
 *   migrateFromJson(problems)         — one-time migration from problems.json
 */

const db = require('../db');

// ──────────────────────────────────────────────
// Student-facing: sample cases only, no hidden test data
// ──────────────────────────────────────────────

async function getProblemsForStudent(contestId = null) {
    let problemRows;

    if (contestId) {
        // Problems assigned to a specific contest
        const result = await db.query(
            `SELECT p.id, p.title, p.description, p.difficulty, p.points, p.function_name, p.constraints,
                    cp.order_index
             FROM problems p
             JOIN contest_problems cp ON cp.problem_id = p.id
             WHERE cp.contest_id = $1 AND p.is_active = TRUE
             ORDER BY cp.order_index ASC, p.id ASC`,
            [contestId]
        );
        problemRows = result.rows;
    } else {
        // All active problems (no contest filter)
        const result = await db.query(
            `SELECT id, title, description, difficulty, points, function_name, constraints
             FROM problems WHERE is_active = TRUE ORDER BY id ASC`
        );
        problemRows = result.rows;
    }

    if (problemRows.length === 0) return [];

    const problemIds = problemRows.map(p => p.id);

    // Fetch only sample test cases for these problems
    const testCaseResult = await db.query(
        `SELECT id, problem_id, input_data, output_data, explanation, is_sample, order_index
         FROM test_cases
         WHERE problem_id = ANY($1) AND is_sample = TRUE
         ORDER BY problem_id, order_index ASC`,
        [problemIds]
    );

    // Fetch starter code
    const starterCodeResult = await db.query(
        `SELECT problem_id, language, code FROM starter_code WHERE problem_id = ANY($1)`,
        [problemIds]
    );

    // Assemble
    return problemRows.map(problem => {
        const testCases = testCaseResult.rows
            .filter(tc => tc.problem_id === problem.id)
            .map(tc => ({ input: tc.input_data, output: tc.output_data, explanation: tc.explanation }));

        const starterCode = {};
        starterCodeResult.rows
            .filter(sc => sc.problem_id === problem.id)
            .forEach(sc => { starterCode[sc.language] = sc.code; });

        return {
            id:           problem.id,
            title:        problem.title,
            description:  problem.description,
            difficulty:   problem.difficulty,
            points:       problem.points,
            functionName: problem.function_name,
            constraints:  problem.constraints,
            starterCode,
            // Only sample test cases — hidden test cases are NEVER sent here
            testCases
        };
    });
}

// ──────────────────────────────────────────────
// Admin-facing: full data including all test cases
// ──────────────────────────────────────────────

async function getProblemsForAdmin() {
    const result = await db.query(
        `SELECT id, title, description, difficulty, points, function_name, constraints, is_active, created_at, updated_at
         FROM problems ORDER BY id ASC`
    );

    if (result.rows.length === 0) return [];

    const problemIds = result.rows.map(p => p.id);

    const testCaseResult = await db.query(
        `SELECT id, problem_id, input_data, output_data, is_sample, order_index
         FROM test_cases WHERE problem_id = ANY($1) ORDER BY problem_id, order_index ASC`,
        [problemIds]
    );

    const starterCodeResult = await db.query(
        `SELECT problem_id, language, code FROM starter_code WHERE problem_id = ANY($1)`,
        [problemIds]
    );

    return result.rows.map(problem => {
        const testCases = testCaseResult.rows.filter(tc => tc.problem_id === problem.id);
        const starterCode = {};
        starterCodeResult.rows.filter(sc => sc.problem_id === problem.id)
            .forEach(sc => { starterCode[sc.language] = sc.code; });

        return { ...problem, testCases, starterCode };
    });
}

// ──────────────────────────────────────────────
// Judge: problem + ALL test cases for evaluation
// ──────────────────────────────────────────────

async function getProblemWithTestCases(problemId) {
    const problemResult = await db.query(
        'SELECT * FROM problems WHERE id = $1 AND is_active = TRUE',
        [problemId]
    );

    if (problemResult.rowCount === 0) return null;

    const problem = problemResult.rows[0];

    const testCasesResult = await db.query(
        'SELECT input_data, output_data, is_sample FROM test_cases WHERE problem_id = $1 ORDER BY order_index ASC',
        [problemId]
    );

    return {
        ...problem,
        functionName: problem.function_name,
        testCases: testCasesResult.rows.map(tc => ({
            input: tc.input_data,
            output: tc.output_data,
            isSample: tc.is_sample
        }))
    };
}

// ──────────────────────────────────────────────
// Admin: Create Problem
// ──────────────────────────────────────────────

async function createProblem({ title, description, difficulty, points, functionName, constraints, testCases, starterCode, createdBy }) {
    // Insert problem
    const problemResult = await db.query(
        `INSERT INTO problems (title, description, difficulty, points, function_name, constraints, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [title, description, difficulty || 'Medium', points || 10, functionName, constraints, createdBy]
    );
    const problemId = problemResult.rows[0].id;

    // Insert test cases
    if (testCases && testCases.length > 0) {
        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            await db.query(
                `INSERT INTO test_cases (problem_id, input_data, output_data, explanation, is_sample, order_index)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [problemId, JSON.stringify(tc.input), JSON.stringify(tc.output), tc.explanation || null, tc.isSample !== false, i]
            );
        }
    }

    // Insert starter code
    if (starterCode && typeof starterCode === 'object') {
        for (const [lang, code] of Object.entries(starterCode)) {
            await db.query(
                `INSERT INTO starter_code (problem_id, language, code)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (problem_id, language) DO UPDATE SET code = EXCLUDED.code`,
                [problemId, lang, code]
            );
        }
    }

    return problemId;
}

// ──────────────────────────────────────────────
// Admin: Update Problem
// ──────────────────────────────────────────────

async function updateProblem(id, { title, description, difficulty, points, functionName, constraints }) {
    await db.query(
        `UPDATE problems
         SET title=$1, description=$2, difficulty=$3, points=$4, function_name=$5, constraints=$6, updated_at=NOW()
         WHERE id=$7`,
        [title, description, difficulty, points, functionName, constraints, id]
    );
}

// ──────────────────────────────────────────────
// Admin: Soft-delete Problem
// ──────────────────────────────────────────────

async function deactivateProblem(id) {
    await db.query('UPDATE problems SET is_active=FALSE, updated_at=NOW() WHERE id=$1', [id]);
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// Migration / Bulk JSON Import & Update
// ──────────────────────────────────────────────

async function upsertFromJson(jsonProblems, overwrite = true) {
    if (!Array.isArray(jsonProblems)) {
        if (jsonProblems && typeof jsonProblems === 'object' && jsonProblems.title) {
            jsonProblems = [jsonProblems];
        } else {
            return { created: 0, updated: 0, total: 0 };
        }
    }

    let created = 0;
    let updated = 0;

    for (const p of jsonProblems) {
        try {
            if (!p.title) continue;
            const functionName = p.functionName || p.function_name || 'solution';
            const constraints = Array.isArray(p.constraints) ? p.constraints.join('\n') : (p.constraints || null);

            // Derive parameter names from testCases input if available
            let paramNames = 'nums';
            if (Array.isArray(p.testCases) && p.testCases.length > 0) {
                const firstIn = p.testCases[0].input || p.testCases[0].input_data;
                if (firstIn && typeof firstIn === 'object' && !Array.isArray(firstIn)) {
                    const keys = Object.keys(firstIn);
                    if (keys.length > 0) paramNames = keys.join(', ');
                }
            }

            // Starter code with smart defaults (optional in JSON!)
            const starterCode = p.starterCode || {};
            if (!starterCode.python) starterCode.python = `def ${functionName}(${paramNames}):\n    # Write your solution here\n    pass`;
            if (!starterCode.cpp) starterCode.cpp = `class Solution {\npublic:\n    int ${functionName}(${paramNames}) {\n        return 0;\n    }\n};`;
            if (!starterCode.java) starterCode.java = `class Solution {\n    public int ${functionName}(${paramNames}) {\n        return 0;\n    }\n}`;
            if (!starterCode.javascript) starterCode.javascript = `function ${functionName}(${paramNames}) {\n    // Write your solution here\n}`;
            if (!starterCode.c) starterCode.c = `int ${functionName}(${paramNames}) {\n    return 0;\n}`;

            const testCases = (p.testCases || []).map((tc, i) => ({
                input: tc.input !== undefined ? tc.input : (tc.input_data !== undefined ? tc.input_data : {}),
                output: tc.output !== undefined ? tc.output : (tc.output_data !== undefined ? tc.output_data : 0),
                explanation: tc.explanation || null,
                isSample: tc.isSample !== undefined ? tc.isSample : (tc.is_sample !== undefined ? tc.is_sample : (i < 2))
            }));

            // Check if already exists by title
            const existing = await db.query('SELECT id FROM problems WHERE title=$1', [p.title]);
            if (existing.rowCount > 0) {
                if (overwrite) {
                    const problemId = existing.rows[0].id;
                    await db.query(
                        `UPDATE problems 
                         SET description=$1, difficulty=$2, points=$3, function_name=$4, constraints=$5, is_active=TRUE, updated_at=NOW()
                         WHERE id=$6`,
                        [p.description || '', p.difficulty || 'Medium', p.points || 100, functionName, constraints, problemId]
                    );

                    // Starter code
                    for (const [lang, code] of Object.entries(starterCode)) {
                        await db.query(
                            `INSERT INTO starter_code (problem_id, language, code)
                             VALUES ($1, $2, $3)
                             ON CONFLICT (problem_id, language) DO UPDATE SET code = EXCLUDED.code`,
                            [problemId, lang, code]
                        );
                    }

                    // Test cases
                    if (testCases.length > 0) {
                        await db.query('DELETE FROM test_cases WHERE problem_id=$1', [problemId]);
                        for (let i = 0; i < testCases.length; i++) {
                            const tc = testCases[i];
                            await db.query(
                                `INSERT INTO test_cases (problem_id, input_data, output_data, explanation, is_sample, order_index)
                                 VALUES ($1, $2, $3, $4, $5, $6)`,
                                [problemId, JSON.stringify(tc.input), JSON.stringify(tc.output), tc.explanation || null, tc.isSample !== false, i]
                            );
                        }
                    }
                    updated++;
                }
            } else {
                await createProblem({
                    title: p.title,
                    description: p.description || '',
                    difficulty: p.difficulty || 'Medium',
                    points: p.points || 100,
                    functionName,
                    constraints,
                    testCases,
                    starterCode,
                    createdBy: null
                });
                created++;
            }
        } catch (err) {
            console.error(`[Problem JSON Import] Failed for "${p.title}":`, err.message);
        }
    }
    return { created, updated, total: created + updated };
}

async function exportProblemsJson() {
    const problems = await getProblemsForAdmin();
    return problems.map(p => ({
        title: p.title,
        description: p.description,
        difficulty: p.difficulty,
        points: p.points,
        functionName: p.function_name,
        constraints: p.constraints ? (p.constraints.includes('\n') ? p.constraints.split('\n') : [p.constraints]) : [],
        starterCode: p.starterCode || {},
        testCases: (p.testCases || []).map(tc => ({
            input: tc.input_data,
            output: tc.output_data,
            explanation: tc.explanation || '',
            isSample: tc.is_sample
        }))
    }));
}

module.exports = {
    getProblemsForStudent,
    getProblemsForAdmin,
    getProblemWithTestCases,
    createProblem,
    updateProblem,
    deactivateProblem,
    migrateFromJson: upsertFromJson,
    upsertFromJson,
    exportProblemsJson
};

