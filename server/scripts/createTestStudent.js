import pool from '../db.js';
import bcrypt from 'bcrypt';

async function createTestStudent() {
  try {
    const email = 'student@codeitanywhere.com';
    const password = 'Student@1234';
    const name = 'Student Tester';
    const regNo = '715523105001';
    const role = 'student';

    const hashedPassword = await bcrypt.hash(password, 10);

    const res = await pool.query(
      `INSERT INTO users (name, email, password_hash, reg_no, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE 
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           reg_no = EXCLUDED.reg_no,
           role = EXCLUDED.role
       RETURNING id, name, email, reg_no, role;`,
      [name, email, hashedPassword, regNo, role]
    );

    console.log('✅ Student test account created/updated successfully:');
    console.log(res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to create test student:', err);
    process.exit(1);
  }
}

createTestStudent();
