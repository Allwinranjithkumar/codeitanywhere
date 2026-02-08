// Global variables
let editor;
let currentProblem = 0;
let problems = [];
let studentName = '';
let rollNumber = '';
let violations = 0;
let timeRemaining = 3600; // 60 minutes in seconds
let timerInterval;
let submissions = {};

// Lockdown features
function preventCopyPaste(e) {
    // e.preventDefault(); // Do not block
    // showWarning('Copy-paste is disabled during the contest!');

    // Log violation as AI Used
    logViolation('ai_used');
    showWarning('Warning: Copy-Paste detected! Marked as AI Used.');
    return false;
}

function preventRightClick(e) {
    e.preventDefault();
    return false;
}

function detectTabSwitch() {
    violations++;
    document.getElementById('violationCount').textContent = violations;

    // Log violation to server
    logViolation('tab_switch');

    // Show warning banner
    const banner = document.getElementById('warningBanner');
    banner.style.display = 'block';

    if (violations >= 5) {
        showWarning('Critical: 5+ Tab Switches! Marked as "Tab Switched".');
        logViolation('status_tab_switched'); // Explicit status log
    } else {
        setTimeout(() => {
            banner.style.display = 'none';
        }, 3000);
    }
}

function showWarning(message) {
    const banner = document.getElementById('warningBanner');
    banner.textContent = '⚠️ ' + message;
    banner.style.display = 'block';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 3000);
}

// Detect when user leaves the page
// Detect when user leaves the page
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        detectTabSwitch();
    }
});

// Prevent copying
document.addEventListener('copy', preventCopyPaste);
document.addEventListener('cut', preventCopyPaste);
document.addEventListener('paste', preventCopyPaste);
document.addEventListener('contextmenu', preventRightClick);

// Prevent keyboard shortcuts
// Prevent keyboard shortcuts
// document.addEventListener('keydown', function(e) {
//     // Prevent Ctrl+C, Ctrl+V, Ctrl+X
//     if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
//         if (e.target !== document.getElementById('codeEditor').nextSibling.CodeMirror.getInputField()) {
//             e.preventDefault();
//             showWarning('Copy-paste shortcuts are disabled!');
//         }
//     }

//     // Prevent F12, Ctrl+Shift+I (DevTools)
//     if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I')) {
//         e.preventDefault();
//         showWarning('Developer tools are disabled!');
//     }
// });

// Timer
function startTimer() {
    timerInterval = setInterval(() => {
        timeRemaining--;

        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        const timerElement = document.getElementById('timer');
        timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        if (timeRemaining <= 300) { // 5 minutes warning
            timerElement.classList.add('warning');
        }

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            autoSubmitAll();
            alert('Time is up! Your solutions have been submitted automatically.');
        }
    }, 1000);
}

// Start contest
function startContest() {
    studentName = document.getElementById('studentName').value.trim();
    rollNumber = document.getElementById('rollNumber').value.trim();

    if (!studentName || !rollNumber) {
        alert('Please enter both name and roll number');
        return;
    }

    // Hide login, show contest
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('contestScreen').classList.remove('contest-hidden');
    document.getElementById('studentDisplay').textContent = `${studentName} (${rollNumber})`;

    // Initialize
    initializeEditor();
    loadProblems();
    startTimer();

    // Send registration to server
    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: studentName, rollNumber: rollNumber })
    });
}

// Initialize code editor
function initializeEditor() {
    editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
        mode: 'python',
        theme: 'monokai',
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false
    });

    editor.setSize('100%', '100%');
}

