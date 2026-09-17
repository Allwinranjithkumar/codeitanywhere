/**
 * db.js — PostgreSQL connection pool and schema initialization
 *
 * PostgreSQL is the SINGLE SOURCE OF TRUTH.
 * There is NO in-memory fallback, NO mock data.
 * If the database is unavailable, the server returns appropriate errors.
 */

const { Pool } = require('pg');
require('dotenv').config();

// ──────────────────────────────────────────────
// Connection Pool
// ──────────────────────────────────────────────

let poolConfig;

if (process.env.DATABASE_URL) {
    // Hosted / production (Render, Railway, Supabase, etc.)
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
} else {
    // Local development
    poolConfig = {
        user:     process.env.DB_USER     || 'postgres',
        host:     process.env.DB_HOST     || 'localhost',
        database: process.env.DB_NAME     || 'coding_platform',
        password: process.env.DB_PASSWORD || '',
        port:     parseInt(process.env.DB_PORT) || 5432
    };
}

const pool = new Pool(poolConfig);

// Log pool errors without crashing the process
pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err.message);
});

// ──────────────────────────────────────────────
// Query Helper
// ──────────────────────────────────────────────

async function query(text, params) {
    const client = await pool.connect();
    try {
        const result = await client.query(text, params);
        return result;
    } finally {
        client.release();
    }
}

// ──────────────────────────────────────────────
// Schema Initialization
// ──────────────────────────────────────────────

