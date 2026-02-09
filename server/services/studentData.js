const xlsx = require('xlsx');
const path = require('path');

const EXCEL_PATH = path.join(__dirname, '..', '..', 'data', 'allowed_users.xlsx');

let studentMap = new Map();

function loadStudentData() {
    try {
        const workbook = xlsx.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        data.forEach(row => {
            const email = row['Official Email'] ? row['Official Email'].trim().toLowerCase() : null;
            if (email) {
                studentMap.set(email, {
                    name: `${row['First_Name']} ${row['Last_Name']}`,
                    reg_no: row['Roll_No'], // This is actually Register Number in the sheet
                    department: row['Department']
                });
            }
        });

        console.log(`✅ Loaded ${studentMap.size} students from Excel`);
    } catch (error) {
        console.error('❌ Failed to load Excel data:', error.message);
    }
}

function getStudentByEmail(email) {
    if (!email) return null;
    return studentMap.get(email.toLowerCase());
}

// Load on startup
loadStudentData();

module.exports = {
    getStudentByEmail,
    loadStudentData
};
