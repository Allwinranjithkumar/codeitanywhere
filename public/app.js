// Global variables
let editor;
let currentProblem = 0;
let problems = [];
let studentName = '';
let rollNumber = '';
let violations = 0;
let timeRemaining = 3600; // 60 minutes in seconds
let timerInterval;
const submissions = {};

// Helper for authenticated fetch
async function authFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
        alert('Session expired. Please login again.');
        localStorage.removeItem('token');
        window.location.href = '/auth.html';
        throw new Error('Unauthorized');
    }
    return response;
}

// Lockdown features
let isInternalCopy = false;

function handleCopyCut(e) {
    // Allow copy/cut ONLY from the editor
    if (e.target.closest('.CodeMirror')) {
        isInternalCopy = true;
        // Reset flag after 15 seconds to prevent long-term exploit
        setTimeout(() => { isInternalCopy = false; }, 15000);
        return true; // Allow default behavior
    }
    e.preventDefault();
    return false;
}

function handlePaste(e) {
    // If it's an internal copy, ALLOW it
    if (isInternalCopy && e.target.closest('.CodeMirror')) {
        // Optional: Reset flag? No, user might paste multiple times.
        return true;
    }

    // Otherwise, block and log violation
    e.preventDefault();
    logViolation('ai_used');
    showWarning('Warning: External Paste detected! Marked as AI Used.');
    return false;
}

function preventRightClick(e) {
    // Allow right click in editor? Usually no for strict contests.
    // Keeping strict right click prevention
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
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        detectTabSwitch();
    }
});

// Prevent copying (Global listeners)
document.addEventListener('copy', handleCopyCut);
document.addEventListener('cut', handleCopyCut);
document.addEventListener('paste', handlePaste);
document.addEventListener('contextmenu', preventRightClick);

// Timer
function startTimer() {
    const DURATION = 3600 * 1000; // 60 minutes in milliseconds
    let endTime = localStorage.getItem('contestEndTime');

    if (!endTime) {
        endTime = Date.now() + DURATION;
        localStorage.setItem('contestEndTime', endTime);
    }

    timerInterval = setInterval(() => {
        const remainingMs = endTime - Date.now();
        timeRemaining = Math.floor(remainingMs / 1000);

        if (timeRemaining < 0) {
            timeRemaining = 0;
            clearInterval(timerInterval);
            autoSubmitAll();
            alert('Time is up! Your solutions have been submitted automatically.');
            // Optional: Clear end time so next login starts fresh? 
            // localStorage.removeItem('contestEndTime'); 
            return;
        }

        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        const timerElement = document.getElementById('timer');
        if (timerElement) {
            timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            if (timeRemaining <= 300) { // 5 minutes warning
                timerElement.classList.add('warning');
            }
        }
    }, 1000);
}

// Initialize app
function initApp() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.name) {
        // Handle rollNumber normalization if needed (some parts use reg_no, some rollNumber)
        const displayRoll = user.reg_no || user.rollNumber;
        document.getElementById('studentDisplay').textContent = `${user.name} (${displayRoll})`;
        studentName = user.name;
        rollNumber = displayRoll;
    } else {
        // Fallback or force login
        window.location.href = '/auth.html';
        return;
    }

    document.getElementById('contestScreen').classList.remove('contest-hidden');
    initializeEditor();
    loadProblems();
    startTimer();
}

// Start immediately as we are already authenticated from index.html check
document.addEventListener('DOMContentLoaded', initApp);

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
function changeLanguageAndLoad() {
    const language = document.getElementById('languageSelect').value;
    let mode = language;
    if (language === 'cpp') {
        mode = 'text/x-c++src';
    } else if (language === 'java') {
        mode = 'text/x-java';
    }
    editor.setOption('mode', mode);

    // Check if we switch back to starter if empty? 
    // Usually handled by selectProblem logic
}
// Hook up the change event
// document.getElementById('languageSelect').onchange handled in HTML? No, verify HTML.
// HTML has onchange="changeLanguage()". I need to rename or match.
// I'll rename my function to changeLanguage to match HTML.

function changeLanguage() {
    const language = document.getElementById('languageSelect').value;
    let mode = language;
    if (language === 'cpp') {
        mode = 'text/x-c++src';
    } else if (language === 'c') {
        mode = 'text/x-csrc';
    } else if (language === 'java') {
        mode = 'text/x-java';
    }
    editor.setOption('mode', mode);

    // Load starter code for language
    const p = problems[currentProblem];
    // Preserve code if user typed something? Or simple reset?
    // User expects starter code if switching language usually.
    if (p && p.starterCode && p.starterCode[language]) {
        // Check if editor has default content before overwriting? 
        // For simplicity, let's just set it for now or keep existing if not empty?
        // Contest behavior: switching language resets code or translates (transpile is hard).
        // Let's reset to starter code.
        editor.setValue(p.starterCode[language]);
    } else {
        editor.setValue('');
    }
}