async function initDB() {
    console.log('[DB] Initializing schema...');

    // Users
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            name          VARCHAR(255) NOT NULL,
            email         VARCHAR(255) UNIQUE NOT NULL,
            reg_no        VARCHAR(50)  UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role          VARCHAR(20)  NOT NULL DEFAULT 'student'
                          CHECK (role IN ('student', 'admin')),
            batch_year    VARCHAR(10),
            department    VARCHAR(50),
            class_name    VARCHAR(50),
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Contests
    await query(`
        CREATE TABLE IF NOT EXISTS contests (
            id               SERIAL PRIMARY KEY,
            name             VARCHAR(255) NOT NULL,
            description      TEXT,
            start_time       TIMESTAMP NOT NULL,
            end_time         TIMESTAMP NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            status           VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT','UPCOMING','ACTIVE','ENDED')),
            anti_cheat       BOOLEAN NOT NULL DEFAULT FALSE,
            created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Problems
    await query(`
        CREATE TABLE IF NOT EXISTS problems (
            id            SERIAL PRIMARY KEY,
            title         VARCHAR(255) NOT NULL,
            description   TEXT NOT NULL,
            difficulty    VARCHAR(20) DEFAULT 'Medium'
                          CHECK (difficulty IN ('Easy','Medium','Hard')),
            points        INTEGER NOT NULL DEFAULT 10,
            function_name VARCHAR(100),
            constraints   TEXT,
            created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Test Cases (stored separately — hidden test cases never sent to students)
    await query(`
        CREATE TABLE IF NOT EXISTS test_cases (
            id          SERIAL PRIMARY KEY,
            problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
            input_data  JSONB NOT NULL,
            output_data JSONB NOT NULL,
            is_sample   BOOLEAN NOT NULL DEFAULT FALSE,
            order_index INTEGER NOT NULL DEFAULT 0,
            explanation TEXT,
            created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Ensure explanation column exists on existing installations
    await query(`ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS explanation TEXT;`);

    // Starter Code per language per problem
    await query(`
        CREATE TABLE IF NOT EXISTS starter_code (
            id         SERIAL PRIMARY KEY,
            problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
            language   VARCHAR(20) NOT NULL,
            code       TEXT NOT NULL,
            UNIQUE(problem_id, language)
        );
    `);

    // Contest ↔ Problem mapping
    await query(`
        CREATE TABLE IF NOT EXISTS contest_problems (
            contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
            problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (contest_id, problem_id)
        );
    `);

    // Contest Participants
    await query(`
        CREATE TABLE IF NOT EXISTS contest_participants (
            contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (contest_id, user_id)
        );
    `);

    // Submissions — full history (multiple per user/problem/contest)
    await query(`
        CREATE TABLE IF NOT EXISTS submissions (
            id                SERIAL PRIMARY KEY,
            user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            contest_id        INTEGER REFERENCES contests(id) ON DELETE SET NULL,
            problem_id        INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
            language          VARCHAR(20) NOT NULL,
            source_code       TEXT NOT NULL,
            status            VARCHAR(30) NOT NULL DEFAULT 'Pending'
                              CHECK (status IN (
                                  'Pending','Accepted','Wrong Answer',
                                  'Runtime Error','Time Limit Exceeded',
                                  'Compilation Error','Internal Error'
                              )),
            score             INTEGER NOT NULL DEFAULT 0,
            passed_tests      INTEGER NOT NULL DEFAULT 0,
            total_tests       INTEGER NOT NULL DEFAULT 0,
            execution_time_ms INTEGER,
            memory_kb         INTEGER,
            error_message     TEXT,
            submitted_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Violations
    await query(`
        CREATE TABLE IF NOT EXISTS violations (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            contest_id  INTEGER REFERENCES contests(id) ON DELETE SET NULL,
            type        VARCHAR(100) NOT NULL,
            metadata    JSONB,
            occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ── AI Module Schema Extensions ─────────
    await query(`
        ALTER TABLE problems 
            ADD COLUMN IF NOT EXISTS pattern_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS input_format TEXT,
            ADD COLUMN IF NOT EXISTS output_format TEXT,
            ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS source_reference VARCHAR(255),
            ADD COLUMN IF NOT EXISTS reference_approach JSONB;
    `);

    // AI Generated Problems (Auto-Problem Studio staging/drafts)
    await query(`
        CREATE TABLE IF NOT EXISTS ai_generated_problems (
            id                   SERIAL PRIMARY KEY,
            title                VARCHAR(255) NOT NULL,
            statement            TEXT NOT NULL,
            input_format         TEXT NOT NULL,
            output_format        TEXT NOT NULL,
            constraints          JSONB NOT NULL DEFAULT '[]'::jsonb,
            samples              JSONB NOT NULL DEFAULT '[]'::jsonb,
            hidden_tests         JSONB NOT NULL DEFAULT '[]'::jsonb,
            pattern_tags         JSONB NOT NULL DEFAULT '[]'::jsonb,
            difficulty_estimate  VARCHAR(20) NOT NULL CHECK (difficulty_estimate IN ('easy', 'medium', 'hard', 'Easy', 'Medium', 'Hard')),
            reference_approach   JSONB,
            ai_generated         BOOLEAN NOT NULL DEFAULT TRUE,
            source_reference     VARCHAR(255) DEFAULT 'CodeItAnywhere AI Studio',
            status               VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
            created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Ensure columns exist on ai_generated_problems
    await query(`
        ALTER TABLE ai_generated_problems 
            ADD COLUMN IF NOT EXISTS function_name VARCHAR(100),
            ADD COLUMN IF NOT EXISTS starter_code JSONB;
    `);

    // Post-Contest AI Analyses
    await query(`
        CREATE TABLE IF NOT EXISTS contest_ai_analyses (
            id                   SERIAL PRIMARY KEY,
            contest_id           INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
            organizer_summary    TEXT NOT NULL,
            key_insights         JSONB NOT NULL DEFAULT '[]'::jsonb,
            suggestions          JSONB NOT NULL DEFAULT '[]'::jsonb,
            participant_feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
            metrics_snapshot     JSONB,
            created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Complete Post-Event Contest AI Reports
    await query(`
        CREATE TABLE IF NOT EXISTS contest_ai_reports (
            id                     SERIAL PRIMARY KEY,
            contest_id             INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
            report_data            JSONB NOT NULL,
            deterministic_metrics  JSONB NOT NULL,
            created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ── Indexes ──────────────────────────────
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_user_id    ON submissions(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_contest_id  ON submissions(contest_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_problem_id  ON submissions(problem_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_violations_user_id      ON violations(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_violations_contest_id   ON violations(contest_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_test_cases_problem_id   ON test_cases(problem_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_problems_is_active      ON problems(is_active);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contests_status         ON contests(status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_problems_pattern_tags   ON problems USING GIN (pattern_tags);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ai_problems_pattern_tags ON ai_generated_problems USING GIN (pattern_tags);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ai_problems_status       ON ai_generated_problems (status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contest_ai_analyses_contest ON contest_ai_analyses (contest_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contest_ai_reports_contest  ON contest_ai_reports (contest_id);`);

    // Ensure problem constraints and mathematical descriptions are fully populated
    try {
        await query(`
            UPDATE problems
            SET constraints = '["n == nums.length","1 <= n <= 5 * 10^4","-10^9 <= nums[i] <= 10^9","A majority element is guaranteed to always exist in the array.","Time Complexity Target: O(n)","Space Complexity Target: O(1) auxiliary space"]',
                description = '<p>Given an array <code>nums</code> of size <code>n</code>, return the <strong>majority element</strong>.</p><p>The <strong>majority element</strong> is the element that appears strictly more than <code>⌊n / 2⌋</code> times (meaning strictly more than half of the total elements in the array, where <code>⌊x⌋</code> represents integer floor division rounding down). You may assume that the majority element always exists in the array.</p><p class="mt-3 text-xs text-zinc-400"><strong>Follow-up:</strong> Could you design a solution that runs in linear <code>O(n)</code> time and <code>O(1)</code> auxiliary space (Boyer-Moore Voting Algorithm)?</p>'
            WHERE title ILIKE '%Majority Element%' AND (constraints IS NULL OR constraints = '' OR constraints = 'null');
        `);
    } catch (e) {
        console.warn('[DB] Problem constraints check warning:', e.message);
    }

    console.log('[DB] Schema initialized successfully with AI Module extensions.');
}

module.exports = { query, initDB, pool };
