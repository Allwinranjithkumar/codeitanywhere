/**
 * server.js — Application entry point
 *
 * Architecture:
 *   Browser → Express API → PostgreSQL
 *   Browser → Express API → Judge → child_process → PostgreSQL
 *
 * PostgreSQL is the ONLY data store.
 * If the database is unavailable on startup, the server does NOT start.
 * In production, all errors return appropriate HTTP status codes —
 * no stack traces, no internal details are exposed to clients.
 */

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const db         = require('./db');
const authRoutes    = require('./routes/auth.routes');
const judgeRoutes   = require('./routes/judge.routes');
const adminRoutes   = require('./routes/admin.routes');
const contestRoutes = require('./routes/contest.routes');

// ──────────────────────────────────────────────
// Startup Validation
// ──────────────────────────────────────────────

if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    console.error('Set JWT_SECRET in your .env file. Generate one with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────

app.use('/api',          authRoutes);     // POST /api/login, POST /api/register
app.use('/api/contests', contestRoutes);  // /api/contests/*
app.use('/api/judge',    judgeRoutes);    // /api/judge/problems, /api/judge/run, /api/judge/submit
app.use('/api/admin',    adminRoutes);    // /api/admin/*

// ──────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint not found.' });
    }
    // For SPA-style routing, serve index
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ──────────────────────────────────────────────
// Centralized Error Handler
// ──────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    // Log full error server-side
    console.error(`[Error] ${req.method} ${req.path}:`, err.message);
    if (!isProd) console.error(err.stack);

    // Never expose stack traces or internal details in production
    const statusCode = err.statusCode || 500;

    if (isProd) {
        return res.status(statusCode).json({ error: statusCode < 500 ? err.message : 'Internal server error.' });
    }
    // In development, include error details
    return res.status(statusCode).json({ error: err.message });
});

// ──────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────

async function startServer() {
    // 1. Connect to database and initialize schema
    try {
        await db.initDB();
    } catch (err) {
        console.error('FATAL: Could not initialize database.', err.message);
        console.error('Ensure PostgreSQL is running and DATABASE_URL (or DB_* vars) are set correctly.');
        process.exit(1);
    }

    // 2. Seed admin user from environment variables
    try {
        const seedAdmin = require('./services/seedAdmin');
        await seedAdmin();
    } catch (err) {
        console.warn('[Startup] Admin seed failed (non-fatal):', err.message);
    }

    // 3. Migrate existing problems.json → PostgreSQL (one-time, skips duplicates)
    try {
        const problemsJsonPath = path.join(__dirname, '..', 'problems', 'problems.json');
        const fs = require('fs');
        if (fs.existsSync(problemsJsonPath)) {
            const problemService = require('./services/problemService');
            const raw = fs.readFileSync(problemsJsonPath, 'utf-8');
            const jsonProblems = JSON.parse(raw);
            if (jsonProblems.length > 0) {
                const created = await problemService.migrateFromJson(jsonProblems);
                if (created > 0) {
                    console.log(`[Startup] Migrated ${created} problems from problems.json to PostgreSQL.`);
                }
            }
        }
    } catch (err) {
        console.warn('[Startup] problems.json migration failed (non-fatal):', err.message);
    }

    // 4. Start listening
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════╗
║           CodeItAnywhere — Server Started            ║
╠══════════════════════════════════════════════════════╣
║  URL:      http://localhost:${PORT}                      ║
║  Mode:     ${isProd ? 'PRODUCTION' : 'development'}                           ║
║  Database: PostgreSQL (single source of truth)       ║
╚══════════════════════════════════════════════════════╝
        `);
    });
}

startServer();
