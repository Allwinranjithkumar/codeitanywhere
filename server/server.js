const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const syncExcel = require('./syncExcel');
const problemService = require('./services/problemService');
const authRoutes = require('./routes/auth.routes');
const judgeRoutes = require('./routes/judge.routes');
const adminRoutes = require('./routes/admin.routes');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Routes (Advanced Features)
app.use('/api', authRoutes); // /api/login, /api/register
app.use('/api/judge', judgeRoutes); // /api/judge/problems, /api/judge/run
app.use('/api/admin', adminRoutes); // /api/admin/violations

// Note: Legacy routes (/api/register, /api/problems etc) have been removed 
// to avoid conflicts with the new router structure.
// All logic is now handled by the routers above.

// Start Server
async function startServer() {
    try {
        await db.initDB();
        console.log('Database connected!');

        // Seed Admin User
        const seedAdmin = require('./services/seedAdmin');
        await seedAdmin();

    } catch (e) {
        console.warn('WARNING: Database connection failed. Running in partial mode (No Persistence).');
        console.error(e.message);
    }

    try {
        const syncExcel = require('./syncExcel');
        await syncExcel();
    } catch (e) {
        console.warn('WARNING: Excel sync failed.');
    }

    console.log('Starting server...');
    await problemService.loadProblems();

    app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════╗
║   Coding Contest Platform Running!        ║
╚═══════════════════════════════════════════╝

Server: http://localhost:${PORT}
`);
    });
}

startServer();
