const db = require('../db');

async function runMigration() {
    try {
        console.log('Running migration: Adding user classification columns...');

        // Add batch_year
        try {
            await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS batch_year VARCHAR(10);`);
            console.log('Added batch_year column.');
        } catch (e) {
            console.log('batch_year column might already exist or error:', e.message);
        }

        // Add department
        try {
            await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(50);`);
            console.log('Added department column.');
        } catch (e) {
            console.log('department column might already exist or error:', e.message);
        }

        // Add class_name
        try {
            await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(50);`);
            console.log('Added class_name column.');
        } catch (e) {
            console.log('class_name column might already exist or error:', e.message);
        }

        console.log('Migration completed successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
