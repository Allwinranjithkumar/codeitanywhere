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
const MAX_CONCURRENT_COMPILATIONS = 4; // Increased for 75 concurrent users (approx)

// Process queue
async function processCompilationQueue() {
    if (activeCompilations >= MAX_CONCURRENT_COMPILATIONS || compilationQueue.length === 0) return;

    activeCompilations++;
    const { code, functionName, testCase, language, resolve, reject } = compilationQueue.shift();

    try {
        const result = await runCppCompilation(code, functionName, testCase, language);
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
        compilationQueue.push({ code, functionName, testCase, resolve, reject });
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

// Execute C function (Queued)
function executeCFunction(code, functionName, testCase) {
    return new Promise((resolve, reject) => {
        compilationQueue.push({ code, functionName, testCase, language: 'c', resolve, reject });
        processCompilationQueue();
    });
}

// Actual Compilation Logic for C/C++
function runCppCompilation(code, functionName, testCase, language = 'cpp') {
    return new Promise((resolve, reject) => {
        const tempFile = `Solution_${Date.now()}`;
        const isC = language === 'c';
        const fileExt = isC ? 'c' : 'cpp';
        const compiler = isC ? 'gcc' : 'g++';

        // Dynamically build argument declarations and calling signature
        const declarations = [];
        const funcArgs = [];

        for (const [key, value] of Object.entries(testCase.input)) {
            if (Array.isArray(value)) {
                if (isC) {
                    // C-style array: int nums[] = {1, 2, 3};
                    declarations.push(`int ${key}[] = {${value.join(',')}};`);
                    declarations.push(`int ${key}Size = ${value.length};`);
                    funcArgs.push(key);
                    funcArgs.push(`${key}Size`); // Pass size for arrays in C usually
                } else {
                    // C++ vector
                    declarations.push(`vector<int> ${key} = {${value.join(',')}};`);
                    funcArgs.push(key);
                }
            } else if (typeof value === 'string') {
                if (isC) {
                    declarations.push(`char *${key} = "${value}";`);
                } else {
                    declarations.push(`string ${key} = "${value}";`);
                }
                funcArgs.push(key);
            } else if (typeof value === 'number') {
                declarations.push(`int ${key} = ${value};`);
                funcArgs.push(key);
            } else if (typeof value === 'boolean') {
                declarations.push(`${isC ? 'int' : 'bool'} ${key} = ${value ? 1 : 0};`);
                funcArgs.push(key);
            }
        }

        let testCode;

        if (isC) {
            testCode = `
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
    
    printf("%d\\n", result);
    
    return 0;
}
`;
        } else {
            testCode = `
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
        }

        fs.writeFile(`${tempFile}.${fileExt}`, testCode, 'utf-8')
            .then(() => {
                const runCmd = process.platform === 'win32' ? `${tempFile}.exe` : `./${tempFile}`;
                exec(`${compiler} -o ${tempFile} ${tempFile}.${fileExt} && ${runCmd}`, {
                    timeout: 10000,
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    // Cleanup
                    fs.unlink(`${tempFile}.${fileExt}`).catch(() => { });
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
