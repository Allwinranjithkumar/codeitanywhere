const express = require('express');
const bodyParser = require('body-parser');
const { VM } = require('vm2');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// In-memory storage
const students = new Map();
const submissions = new Map();
const violations = new Map();

// Load problems
let problems = [];

async function loadProblems() {
    try {
        const data = await fs.readFile(path.join(__dirname, '..', 'problems', 'problems.json'), 'utf-8');
        problems = JSON.parse(data);
        console.log(`Loaded ${problems.length} problems`);
    } catch (error) {
        console.error('Error loading problems:', error);
    }
}

// Execute Python function
function executePythonFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        const tempFile = `temp_${Date.now()}.py`;

        // Build test code
        const args = Object.values(testCase.input).map(val => JSON.stringify(val)).join(', ');
        const testCode = `
import json
${code}

# Call function and print result
result = ${functionName}(${args})
print(json.dumps(result))
`;

        fs.writeFile(tempFile, testCode, 'utf-8')
            .then(() => {
                exec(`python3 ${tempFile}`, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    fs.unlink(tempFile).catch(() => { });

                    if (error) {
                        if (error.killed) {
                            reject(new Error('Time Limit Exceeded'));
                        } else {
                            reject(new Error(stderr || error.message));
                        }
                    } else {
                        try {
                            const result = JSON.parse(stdout.trim());
                            resolve(result);
                        } catch (e) {
                            reject(new Error('Invalid output format'));
                        }
                    }
                });
            })
            .catch(reject);
    });
}

// Execute JavaScript function
function executeJavaScriptFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        try {
            const vm = new VM({
                timeout: 5000,
                sandbox: {}
            });

            // Run the code and call the function
            const result = vm.run(`
                ${code}
                ${functionName}(${Object.values(testCase.input).map(v => JSON.stringify(v)).join(', ')})
            `);

            resolve(result);
        } catch (error) {
            reject(error);
        }
    });
}

// Execute Java function
function executeJavaFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        const tempFile = `Solution_${Date.now()}`;

        // Build test wrapper
        const params = Object.keys(testCase.input);
        const args = Object.values(testCase.input).map((val, i) => {
            if (Array.isArray(val)) {
                if (typeof val[0] === 'number') {
                    return `new int[]{${val.join(',')}}`;
                } else if (typeof val[0] === 'string') {
                    return `new String[]{${val.map(s => `"${s}"`).join(',')}}`;
                }
            } else if (typeof val === 'number') {
                return val.toString();
            } else if (typeof val === 'string') {
                return `"${val}"`;
            } else if (typeof val === 'boolean') {
                return val.toString();
            }
            return val;
        }).join(', ');

        const testCode = `
import com.google.gson.Gson;

${code}

public class TestRunner {
    public static void main(String[] args) {
        Solution solution = new Solution();
        Object result = solution.${functionName}(${args});
        Gson gson = new Gson();
        System.out.println(gson.toJson(result));
    }
}
`;

        fs.writeFile(`${tempFile}.java`, testCode, 'utf-8')
            .then(() => {
                exec(`javac ${tempFile}.java && java TestRunner`, {
                    timeout: 10000,
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    fs.unlink(`${tempFile}.java`).catch(() => { });
                    fs.unlink('TestRunner.class').catch(() => { });
                    fs.unlink('Solution.class').catch(() => { });

                    if (error) {
                        reject(new Error(stderr || error.message));
                    } else {
                        try {
                            const result = JSON.parse(stdout.trim());
                            resolve(result);
                        } catch (e) {
                            reject(new Error('Invalid output format'));
                        }
                    }
                });
            })
            .catch(reject);
    });
}