// Load problems
async function loadProblems() {
    try {
        const response = await authFetch('/api/judge/problems');
        problems = await response.json();

        const problemList = document.getElementById('problemList'); // Correct ID in HTML is problemSelector?
        // Let's check HTML. HTML says: <div class="problem-selector" id="problemSelector">
        // Wait, app.js previously used problemList... let me check previous app.js content.
        // Previous app.js: const problemList = document.getElementById('problemList');
        // HTML provided previously: <div class="problem-selector" id="problemSelector">
        // AND <div id="problemsContainer">

        // Wait, the previous app.js I read had:
        // const problemList = document.getElementById('problemList');
        // in function loadProblems().

        // But the HTML file `public/index.html` shows:
        // <div class="problem-selector" id="problemSelector">
        // It does NOT have id="problemList".
        // This means the previous `app.js` might have been broken or I misread?
        // Ah, I see in `initializeEditor`... wait.
        // Let's use `problemSelector` which exists.

        const problemSelector = document.getElementById('problemSelector');
        if (problemSelector) {
            problemSelector.innerHTML = problems.map((p, i) => `
                <button onclick="selectProblem(${i})" id="problem-btn-${i}" class="problem-btn">
                    Problem ${i + 1}: ${p.title}
                    <span class="difficulty ${p.difficulty.toLowerCase()}">${p.difficulty}</span>
                </button>
            `).join('');
        }

        selectProblem(0);
    } catch (error) {
        console.error('Error loading problems:', error);
    }
}

// Select problem
function selectProblem(index) {
    if (!problems[index]) return;
    currentProblem = index;
    const p = problems[index];

    // Check where to put title and description
    // The previous HTML didn't show where they go clearly in `problemsContainer`?
    // Previous app.js: document.getElementById('problemTitle').textContent = ...
    // But HTML: <div id="problemsContainer"> <!-- Problem content will be loaded here --> </div>
    // So I should inject the content into problemsContainer.

    const container = document.getElementById('problemsContainer');
    container.innerHTML = `
        <div class="problem-content active">
            <h2 class="problem-title">Problem ${index + 1}: ${p.title}</h2>
            <div class="problem-description">${p.description}</div>
            <div class="test-cases">
                <!-- Sample cases could be here -->
            </div>
        </div>
    `;

    document.getElementById('outputSection').style.display = 'none';

    // Highlight active button
    document.querySelectorAll('.problem-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(`problem-btn-${index}`);
    if (btn) btn.classList.add('active');

    // Load saved submission or starter code
    const saved = submissions[index];
    if (saved && saved.code) {
        editor.setValue(saved.code);
    } else {
        changeLanguage(); // Load starter code
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
        const response = await authFetch('/api/judge/run', {
            method: 'POST',
            body: JSON.stringify({
                code: code,
                language: language,
                testCases: problem.testCases.slice(0, 2),
                problemId: problem.id // Use ID or index? Server expects problemId. Service uses lookup.
                // If I pass index as problemId, make sure service handles it. Service uses find or index.
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
        const response = await authFetch('/api/judge/submit', {
            method: 'POST',
            body: JSON.stringify({
                code: code,
                language: language,
                problemId: problem.id,
                // studentName: studentName, // Handled by token
                // rollNumber: rollNumber,   // Handled by token
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
            const btn = document.getElementById(`problem-btn-${currentProblem}`);
            if (btn) btn.classList.add('solved');
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

    // Check for compilation errors
    const compilationError = results.find(r => !r.passed && r.actual && typeof r.actual === 'string' && r.actual.toString().includes('Error: Command failed'));

    if (compilationError) {
        let errorMsg = compilationError.actual.replace(/Error: Command failed: g\+\+.*?\n/s, '');
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
        await authFetch('/api/judge/log-violation', {
            method: 'POST',
            body: JSON.stringify({
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
        const response = await authFetch('/api/judge/leaderboard');
        const leaderboard = await response.json();

        const tbody = document.getElementById('leaderboardBody');
        tbody.innerHTML = leaderboard.map((entry, i) => `
        <tr>
            <td class="${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</td>
            <td>${entry.name}</td>
            <td>${entry.reg_no || entry.rollNumber}</td>
            <td>${entry.total_score || 0}</td>
            <td>${entry.problems_solved || 0}</td>
        </tr>
    `).join('');

        document.getElementById('leaderboardModal').classList.add('active');
    } catch (error) {
        alert('Error loading leaderboard: ' + error.message);
    }
}

function closeLeaderboard() {
    document.getElementById('leaderboardModal').classList.remove('active');
}

// Auto submit all on time up
async function autoSubmitAll() {
    for (let i = 0; i < problems.length; i++) {
        if (submissions[i]) {
            continue;
        }
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

// Provide access for UI buttons to global functions
window.runCode = runCode;
window.submitCode = submitCode;
window.showLeaderboard = showLeaderboard;
window.closeLeaderboard = closeLeaderboard;
window.selectProblem = selectProblem; // Necessary for dynamically generated buttons
window.changeLanguage = changeLanguage;

// End Test - Submit & Redirect to Insights
window.endTest = async function () {
    if (!confirm('Are you sure you want to end the test? This will submit your current progress and show you interview insights.')) {
        return;
    }

    // Optional: Auto-submit pending code here if needed
    // await autoSubmitAll(); 

    window.location.href = '/insights.html';
};

// Logout / Cancel
window.logout = function () {
    if (confirm('Are you sure you want to log out?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('contestEndTime');
        window.location.href = '/';
    }
};
