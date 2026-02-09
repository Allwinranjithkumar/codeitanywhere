const db = require('../db');

async function testExport() {
    try {
        await db.initDB();

        console.log('='.repeat(70));
        console.log('📊 TESTING EXPORT QUERIES');
        console.log('='.repeat(70));

        // Test 1: Get all students
        console.log('\n1️⃣ ALL STUDENTS:');
        const allStudents = await db.query(`
            SELECT class_name, COUNT(*) as count
            FROM users 
            WHERE role = 'student'
            GROUP BY class_name
            ORDER BY class_name
        `);
        console.log(allStudents.rows);

        // Test 2: Sample students from each class
        console.log('\n2️⃣ SAMPLE STUDENTS:');
        const samples = await db.query(`
            SELECT name, email, reg_no, batch_year, department, class_name
            FROM users
            WHERE role = 'student'
            ORDER BY class_name, reg_no
            LIMIT 5
        `);
        console.table(samples.rows);

        // Test 3: Try filtering by class "23 EEE"
        console.log('\n3️⃣ FILTER TEST: class_name = "23 EEE"');
        const test23EEE = await db.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE role = 'student' AND class_name = $1
        `, ['23 EEE']);
        console.log(`Found: ${test23EEE.rows[0].count} students`);

        // Test 4: Try filtering by batch "2023"
        console.log('\n4️⃣ FILTER TEST: batch_year = "2023"');
        const test2023 = await db.query(`
            SELECT COUNT(*) as count, class_name
            FROM users
            WHERE role = 'student' AND batch_year = $1
            GROUP BY class_name
        `, ['2023']);
        console.log(test2023.rows);

        // Test 5: Try filtering by department "EEE"
        console.log('\n5️⃣ FILTER TEST: department = "EEE"');
        const testEEE = await db.query(`
            SELECT COUNT(*) as count, class_name
            FROM users
            WHERE role = 'student' AND department = $1
            GROUP BY class_name
            ORDER BY class_name
        `, ['EEE']);
        console.log(testEEE.rows);

        // Test 6: Try combined filters
        console.log('\n6️⃣ FILTER TEST: batch=2023, dept=EEE, class="23 EEE"');
        const combined = await db.query(`
            SELECT COUNT(*) as count
            FROM users
            WHERE role = 'student' 
              AND batch_year = $1 
              AND department = $2 
              AND class_name = $3
        `, ['2023', 'EEE', '23 EEE']);
        console.log(`Found: ${combined.rows[0].count} students`);

        console.log('\n' + '='.repeat(70));
        console.log('✅ Tests complete!');
        console.log('='.repeat(70) + '\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await db.pool.end();
    }
}

testExport();
