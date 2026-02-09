const xlsx = require('xlsx');
const path = require('path');
const db = require('./db');
const fs = require('fs');
const bcrypt = require('bcrypt');

const EXCEL_PATH = path.join(__dirname, '..', 'data', 'allowed_users.xlsx');
const DEFAULT_USER_PASSWORD = 'student123'; // Default password for Excel users

async function syncAllowedUsers() {
    try {
        if (!fs.existsSync(EXCEL_PATH)) {
            console.error('Excel file not found at:', EXCEL_PATH);
            return;
        }

        const workbook = xlsx.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        console.log(`Using Excel Data. Found ${data.length} records.`);

        // Populate allowed_users table (optional, but good for reference)
        // More importantly, populate USERS table so they can login

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(DEFAULT_USER_PASSWORD, salt);

        let successCount = 0;
        let failCount = 0;

        for (const row of data) {
            const email = row['Official Email'] ? row['Official Email'].trim().toLowerCase() : null;
            const regNo = row['Roll_No'] ? String(row['Roll_No']).trim() : null;
            const name = `${row['First_Name']} ${row['Last_Name']}`;

            if (!email || !regNo) {
                continue;
            }

            try {
                // Check if user exists
                const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);

                if (existing.rowCount === 0) {
                    // Insert new user
                    await db.query(
                        `INSERT INTO users (name, email, reg_no, password_hash, role) 
                         VALUES ($1, $2, $3, $4, 'student')`,
                        [name, email, regNo, hashedPassword]
                    );
                    successCount++;
                }
            } catch (err) {
                // console.error(`Failed to sync user ${email}:`, err.message);
                failCount++;
            }
        }

        console.log(`✅ Excel Sync Complete: ${successCount} new users added. ${failCount} skipped/duplicates.`);

    } catch (error) {
        console.error('Error syncing Excel file:', error);
    }
}

module.exports = syncAllowedUsers;
