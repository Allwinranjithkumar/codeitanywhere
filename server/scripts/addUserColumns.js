const db = require('../db');

async function addUserColumns() {
    try {
        console.log('🔄 Adding new columns to users table...\n');

        // Add batch_year column if it doesn't exist
        try {
            await db.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS batch_year VARCHAR(10)
            `);
            console.log('✅ Added batch_year column');
        } catch (err) {
            console.log('⚠️  batch_year column may already exist:', err.message);
        }

        // Add department column if it doesn't exist
        try {
            await db.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS department VARCHAR(50)
            `);
            console.log('✅ Added department column');
        } catch (err) {
            console.log('⚠️  department column may already exist:', err.message);
        }

        // Add class_name column if it doesn't exist
        try {
            await db.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS class_name VARCHAR(50)
            `);
            console.log('✅ Added class_name column');
        } catch (err) {
            console.log('⚠️  class_name column may already exist:', err.message);
        }

        console.log('\n✅ Migration complete!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await db.pool.end();
    }
}

// Run the migration
addUserColumns()
    .then(() => {
        console.log('🎉 Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
