/**
 * resetDB.js — Drop ALL existing tables and recreate the full schema from scratch.
 *
 * Run this ONCE to reset the database:
 *   node server/scripts/resetDB.js
 *
 * WARNING: This deletes ALL data permanently.
 */

require('dotenv').config();
const { Pool } = require('pg');

let poolConfig;
if (process.env.DATABASE_URL) {
    poolConfig = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
} else {
    poolConfig = {
        user:     process.env.DB_USER     || 'postgres',
        host:     process.env.DB_HOST     || 'localhost',
        database: process.env.DB_NAME     || 'coding_platform',
        password: process.env.DB_PASSWORD || '',
        port:     parseInt(process.env.DB_PORT) || 5432
    };
}

const pool = new Pool(poolConfig);

async function resetDB() {
    const client = await pool.connect();
    try {
        console.log('🗑️  Dropping all existing tables...');

        await client.query(`
            DROP TABLE IF EXISTS
                violations,
                submissions,
                contest_participants,
                contest_problems,
                starter_code,
                test_cases,
                problems,
                contests,
                users,
                allowed_users
            CASCADE;
        `);
        console.log('✅ All old tables dropped.');

        console.log('🏗️  Creating fresh schema...');

        await client.query(`
            -- Users
            CREATE TABLE users (
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

            -- Contests
            CREATE TABLE contests (
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

            -- Problems
            CREATE TABLE problems (
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

            -- Test Cases
            CREATE TABLE test_cases (
                id          SERIAL PRIMARY KEY,
                problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
                input_data  JSONB NOT NULL,
                output_data JSONB NOT NULL,
                is_sample   BOOLEAN NOT NULL DEFAULT FALSE,
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- Starter Code per language
            CREATE TABLE starter_code (
                id         SERIAL PRIMARY KEY,
                problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
                language   VARCHAR(20) NOT NULL,
                code       TEXT NOT NULL,
                UNIQUE(problem_id, language)
            );

            -- Contest ↔ Problem mapping
            CREATE TABLE contest_problems (
                contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
                problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
                order_index INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (contest_id, problem_id)
            );

            -- Contest Participants
            CREATE TABLE contest_participants (
                contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                joined_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (contest_id, user_id)
            );

            -- Submissions (full history)
            CREATE TABLE submissions (
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

            -- Violations
            CREATE TABLE violations (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                contest_id  INTEGER REFERENCES contests(id) ON DELETE SET NULL,
                type        VARCHAR(100) NOT NULL,
                metadata    JSONB,
                occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- Indexes
            CREATE INDEX idx_submissions_user_id    ON submissions(user_id);
            CREATE INDEX idx_submissions_contest_id  ON submissions(contest_id);
            CREATE INDEX idx_submissions_problem_id  ON submissions(problem_id);
            CREATE INDEX idx_violations_user_id      ON violations(user_id);
            CREATE INDEX idx_violations_contest_id   ON violations(contest_id);
            CREATE INDEX idx_test_cases_problem_id   ON test_cases(problem_id);
            CREATE INDEX idx_problems_is_active      ON problems(is_active);
            CREATE INDEX idx_contests_status         ON contests(status);
        `);

        console.log('✅ Fresh schema created successfully.');
        console.log('');
        console.log('Tables created:');
        console.log('  users, contests, problems, test_cases, starter_code');
        console.log('  contest_problems, contest_participants, submissions, violations');
        console.log('');
        console.log('Next steps:');
        console.log('  1. Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env');
        console.log('  2. Run: npm start  (admin + problems migrated automatically)');

    } catch (err) {
        console.error('❌ Reset failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

resetDB();
