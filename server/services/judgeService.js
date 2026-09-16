/**
 * judgeService.js — Secure code execution engine
 *
 * Security measures:
 * - Temp files written to OS temp dir (not CWD) with unique UUIDs
 * - Guaranteed cleanup in finally blocks — no temp file leaks
 * - Strict per-execution timeouts (5s Python/JS, 8s C/C++/Java)
 * - maxBuffer limited to prevent memory exhaustion
 * - Language validated server-side before execution
 * - JavaScript runs via Node.js child_process (vm2 removed — was deprecated with known escapes)
 * - Java Gson dependency removed (was broken in most environments)
 * - Execution queue limits concurrent processes to protect the host
 *
 * NOTE: For production with many users, migrate to Docker-isolated execution.
 * This implementation provides reasonable limits for a college-level deployment.
 */

const { exec } = require('child_process');
const fs        = require('fs').promises;
const os        = require('os');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const SUPPORTED_LANGUAGES = ['python', 'javascript', 'cpp', 'c', 'java'];
const MAX_CONCURRENT       = 5;    // Max parallel executions
const TIMEOUT_PYTHON_JS    = 5000; // ms
const TIMEOUT_COMPILED     = 8000; // ms
const MAX_OUTPUT_BUFFER    = 512 * 1024; // 512 KB

let activeExecutions = 0;

// ──────────────────────────────────────────────
// Unique Temp Directory per Execution
// ──────────────────────────────────────────────

