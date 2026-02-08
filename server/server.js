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
app.use(bodyParser.json());
app.use(express.static('public'));

// Routes
app.use('/api', authRoutes);
app.use('/api/judge', judgeRoutes);
app.use('/api/admin', adminRoutes);

// Helper for re-syncing Excel manually
app.post('/api/admin/sync-excel', async (req, res) => {
    try {
        await syncExcel();
        res.json({ success: true, message: 'Excel sync triggered' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server
async function startServer() {
    await db.initDB();
    await syncExcel();
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
