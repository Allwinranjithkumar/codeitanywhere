// const xlsx = require('xlsx');
const path = require('path');
// const db = require('./db');
const fs = require('fs');
// const bcrypt = require('bcrypt');

const EXCEL_PATH = path.join(__dirname, '..', 'data', 'allowed_users.xlsx');
const DEFAULT_USER_PASSWORD = 'student123'; // Default password for Excel users

async function syncAllowedUsers() {
    console.log('Skipping Excel Sync (Cloud Mode)');
    return;
    /*
    try {
        if (!fs.existsSync(EXCEL_PATH)) {
            console.error('Excel file not found at:', EXCEL_PATH);
            return;
        }

        const workbook = xlsx.readFile(EXCEL_PATH);
        // ... (rest commented out)
    } catch (error) {
        console.error('Error syncing Excel file:', error);
    }
    */
}

module.exports = syncAllowedUsers;
