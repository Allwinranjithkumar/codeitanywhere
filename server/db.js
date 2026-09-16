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
            reg_no        VARCHAR(50)  UNIQUE NOT NULL,
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
            anti_cheat       BOOLEAN NOT NULL DEFAULT TRUE,
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

    // ── Indexes ──────────────────────────────
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_user_id    ON submissions(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_contest_id  ON submissions(contest_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_submissions_problem_id  ON submissions(problem_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_violations_user_id      ON violations(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_violations_contest_id   ON violations(contest_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_test_cases_problem_id   ON test_cases(problem_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_problems_is_active      ON problems(is_active);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_contests_status         ON contests(status);`);

    console.log('[DB] Schema initialized successfully.');
}

module.exports = { query, initDB, pool };
