const xlsx = require('xlsx');
const path = require('path');
const db = require('../db');
const fs = require('fs');
const bcrypt = require('bcrypt');

const DEFAULT_PASSWORD = 'student123';

// Excel files to process
const EXCEL_FILES = [
    {
        path: path.join(__dirname, '..', '..', 'data', 'allowed_users.xlsx'),
        description: 'EEE 2023 Batch'
    },
    {
        path: path.join(__dirname, '..', '..', '1 - PAT Portal Details Format (2).xlsx'),
        description: 'EEE 2024 Batch (Regular + Lateral)'
    },
    {
        path: path.join(__dirname, '..', '..', '92af7985-346f-4dcf-9fa7-cf090d021a8a.xlsx'),
        description: 'ICE 2024 Batch'
    }
];

/**
 * Parse registration number to extract batch year and department
 */
function parseRegNumber(regNo, email = '', department = '') {
    const regStr = String(regNo);

    // PRIORITY 1: Parse from registration number structure first (most reliable)
    if (regStr.length >= 10 && regStr.match(/^\d+$/)) {
        const year = regStr.substring(4, 6); // "23" or "24"
        const deptCode = regStr.substring(6, 10); // "1050", "1053", "1120", etc.

        // Map department codes to department names
        const deptMap = {
            '1050': 'EEE',
            '1053': 'EEE',  // Additional EEE code (lateral entries)
            '1120': 'ICE',
        };

        const dept = deptMap[deptCode];
        if (dept) {
            return {
                batchYear: `20${year}`,
                department: dept,
                className: `${year} ${dept}`
            };
        }
    }

    // PRIORITY 2: Email-based patterns (for T25E, T25U format roll numbers)
    if (email) {
        const emailLower = email.toLowerCase();

        // Lateral entries with T25E/T25U format
        // 25u601@psgitech.ac.in -> 24 ICE (lateral entry)
        if (emailLower.includes('25u')) {
            return {
                batchYear: '2024',
                department: 'ICE',
                className: '24 ICE'
            };
        }
        // 25e601@psgitech.ac.in -> 24 EEE (lateral entry)
        if (emailLower.includes('25e')) {
            return {
                batchYear: '2024',
                department: 'EEE',
                className: '24 EEE'
            };
        }

        // Regular entries
        // t25u or 24u -> 24 ICE
        if (emailLower.includes('t25u') || emailLower.includes('24u')) {
            return {
                batchYear: '2024',
                department: 'ICE',
                className: '24 ICE'
            };
        }
        // t25e or 24e -> 24 EEE (but this will be overridden by reg number if it says 23)
        if (emailLower.includes('t25e') || emailLower.includes('24e')) {
            return {
                batchYear: '2024',
                department: 'EEE',
                className: '24 EEE'
            };
        }
        // 23e -> 23 EEE
        if (emailLower.includes('23e')) {
            return {
                batchYear: '2023',
                department: 'EEE',
                className: '23 EEE'
            };
        }
    }

    // PRIORITY 3: Parse from department field if available
    if (department) {
        const deptLower = department.toLowerCase();
        let deptCode = 'Unknown';

        if (deptLower.includes('electrical') || deptLower.includes('eee')) {
            deptCode = 'EEE';
        } else if (deptLower.includes('instrumentation') || deptLower.includes('ice') || deptLower.includes('control')) {
            deptCode = 'ICE';
        } else if (deptLower.includes('mechanical')) {
            deptCode = 'MECH';
        } else if (deptLower.includes('civil')) {
            deptCode = 'CIVIL';
        } else if (deptLower.includes('computer')) {
            deptCode = 'CSE';
        }

        // Try to extract year from roll number
        if (regStr.length >= 6) {
            const year = regStr.substring(4, 6);
            return {
                batchYear: `20${year}`,
                department: deptCode,
                className: `${year} ${deptCode}`
            };
        }
    }

    return {
        batchYear: 'Unknown',
        department: 'Unknown',
        className: 'Unknown'
    };
}

