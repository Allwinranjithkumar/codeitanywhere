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

        console.log(`Found ${data.length} entries in Excel file.`);

        let insertedCount = 0;
        let createdUsersCount = 0;
        let errorCount = 0;

        // Hash Default Password
        const defaultHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);

        for (const row of data) {
            // Map columns correctly based on JSON output
            // "First_Name":"AISHWARYA ","Last_Name":"C","Roll_No":715523105001,"Official Email":"23e101@psgitech.ac.in"

            const firstName = row['First_Name'] || '';
            const lastName = row['Last_Name'] || '';
            const email = (row['Official Email'] || row['Email'] || '').trim();
            const regNo = String(row['Roll_No'] || row['RegisterNumber'] || row['reg_no'] || '').trim();
            const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

            if (email && regNo) {
                try {
                    // 1. Whitelist the user
                    await db.query(
                        'INSERT INTO allowed_users (email, reg_no) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
                        [email, regNo]
                    );

                    // 2. Auto-Create User Account (so they can login immediately)
                    // If user exists, do nothing (preserve their password).
                    // If user does not exist, insert with default password.

                    const userResult = await db.query(
                        `INSERT INTO users (name, email, reg_no, password_hash) 
                         VALUES ($1, $2, $3, $4) 
                         ON CONFLICT (email) DO NOTHING
                         RETURNING id`,
                        [fullName, email, regNo, defaultHash]
                    );

                    if (userResult.rowCount > 0) {
                        createdUsersCount++;
                    }
                    insertedCount++;
                } catch (err) {
                    // console.warn(`Skipping duplicate or error for ${email}: ${err.message}`);
                    errorCount++;
                }
            }
        }

        console.log(`Synced allowed users. Whitelisted: ${insertedCount}, Auto-Created Accounts: ${createdUsersCount}, Errors: ${errorCount}`);

    } catch (error) {
        console.error('Error syncing Excel file:', error);
    }
}

module.exports = syncAllowedUsers;
