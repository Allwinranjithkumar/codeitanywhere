const { VM } = require('vm2');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

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

// Execute C function (Queued similar to C++)
function executeCFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        compilationQueue.push({ code, functionName, testCase, resolve, reject, lang: 'c' });
        processCompilationQueue();
    });
}

// Queue for compilation tasks
const compilationQueue = [];
let activeCompilations = 0;
const MAX_CONCURRENT_COMPILATIONS = 4; // Increased for 75 concurrent users (approx)

// Process queue
async function processCompilationQueue() {
    if (activeCompilations >= MAX_CONCURRENT_COMPILATIONS || compilationQueue.length === 0) return;

    activeCompilations++;
    const { code, functionName, testCase, resolve, reject, lang } = compilationQueue.shift();

    try {
        let result;
        if (lang === 'c') {
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

// Actual C Compilation Logic (gcc)
function runCCompilation(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        const tempFile = `Solution_${Date.now()}`;

        // Dynamically build arguments
        const declarations = [];
        const funcArgs = [];

        for (const [key, value] of Object.entries(testCase.input)) {
            if (Array.isArray(value)) {
                // Determine type
                const type = typeof value[0] === 'number' ? 'int' : 'char*';
                // For C arrays, we usually need size too. But simplistic for now.
                // Or just pass manually constructed arrays.
                // Array format: type name[] = { ... };
                if (typeof value[0] === 'string') {
                    // String array not easily supported in simple C template without helper.
                    // Assume int array for contest scope or basic strings.
                    declarations.push(`char* ${key}[] = {${value.map(s => `"${s}"`).join(',')}};`);
                } else {
                    declarations.push(`int ${key}[] = {${value.join(',')}};`);
                    declarations.push(`int ${key}Size = ${value.length};`); // Usually needed in C
                    funcArgs.push(key);
                    funcArgs.push(`${key}Size`); // Convention: name + Size
                    continue; // Skip default push
                }
                funcArgs.push(key);
            } else if (typeof value === 'string') {
                declarations.push(`char* ${key} = "${value}";`);
                funcArgs.push(key);
            } else if (typeof value === 'number') {
                declarations.push(`int ${key} = ${value};`);
                funcArgs.push(key);
            } else if (typeof value === 'boolean') {
                declarations.push(`int ${key} = ${value ? 1 : 0};`); // C uses int for bool often
                funcArgs.push(key);
            }
        }

        const testCode = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

${code}

int main() {
    // Prepare arguments
    ${declarations.join('\n    ')}

    // Call function
    int result = ${functionName}(${funcArgs.join(', ')});

    printf("%d", result);

    return 0;
}
`;
        fs.writeFile(`${tempFile}.c`, testCode, 'utf-8')
            .then(() => {
                const runCmd = process.platform === 'win32' ? `${tempFile}.exe` : `./${tempFile}`;
                exec(`gcc -o ${tempFile} ${tempFile}.c && ${runCmd}`, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    // Cleanup
                    fs.unlink(`${tempFile}.c`).catch(() => { });
                    fs.unlink(tempFile).catch(() => { });
                    fs.unlink(`${tempFile}.exe`).catch(() => { }); // Windows

                    if (error) {
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

// Execute C++ function (Queued)
function executeCppFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        compilationQueue.push({ code, functionName, testCase, resolve, reject, lang: 'cpp' });
        processCompilationQueue();
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
#include <map>
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
    
    cout << result << endl;
    
    return 0;
}
`;
        fs.writeFile(`${tempFile}.cpp`, testCode, 'utf-8')
            .then(() => {
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
        case 'c':
            return await executeCFunction(code, functionName, testCase);
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

module.exports = {
    testCode,
    executeCode
};