// Change language
function changeLanguage() {
    const language = document.getElementById('languageSelect').value;
    let mode = language;
    if (language === 'cpp') {
        mode = 'text/x-c++src';
    } else if (language === 'java') {
        mode = 'text/x-java';
    }
    editor.setOption('mode', mode);

    // Update code with starter code if current code is empty or default
    async function loadProblems() {
        try {
            const response = await fetch('/api/problems');
            problems = await response.json();

            const problemList = document.getElementById('problemList');
            problemList.innerHTML = problems.map((p, i) => `
            <button onclick="selectProblem(${i})" id="problem-btn-${i}">
                Problem ${i + 1}: ${p.title}
                <span class="difficulty ${p.difficulty.toLowerCase()}">${p.difficulty}</span>
            </button>
        `).join('');

            selectProblem(0);
        } catch (error) {
            console.error('Error loading problems:', error);
        }
    }

    function selectProblem(index) {
        currentProblem = index;
        const p = problems[index];

        document.getElementById('problemTitle').textContent = `Problem ${index + 1}: ${p.title}`;
        document.getElementById('problemDescription').textContent = p.description;
        document.getElementById('outputSection').style.display = 'none';

        // Highlight active button
        document.querySelectorAll('#problemList button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`problem-btn-${index}`).classList.add('active');

        // Load saved submission or starter code
        const saved = submissions[index];
        if (saved) {
            editor.setValue(saved.code);
        } else {
            changeLanguage(); // Load starter code
        }
    }

    function changeLanguage() {
        const language = document.getElementById('languageSelect').value;
        monaco.editor.setModelLanguage(editor.getModel(), language);

        // Load starter code for language
        const p = problems[currentProblem];
        if (p && p.starterCode && p.starterCode[language]) {
            editor.setValue(p.starterCode[language]);
        } else {
            editor.setValue('');
        }
    }

    // Run code
    async function runCode() {
        const code = editor.getValue();
        if (!code.trim()) {
            alert('Please write some code first!');
            return;
        }

        const language = document.getElementById('languageSelect').value;
        const problem = problems[currentProblem];

        document.getElementById('outputSection').style.display = 'block';
        document.getElementById('results').innerHTML = '<p>Running tests...</p>';

        try {
            const response = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code,
                    language: language,
                    testCases: problem.testCases.slice(0, 2), // Only sample test cases for run
                    problemId: currentProblem
                })
            });

            const results = await response.json();
            displayResults(results);
        } catch (error) {
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = `
            <div class="result fail">
                <strong>System Error:</strong>
                <pre style="background: #2b1d1d; color: #ff6b6b; padding: 10px; border-radius: 4px; overflow-x: auto; margin-top: 5px;">${error.message}</pre>
            </div>
        `;
        }
    }

    // Submit code
    async function submitCode() {
        const code = editor.getValue();
        if (!code.trim()) {
            alert('Please write some code first!');
            return;
        }

        if (!confirm('Are you sure you want to submit this solution?')) {
            return;
        }

        const language = document.getElementById('languageSelect').value;
        const problem = problems[currentProblem];

        document.getElementById('outputSection').style.display = 'block';
        document.getElementById('results').innerHTML = '<p>Submitting and testing all cases...</p>';

        try {
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code,
                    language: language,
                    problemId: currentProblem,
                    studentName: studentName,
                    rollNumber: rollNumber,
                    violations: violations
                })
            });

            const result = await response.json();

            // Save submission
            submissions[currentProblem] = {
                code: code,
                result: result
            };

            // Update UI
            if (result.allPassed) {
                document.getElementById(`problem-btn-${currentProblem}`).classList.add('solved');
                alert('✅ All test cases passed! Solution submitted successfully.');
            } else {
                alert(`❌ ${result.passed}/${result.total} test cases passed. Keep trying!`);
            }

            displayResults(result.results);
        } catch (error) {
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = `
            <div class="result fail">
                <strong>System Error:</strong>
                <pre style="background: #2b1d1d; color: #ff6b6b; padding: 10px; border-radius: 4px; overflow-x: auto; margin-top: 5px;">${error.message}</pre>
            </div>
        `;
        }
    }

    // Display results
    function displayResults(results) {
        const resultsDiv = document.getElementById('results');

        // Check for compilation errors (if any result has a long error message)
        const compilationError = results.find(r => !r.passed && r.actual && r.actual.toString().includes('Error: Command failed'));

        if (compilationError) {
            // Clean up error message (remove "Command failed" garbage)
            let errorMsg = compilationError.actual.replace(/Error: Command failed: g\+\+.*?\n/s, '');
            // Keep meaningful C++ errors

            resultsDiv.innerHTML = `
            <div class="result fail" style="border-left: 5px solid #ff4444;">
                <h3 style="color: #ff4444; margin-top: 0;">Compilation Error</h3>
                <pre style="background: #2b1d1d; color: #ff9999; padding: 10px; border-radius: 4px; white-space: pre-wrap; font-family: 'Consolas', monospace;">${errorMsg}</pre>
            </div>
        `;
            return;
        }

        resultsDiv.innerHTML = results.map((result, i) => `
        <div class="result ${result.passed ? 'pass' : 'fail'}">
            <strong>Test Case ${i + 1}:</strong> ${result.passed ? '✅ Passed' : '❌ Failed'}
            ${!result.passed ? `
                <div style="margin-top: 8px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                    <div style="margin-bottom: 4px;"><small style="opacity: 0.7;">Input:</small> <code style="color: #ddd;">${JSON.stringify(result.input)}</code></div>
                    <div style="margin-bottom: 4px;"><small style="opacity: 0.7;">Expected:</small> <code style="color: #4caf50;">${JSON.stringify(result.expected)}</code></div>
                    <div><small style="opacity: 0.7;">Output:</small> <code style="color: #ff4444;">${JSON.stringify(result.actual)}</code></div>
                </div>
            ` : ''}
        </div>
    `).join('');
    }

    // Log violation
    async function logViolation(type) {
        try {
            await fetch('/api/log-violation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentName: studentName,
                    rollNumber: rollNumber,
                    violationType: type,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (error) {
            console.error('Error logging violation:', error);
        }
    }

    // Show leaderboard
    async function showLeaderboard() {
        try {
            const response = await fetch('/api/leaderboard');
            const leaderboard = await response.json();

            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = leaderboard.map((entry, i) => `
            <tr>
                <td class="${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</td>
                <td>${entry.name}</td>
                <td>${entry.rollNumber}</td>
                <td>${entry.score}</td>
                <td>${entry.problemsSolved}</td>
            </tr>
        `).join('');

            document.getElementById('leaderboardModal').classList.add('active');
        } catch (error) {
            alert('Error loading leaderboard: ' + error.message);
        }
    }

    // Close leaderboard
    function closeLeaderboard() {
        document.getElementById('leaderboardModal').classList.remove('active');
    }

    // Auto submit all on time up
    async function autoSubmitAll() {
        for (let i = 0; i < problems.length; i++) {
            if (submissions[i]) {
                // Already submitted
                continue;
            }

            // Submit current code for unsolved problems
            selectProblem(i);
            const code = editor.getValue();
            if (code.trim()) {
                await submitCode();
            }
        }
    }

    // Prevent leaving page
    window.addEventListener('beforeunload', function (e) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    });