async function importAllExcelFiles() {
    try {
        console.log('🔄 Starting multi-file Excel import...\n');

        // Step 1: Delete all users except admin (with related data)
        console.log('🗑️  Deleting existing user data...');

        const deleteSubmissions = await db.query(
            `DELETE FROM submissions WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')`
        );
        console.log(`   - Deleted ${deleteSubmissions.rowCount} submissions`);

        const deleteViolations = await db.query(
            `DELETE FROM violations WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')`
        );
        console.log(`   - Deleted ${deleteViolations.rowCount} violations`);

        const deleteResult = await db.query(
            `DELETE FROM users WHERE role != 'admin'`
        );
        console.log(`✅ Deleted ${deleteResult.rowCount} existing users\n`);

        // Step 2: Hash the default password once
        console.log('🔐 Generating password hash...');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, salt);
        console.log('✅ Password hash generated\n');

        // Step 3: Process each Excel file
        let totalSuccess = 0;
        let totalFail = 0;
        const classSummary = {};

        for (const fileConfig of EXCEL_FILES) {
            console.log('📁 Processing:', fileConfig.description);
            console.log('   Path:', fileConfig.path);

            if (!fs.existsSync(fileConfig.path)) {
                console.log('   ⚠️  File not found, skipping...\n');
                continue;
            }

            const workbook = xlsx.readFile(fileConfig.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet);

            console.log(`   📊 Found ${data.length} records\n`);

            let fileSuccess = 0;
            let fileFail = 0;

            for (const row of data) {
                try {
                    const email = row['Official Email'] ? row['Official Email'].trim().toLowerCase() : null;
                    const regNo = row['Roll_No'] ? String(row['Roll_No']).trim() : null;
                    const firstName = row['First_Name'] ? String(row['First_Name']).trim() : '';
                    const lastName = row['Last_Name'] ? String(row['Last_Name']).trim() : '';
                    const name = `${firstName} ${lastName}`.trim();
                    const department = row['Department'] || '';

                    if (!email || !regNo || !name) {
                        console.log(`   ⚠️  Skipping incomplete record: ${email || regNo || 'unknown'}`);
                        fileFail++;
                        continue;
                    }

                    // Skip demo/test accounts
                    if (email.includes('demo@') || regNo === '123456') {
                        console.log(`   ⏭️  Skipping demo account: ${email}`);
                        fileFail++;
                        continue;
                    }

                    // Parse registration number to get batch and department
                    const { batchYear, department: dept, className } = parseRegNumber(regNo, email, department);

                    if (dept === 'Unknown') {
                        console.log(`   ⚠️  Unknown department for ${regNo} - ${email}`);
                    }

                    // Insert user
                    await db.query(
                        `INSERT INTO users (name, email, reg_no, password_hash, role, batch_year, department, class_name) 
                         VALUES ($1, $2, $3, $4, 'student', $5, $6, $7)`,
                        [name, email, regNo, hashedPassword, batchYear, dept, className]
                    );

                    console.log(`   ✅ Created: ${email} | ${className} | ${name}`);
                    fileSuccess++;

                    // Track class summary
                    classSummary[className] = (classSummary[className] || 0) + 1;

                } catch (err) {
                    if (err.code === '23505') { // Duplicate key
                        console.log(`   ⏭️  Skipping duplicate: ${row['Official Email']}`);
                    } else {
                        console.error(`   ❌ Failed to create user ${row['Official Email']}: ${err.message}`);
                    }
                    fileFail++;
                }
            }

            console.log(`\n   📊 File Summary: ${fileSuccess} created, ${fileFail} skipped\n`);
            totalSuccess += fileSuccess;
            totalFail += fileFail;
        }

        // Step 4: Final Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 IMPORT SUMMARY');
        console.log('='.repeat(60));
        console.log(`✅ Successfully created: ${totalSuccess} users`);
        console.log(`❌ Failed/Skipped: ${totalFail} users`);
        console.log(`📧 Default password: ${DEFAULT_PASSWORD}`);
        console.log(`🔑 Username: email address`);
        console.log('='.repeat(60));

        console.log('\n📚 Users by Class:');
        Object.entries(classSummary).sort().forEach(([className, count]) => {
            console.log(`   ${className}: ${count} students`);
        });

        console.log('\n='.repeat(60) + '\n');
        console.log('✅ Import complete!\n');

    } catch (error) {
        console.error('❌ Error during import:', error);
        throw error;
    } finally {
        await db.pool.end();
    }
}

// Run the script
importAllExcelFiles()
    .then(() => {
        console.log('🎉 Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
