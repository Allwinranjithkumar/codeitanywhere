const xlsx = require('xlsx');
const path = require('path');
const db = require('./db');
const fs = require('fs');
const bcrypt = require('bcrypt');

const EXCEL_PATH = path.join(__dirname, '..', 'data', 'allowed_users.xlsx');
const DEFAULT_USER_PASSWORD = 'student123'; // Default password for Excel users

/**
 * Parse registration number to extract batch year and department
 * Examples:
 * - 715523105001 -> 23 (year) + 1050 (dept code) -> 23 EEE
 * - 715524105001 -> 24 (year) + 1050 (dept code) -> 24 EEE
 * - 715524112001 -> 24 (year) + 1120 (dept code) -> 24 ICE
 * - 715523105301 -> 23 (year) + 1053 (dept code) -> 23 EEE
 * Special cases based on email:
 * - t25e* -> 24 EEE
 * - t25u* -> 24 ICE
 */
function parseRegNumber(regNo, email = '') {
    const regStr = String(regNo);

    // Special handling for email-based patterns
    if (email) {
        const emailLower = email.toLowerCase();
        // t25e -> 24 EEE
        if (emailLower.includes('t25e')) {
            return {
                batchYear: '2024',
                department: 'EEE',
                className: '24 EEE'
            };
        }
        // t25u -> 24 ICE
        if (emailLower.includes('t25u')) {
            return {
                batchYear: '2024',
                department: 'ICE',
                className: '24 ICE'
            };
        }
    }

    // Extract year (positions 4-5)
    const year = regStr.substring(4, 6); // "23" or "24"

    // Extract department code (positions 6-9)
    const deptCode = regStr.substring(6, 10); // "1050", "1053", "1120", etc.

    // Map department codes to department names
    const deptMap = {
        '1050': 'EEE',
        '1053': 'EEE',  // Additional EEE code
        '1120': 'ICE',
        // Add more department codes as needed
    };

    const department = deptMap[deptCode] || 'Unknown';
    const className = `${year} ${department}`; // e.g., "23 EEE" or "24 ICE"

    return {
        batchYear: `20${year}`, // Convert "23" to "2023"
        department: department,
        className: className
    };
}

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

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(DEFAULT_USER_PASSWORD, salt);

        let successCount = 0;
        let failCount = 0;

        for (const row of data) {
            const email = row['Official Email'] ? row['Official Email'].trim().toLowerCase() : null;
            const regNo = row['Roll_No'] ? String(row['Roll_No']).trim() : null;
            const firstName = row['First_Name'] ? String(row['First_Name']).trim() : '';
            const lastName = row['Last_Name'] ? String(row['Last_Name']).trim() : '';
            const name = `${firstName} ${lastName}`.trim();

            if (!email || !regNo || !name) {
                continue;
            }

            // Parse registration number to get batch and department
            const { batchYear, department, className } = parseRegNumber(regNo, email);

            try {
                // Check if user exists
                const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);

                if (existing.rowCount === 0) {
                    // Insert new user with batch and department info
                    await db.query(
                        `INSERT INTO users (name, email, reg_no, password_hash, role, batch_year, department, class_name) 
                         VALUES ($1, $2, $3, $4, 'student', $5, $6, $7)`,
                        [name, email, regNo, hashedPassword, batchYear, department, className]
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

