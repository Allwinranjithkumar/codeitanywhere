const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const syncExcel = require('./syncExcel');
const problemService = require('./services/problemService');
const authRoutes = require('./routes/auth.routes');
const judgeRoutes = require('./routes/judge.routes');
const adminRoutes = require('./routes/admin.routes');
require('dotenv').config();

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

// Queue for compilation tasks
const compilationQueue = [];
let activeCompilations = 0;
const MAX_CONCURRENT_COMPILATIONS = 2; // Limit to 2 parallel compiles on Free Tier

// Process queue
async function processCompilationQueue() {
    if (activeCompilations >= MAX_CONCURRENT_COMPILATIONS || compilationQueue.length === 0) return;

    activeCompilations++;
    const { code, language, functionName, testCase, resolve, reject } = compilationQueue.shift();

// Helper for re-syncing Excel manually
app.post('/api/admin/sync-excel', async (req, res) => {
    try {
        let result;
        if (language === 'c') {
            result = await runCCompilation(code, functionName, testCase);
        } else {
            result = await runCppCompilation(code, functionName, testCase);
        }
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        activeCompilations--;
        processCompilationQueue(); // Process next item
    }
}

// Execute C++ function (Queued)
function executeCppFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        compilationQueue.push({ code, language: 'cpp', functionName, testCase, resolve, reject });
        processCompilationQueue();
    });
}

// Execute C function (Queued)
function executeCFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        compilationQueue.push({ code, language: 'c', functionName, testCase, resolve, reject });
        processCompilationQueue();
    });
}



// Actual C Compilation Logic
function runCCompilation(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        const tempFile = `Solution_${Date.now()}`;

        // Dynamically build argument declarations
        const declarations = [];
        const funcArgs = [];

        for (const [key, value] of Object.entries(testCase.input)) {
            if (Array.isArray(value)) {
                // Buffer declaration
                declarations.push(`int ${key}[] = {${value.join(',')}};`);
                declarations.push(`int ${key}Size = ${value.length};`);
                // Pass pointer and size
                funcArgs.push(key);
                funcArgs.push(`${key}Size`);
            } else if (typeof value === 'string') {
                declarations.push(`char* ${key} = "${value}";`);
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
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>

${code}

int main() {
    // Prepare arguments
    ${declarations.join('\n    ')}
    
    // Call function
    int result = ${functionName}(${funcArgs.join(', ')});
    
    // Print Output
    printf("%d", result);
    return 0;
}
`;

        const sourcePath = path.join(__dirname, `${tempFile}.c`);
        const exePath = path.join(__dirname, `${tempFile}.exe`);

        // Write source file
        fs.writeFile(sourcePath, testCode).then(() => {
            // Compile with gcc
            exec(`gcc "${sourcePath}" -o "${exePath}"`, (error, stdout, stderr) => {
                if (error) {
                    // Cleanup and reject
                    fs.unlink(sourcePath).catch(() => { });
                    reject(new Error(stderr || 'Compilation failed'));
                    return;
                }

                // Run executable
                exec(`"${exePath}"`, (err, stdout, stderr) => {
                    // Cleanup files
                    fs.unlink(sourcePath).catch(() => { });
                    fs.unlink(exePath).catch(() => { });

                    if (err) {
                        reject(new Error(stderr || 'Runtime error'));
                    } else {
                        try {
                            const result = parseInt(stdout.trim(), 10);
                            resolve(result);
                        } catch (e) {
                            reject(new Error('Invalid output format'));
                        }
                    }
                });
            });
        });
    });
}

// Actual Compilation Logic
function runCppCompilation(code, functionName, testCase) {
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
        case 'c':
            return await executeCFunction(code, functionName, testCase);
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

// Start Server
async function startServer() {
    await db.initDB();
    await syncExcel();
    await problemService.loadProblems();

    app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════╗
║   Coding Contest Platform Running!        ║
╚═══════════════════════════════════════════╝

Server: http://localhost:${PORT}
`);
    });
}

startServer();