// Execute C++ function
function executeCppFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        const tempFile = `Solution_${Date.now()}`;

        // Dynamically build argument declarations and calling signature
        const declarations = [];
        const funcArgs = [];

        for (const [key, value] of Object.entries(testCase.input)) {
            if (Array.isArray(value)) {
                // Assume vector<int> for simplicity in this contest scope
                declarations.push(`vector<int> ${key} = {${value.join(',')}};`);
                funcArgs.push(key);
            } else if (typeof value === 'string') {
                declarations.push(`string ${key} = "${value}";`);
                funcArgs.push(key);
            } else if (typeof value === 'number') {
                declarations.push(`int ${key} = ${value};`);
                funcArgs.push(key);
            } else if (typeof value === 'boolean') {
                declarations.push(`bool ${key} = ${value};`);
                funcArgs.push(key);
            }
        }

        const testCode = `
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <sstream>

using namespace std;

// Helper for printing vectors
template <typename T>
ostream& operator<<(ostream& os, const vector<T>& v) {
    os << "[";
    for (size_t i = 0; i < v.size(); ++i) {
        os << v[i];
        if (i != v.size() - 1) os << ",";
    }
    os << "]";
    return os;
}

${code}

int main() {
    Solution solution;
    
    // Prepare arguments
    ${declarations.join('\n    ')}
    
    // Call function
    auto result = solution.${functionName}(${funcArgs.join(', ')});
    
    // Print result (cout supports basic types, vectors might need helper)
    // For this context, we'll assume basic return types or simple vectors
    // To be safe for vector returns (like TwoSum), we need an overload or helper, 
    // but the node side expects simpler stdout.
    // Let's rely on basic cout for now. If result is vector, this might fail to compile operator<<.
    // We can add a simple helper for vector printing if needed.
    
    cout << result << endl;
    
    return 0;
}
`;
        // Note: If return type is vector, cout << result will fail without an operator<< overload.
        // Let's add a quick helper for that just in case (for TwoSum).


        fs.writeFile(`${tempFile}.cpp`, testCode, 'utf-8')
            .then(() => {
                // Compile and run case-insensitive (Windows handles exe automatically, but let's be explicit)
                // Using .\\ for safest windows execution path if needed, or just filename if in cwd
                const runCmd = process.platform === 'win32' ? `${tempFile}.exe` : `./${tempFile}`;
                exec(`g++ -o ${tempFile} ${tempFile}.cpp && ${runCmd}`, {
                    timeout: 10000,
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    // Cleanup
                    fs.unlink(`${tempFile}.cpp`).catch(() => { });
                    fs.unlink(`${tempFile}`).catch(() => { }); // Linux/Mac
                    fs.unlink(`${tempFile}.exe`).catch(() => { }); // Windows

                    if (error) {
                        // Check if it's a compilation error or runtime error
                        reject(new Error(stderr || error.message));
                    } else {
                        try {
                            const result = parseInt(stdout.trim());
                            resolve(result);
                        } catch (e) {
                            reject(new Error('Invalid output format'));
                        }
                    }
                });
            })
            .catch(reject);
    });
}

// Execute code based on language
async function executeCode(code, language, functionName, testCase) {
    switch (language) {
        case 'python':
            return await executePythonFunction(code, functionName, testCase);
        case 'javascript':
            return await executeJavaScriptFunction(code, functionName, testCase);
        case 'java':
            return await executeJavaFunction(code, functionName, testCase);
        case 'cpp':
            return await executeCppFunction(code, functionName, testCase);
        default:
            throw new Error('Unsupported language');
    }
}

// Deep comparison of arrays/objects
function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (let key of keysA) {
            if (!deepEqual(a[key], b[key])) return false;
        }
        return true;
    }
    return false;
}

// Test code against test cases
async function testCode(code, language, functionName, testCases) {
    const results = [];

    for (const testCase of testCases) {
        try {
            const output = await executeCode(code, language, functionName, testCase);
            const passed = deepEqual(output, testCase.output);

            results.push({
                passed: passed,
                expected: testCase.output,
                actual: output,
                input: testCase.input
            });
        } catch (error) {
            results.push({
                passed: false,
                expected: testCase.output,
                actual: `Error: ${error.message}`,
                input: testCase.input
            });
        }
    }

    return results;
}

// API Routes

// Register student
app.post('/api/register', (req, res) => {
    const { name, rollNumber } = req.body;

    students.set(rollNumber, {
        name: name,
        rollNumber: rollNumber,
        registeredAt: new Date()
    });

    res.json({ success: true });
});

// Get problems
app.get('/api/problems', (req, res) => {
    res.json(problems);
});