async function createTempDir() {
    const dir = path.join(os.tmpdir(), `judge_${uuidv4()}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

async function cleanupDir(dir) {
    try {
        await fs.rm(dir, { recursive: true, force: true });
    } catch (_) {
        // Best-effort cleanup — log but don't crash
    }
}

// ──────────────────────────────────────────────
// Shell Execution Helper
// ──────────────────────────────────────────────

function runCommand(cmd, options) {
    return new Promise((resolve, reject) => {
        exec(cmd, options, (error, stdout, stderr) => {
            if (error) {
                if (error.killed || error.signal === 'SIGTERM') {
                    reject(new Error('Time Limit Exceeded'));
                } else {
                    reject(new Error(stderr || error.message));
                }
            } else {
                resolve(stdout);
            }
        });
    });
}

// ──────────────────────────────────────────────
// Python Execution
// ──────────────────────────────────────────────

async function executePython(code, functionName, testCase) {
    const tempDir  = await createTempDir();
    const tempFile = path.join(tempDir, 'solution.py');

    const args = Object.values(testCase.input)
        .map(v => JSON.stringify(v))
        .join(', ');

    const testCode = `import json\nimport sys\n\n${code}\n\ntry:\n    result = ${functionName}(${args})\n    print(json.dumps(result))\nexcept Exception as e:\n    print(json.dumps({"__error__": str(e)}), file=sys.stderr)\n    sys.exit(1)\n`;

    try {
        await fs.writeFile(tempFile, testCode, 'utf-8');
        const stdout = await runCommand(`python3 "${tempFile}"`, {
            timeout: TIMEOUT_PYTHON_JS,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        return JSON.parse(stdout.trim());
    } finally {
        await cleanupDir(tempDir);
    }
}

// ──────────────────────────────────────────────
// JavaScript Execution (via Node.js child_process — vm2 removed)
// ──────────────────────────────────────────────

async function executeJavaScript(code, functionName, testCase) {
    const tempDir  = await createTempDir();
    const tempFile = path.join(tempDir, 'solution.js');

    const args = Object.values(testCase.input)
        .map(v => JSON.stringify(v))
        .join(', ');

    const testCode = `
'use strict';
${code}

try {
    const result = ${functionName}(${args});
    process.stdout.write(JSON.stringify(result) + '\\n');
} catch (e) {
    process.stderr.write(JSON.stringify({ __error__: e.message }) + '\\n');
    process.exit(1);
}
`;

    try {
        await fs.writeFile(tempFile, testCode, 'utf-8');
        const stdout = await runCommand(`node "${tempFile}"`, {
            timeout: TIMEOUT_PYTHON_JS,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        return JSON.parse(stdout.trim());
    } finally {
        await cleanupDir(tempDir);
    }
}

// ──────────────────────────────────────────────
// C / C++ Execution
// ──────────────────────────────────────────────

async function executeCpp(code, functionName, testCase, lang = 'cpp') {
    const tempDir  = await createTempDir();
    const isC      = lang === 'c';
    const ext      = isC ? 'c' : 'cpp';
    const compiler = isC ? 'gcc' : 'g++';
    const srcFile  = path.join(tempDir, `solution.${ext}`);
    const binFile  = path.join(tempDir, 'solution');

    // Build typed argument declarations
    const isFloat      = v => typeof v === 'number' && !Number.isInteger(v);
    const arrayHasFloat = arr => arr.some(el => isFloat(el));

    const declarations = [];
    const funcArgs     = [];

    for (const [key, value] of Object.entries(testCase.input)) {
        if (Array.isArray(value)) {
            const useDouble = arrayHasFloat(value);
            const cType     = useDouble ? 'double' : 'int';
            if (isC) {
                declarations.push(`${cType} ${key}[] = {${value.join(',')}};`);
                declarations.push(`int ${key}Size = ${value.length};`);
                funcArgs.push(key, `${key}Size`);
            } else {
                declarations.push(`vector<${cType}> ${key} = {${value.join(',')}};`);
                funcArgs.push(key);
            }
        } else if (typeof value === 'string') {
            // Sanitize: escape backslashes and quotes to prevent injection
            const safe = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            declarations.push(isC ? `char *${key} = "${safe}";` : `string ${key} = "${safe}";`);
            funcArgs.push(key);
        } else if (typeof value === 'number') {
            const cType = isFloat(value) ? 'double' : 'int';
            declarations.push(`${cType} ${key} = ${value};`);
            funcArgs.push(key);
        } else if (typeof value === 'boolean') {
            declarations.push(`${isC ? 'int' : 'bool'} ${key} = ${value ? 1 : 0};`);
            funcArgs.push(key);
        }
    }

    const outputIsFloat = isFloat(testCase.output);

    let testCode;
    if (isC) {
        const fmt = outputIsFloat ? '"%.6f\\n"' : '"%d\\n"';
        testCode = `#include <stdio.h>\n#include <stdlib.h>\n#include <stdbool.h>\n#include <string.h>\n\n${code}\n\nint main() {\n    ${declarations.join('\n    ')}\n    ${outputIsFloat ? 'double' : 'int'} result = ${functionName}(${funcArgs.join(', ')});\n    printf(${fmt}, result);\n    return 0;\n}\n`;
    } else {
        testCode = `#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <map>\n#include <set>\n#include <sstream>\nusing namespace std;\n\ntemplate<typename T>\nostream& operator<<(ostream& os, const vector<T>& v) {\n    os << "[";\n    for (size_t i = 0; i < v.size(); ++i) { os << v[i]; if(i!=v.size()-1) os << ","; }\n    return os << "]";\n}\n\n${code}\n\nint main() {\n    Solution solution;\n    ${declarations.join('\n    ')}\n    auto result = solution.${functionName}(${funcArgs.join(', ')});\n    ${outputIsFloat ? 'cout << fixed; cout.precision(6);' : ''}\n    cout << result << endl;\n    return 0;\n}\n`;
    }

    try {
        await fs.writeFile(srcFile, testCode, 'utf-8');
        // Compile
        await runCommand(`${compiler} -O2 -o "${binFile}" "${srcFile}"`, {
            timeout: TIMEOUT_COMPILED,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        // Run
        const stdout = await runCommand(`"${binFile}"`, {
            timeout: TIMEOUT_COMPILED,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        const trimmed = stdout.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            return JSON.parse(trimmed);
        }
        return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
    } finally {
        await cleanupDir(tempDir);
    }
}

// ──────────────────────────────────────────────
// Java Execution (simplified — no Gson dependency)
// ──────────────────────────────────────────────

async function executeJava(code, functionName, testCase) {
    const tempDir = await createTempDir();
    const srcFile = path.join(tempDir, 'Solution.java');

    // Build argument list for Java
    const javaArgs = Object.values(testCase.input).map(val => {
        if (Array.isArray(val)) {
            if (typeof val[0] === 'number') return `new int[]{${val.join(',')}}`;
            return `new String[]{${val.map(s => `"${String(s).replace(/"/g, '\\"')}"`).join(',')}}`;
        } else if (typeof val === 'string') {
            return `"${val.replace(/"/g, '\\"')}"`;
        } else if (typeof val === 'boolean') {
            return val.toString();
        }
        return String(val);
    }).join(', ');

    const testCode = `
${code}

class Judge {
    public static void main(String[] args) {
        Solution solution = new Solution();
        Object result = solution.${functionName}(${javaArgs});
        if (result instanceof int[]) {
            int[] arr = (int[]) result;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length; i++) { sb.append(arr[i]); if(i<arr.length-1)sb.append(","); }
            sb.append("]");
            System.out.println(sb.toString());
        } else if (result instanceof boolean[]) {
            boolean[] arr = (boolean[]) result;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length; i++) { sb.append(arr[i]); if(i<arr.length-1)sb.append(","); }
            sb.append("]");
            System.out.println(sb.toString());
        } else {
            System.out.println(result);
        }
    }
}
`;

    try {
        await fs.writeFile(srcFile, testCode, 'utf-8');
        await runCommand(`javac "${srcFile}"`, {
            timeout: TIMEOUT_COMPILED,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        const stdout = await runCommand(`java -cp "${tempDir}" Judge`, {
            timeout: TIMEOUT_COMPILED,
            maxBuffer: MAX_OUTPUT_BUFFER,
            cwd: tempDir
        });
        const trimmed = stdout.trim();
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try { return JSON.parse(trimmed); } catch (_) { return trimmed; }
        }
        const n = Number(trimmed);
        return isNaN(n) ? trimmed : n;
    } finally {
        await cleanupDir(tempDir);
    }
}

// ──────────────────────────────────────────────
// Execution Queue (limits concurrency)
// ──────────────────────────────────────────────

const queue = [];

function processQueue() {
    if (activeExecutions >= MAX_CONCURRENT || queue.length === 0) return;
    activeExecutions++;
    const { code, language, functionName, testCase, resolve, reject } = queue.shift();

    (async () => {
        try {
            let result;
            switch (language) {
                case 'python':     result = await executePython(code, functionName, testCase);      break;
                case 'javascript': result = await executeJavaScript(code, functionName, testCase);  break;
                case 'cpp':        result = await executeCpp(code, functionName, testCase, 'cpp');  break;
                case 'c':          result = await executeCpp(code, functionName, testCase, 'c');    break;
                case 'java':       result = await executeJava(code, functionName, testCase);        break;
                default:           throw new Error(`Unsupported language: ${language}`);
            }
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            activeExecutions--;
            processQueue();
        }
    })();
}

function executeCode(code, language, functionName, testCase) {
    return new Promise((resolve, reject) => {
        queue.push({ code, language, functionName, testCase, resolve, reject });
        processQueue();
    });
}

// ──────────────────────────────────────────────
// Deep Equality (with float tolerance)
// ──────────────────────────────────────────────

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
    if (a == null || b == null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        return ka.every(k => deepEqual(a[k], b[k]));
    }
    return String(a) === String(b);
}

// ──────────────────────────────────────────────
// Main: Test Code Against Test Cases
// ──────────────────────────────────────────────

async function testCode(code, language, functionName, testCases) {
    if (!SUPPORTED_LANGUAGES.includes(language)) {
        throw new Error(`Unsupported language: ${language}`);
    }
    if (!code || !code.trim()) {
        throw new Error('Code cannot be empty.');
    }
    if (!functionName) {
        throw new Error('Function name is required.');
    }

    const results = [];
    const startTime = Date.now();

    for (const testCase of testCases) {
        try {
            const output = await executeCode(code, language, functionName, testCase);
            const passed = deepEqual(output, testCase.output);
            results.push({
                passed,
                expected: testCase.output,
                actual:   output,
                input:    testCase.input
            });
        } catch (err) {
            results.push({
                passed:   false,
                expected: testCase.output,
                actual:   `Error: ${err.message}`,
                input:    testCase.input,
                error:    err.message
            });
        }
    }

    const totalTime = Date.now() - startTime;
    return { results, executionTimeMs: totalTime };
}

module.exports = { testCode, executeCode };