// Run code (sample test cases only)
app.post('/api/run', async (req, res) => {
    try {
        const { code, language, problemId } = req.body;
        const problem = problems[problemId];

        if (!problem) {
            return res.status(404).json({ error: 'Problem not found' });
        }

        const sampleCases = problem.testCases.slice(0, 2);
        const results = await testCode(code, language, problem.functionName, sampleCases);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Submit code (all test cases)
app.post('/api/submit', async (req, res) => {
    try {
        const { code, language, problemId, studentName, rollNumber, violations } = req.body;
        const problem = problems[problemId];

        if (!problem) {
            return res.status(404).json({ error: 'Problem not found' });
        }

        const results = await testCode(code, language, problem.functionName, problem.testCases);
        const passed = results.filter(r => r.passed).length;
        const total = results.length;
        const allPassed = passed === total;

        // Store submission
        const submissionKey = `${rollNumber}-${problemId}`;
        const score = allPassed ? problem.points : 0;

        submissions.set(submissionKey, {
            studentName,
            rollNumber,
            problemId,
            code,
            language,
            passed,
            total,
            score,
            violations,
            timestamp: new Date()
        });

        res.json({
            results,
            passed,
            total,
            allPassed,
            score
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Log violation
app.post('/api/log-violation', (req, res) => {
    const { studentName, rollNumber, violationType, timestamp } = req.body;

    if (!violations.has(rollNumber)) {
        violations.set(rollNumber, []);
    }

    violations.get(rollNumber).push({
        type: violationType,
        timestamp: timestamp
    });

    console.log(`Violation logged: ${studentName} (${rollNumber}) - ${violationType}`);
    res.json({ success: true });
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
    const leaderboard = new Map();

    // Aggregate submissions by student
    for (const [key, submission] of submissions.entries()) {
        const rollNumber = submission.rollNumber;

        if (!leaderboard.has(rollNumber)) {
            leaderboard.set(rollNumber, {
                name: submission.studentName,
                rollNumber: rollNumber,
                score: 0,
                problemsSolved: 0,
                violations: violations.get(rollNumber)?.length || 0
            });
        }

        const student = leaderboard.get(rollNumber);
        if (submission.passed === submission.total) {
            student.score += submission.score;
            student.problemsSolved++;
        }
    }

    // Convert to array and sort
    const leaderboardArray = Array.from(leaderboard.values())
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.problemsSolved !== a.problemsSolved) return b.problemsSolved - a.problemsSolved;
            return a.violations - b.violations;
        });

    res.json(leaderboardArray);
});

// Admin: Get all violations
app.get('/api/admin/violations', (req, res) => {
    const allViolations = [];

    for (const [rollNumber, violationList] of violations.entries()) {
        const student = students.get(rollNumber);
        allViolations.push({
            name: student?.name || 'Unknown',
            rollNumber: rollNumber,
            violations: violationList
        });
    }

    res.json(allViolations);
});

// Admin: Get all submissions
app.get('/api/admin/submissions', (req, res) => {
    const allSubmissions = Array.from(submissions.values());
    res.json(allSubmissions);
});

// Admin: Export violations as CSV
app.get('/api/admin/export', (req, res) => {
    let csv = 'Timestamp,Student Name,Roll Number,Violation Type\n';

    for (const [rollNumber, violationList] of violations.entries()) {
        const student = students.get(rollNumber);
        const name = student ? student.name : 'Unknown';

        violationList.forEach(v => {
            csv += `${new Date(v.timestamp).toLocaleString()},${name},${rollNumber},${v.type}\n`;
        });
    }

    res.header('Content-Type', 'text/csv');
    res.attachment('contest_violations.csv');
    return res.send(csv);
});

// Start server
async function startServer() {
    await loadProblems();

    app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════╗
║   Coding Contest Platform Running!        ║
║          (LeetCode Style)                 ║
╚═══════════════════════════════════════════╝

Server: http://localhost:${PORT}
Admin Panel: http://localhost:${PORT}/admin.html

Features Active:
✓ Function-based submissions (like LeetCode)
✓ Tab-switch detection
✓ Copy-paste blocking
✓ Automatic code judging
✓ Real-time leaderboard
✓ Violation logging

Press Ctrl+C to stop the server.
        `);
    });
}

startServer();
