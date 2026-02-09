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
    e.preventDefault();
    showWarning('Copy-paste is disabled during the contest!');
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
    setTimeout(() => {
        banner.style.display = 'none';
    }, 3000);
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
document.addEventListener('visibilitychange', function() {
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
document.addEventListener('keydown', function(e) {
    // Prevent Ctrl+C, Ctrl+V, Ctrl+X
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
        if (e.target !== document.getElementById('codeEditor').nextSibling.CodeMirror.getInputField()) {
            e.preventDefault();
            showWarning('Copy-paste shortcuts are disabled!');
        }
    }
    
    // Prevent F12, Ctrl+Shift+I (DevTools)
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        showWarning('Developer tools are disabled!');
    }
});

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
    editor.setOption('mode', language);
    
    // Load starter code for current problem and language
    const problem = problems[currentProblem];
    if (problem && problem.starterCode && problem.starterCode[language]) {
        // Only load if editor is empty or has default code
        const currentCode = editor.getValue().trim();
        if (!currentCode || currentCode === '' || 
            (submissions[currentProblem] && submissions[currentProblem].lastLanguage !== language)) {
            editor.setValue(problem.starterCode[language]);
        }
    }
}

// Load problems
async function loadProblems() {
    try {
        const response = await fetch('/api/problems');
        problems = await response.json();
        
        // Create problem buttons
        const selector = document.getElementById('problemSelector');
        const container = document.getElementById('problemsContainer');
        
        problems.forEach((problem, index) => {
            // Create button
            const btn = document.createElement('button');
            btn.className = 'problem-btn';
            btn.id = `problem-btn-${index}`;
            btn.textContent = `Problem ${index + 1}`;
            btn.onclick = () => selectProblem(index);
            selector.appendChild(btn);
            
            // Format test cases for display
            const sampleCases = problem.testCases.slice(0, 2).map((tc, i) => {
                const inputStr = Object.entries(tc.input)
                    .map(([key, val]) => `${key} = ${JSON.stringify(val)}`)
                    .join(', ');
                const outputStr = JSON.stringify(tc.output);
                
                return `
                    <div class="test-case">
                        <h4>Example ${i + 1}:</h4>
                        <pre><strong>Input:</strong> ${inputStr}</pre>
                        <pre><strong>Output:</strong> ${outputStr}</pre>
                    </div>
                `;
            }).join('');
            
            // Create problem content
            const content = document.createElement('div');
            content.className = 'problem-content';
            content.id = `problem-${index}`;
            content.innerHTML = `
                <h2 class="problem-title">${problem.title}</h2>
                <div class="problem-description">${problem.description}</div>
                <div class="test-cases">
                    ${sampleCases}
                </div>
            `;
            container.appendChild(content);
        });
        
        // Select first problem
        selectProblem(0);
    } catch (error) {
        console.error('Error loading problems:', error);
    }
}

// Select problem
function selectProblem(index) {
    // Save current code before switching
    if (currentProblem !== index && editor) {
        const currentLang = document.getElementById('languageSelect').value;
        if (!submissions[currentProblem]) {
            submissions[currentProblem] = {};
        }
        submissions[currentProblem].code = editor.getValue();
        submissions[currentProblem].lastLanguage = currentLang;
    }
    
    // Update buttons
    document.querySelectorAll('.problem-btn').forEach((btn, i) => {
        btn.classList.remove('active');
        if (i === index) btn.classList.add('active');
    });
    
    // Update content
    document.querySelectorAll('.problem-content').forEach((content, i) => {
        content.classList.remove('active');
        if (i === index) content.classList.add('active');
    });
    
    currentProblem = index;
    
    // Load saved code or starter code
    const language = document.getElementById('languageSelect').value;
    const problem = problems[index];
    
    if (submissions[index] && submissions[index].code) {
        // Load previously saved code
        editor.setValue(submissions[index].code);
    } else if (problem.starterCode && problem.starterCode[language]) {
        // Load starter code template
        editor.setValue(problem.starterCode[language]);
    } else {
        // Empty editor
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
    
    document.getElementById('outputSection').style.display = 'block';
    document.getElementById('results').innerHTML = '<p>Running sample tests...</p>';
    
    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                language: language,
                problemId: currentProblem
            })
        });
        
        const results = await response.json();
        displayResults(results, true);
    } catch (error) {
        document.getElementById('results').innerHTML = `<div class="result fail">Error: ${error.message}</div>`;
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
            result: result,
            lastLanguage: language
        };
        
        // Update UI
        if (result.allPassed) {
            document.getElementById(`problem-btn-${currentProblem}`).classList.add('solved');
            alert('✅ All test cases passed! Solution submitted successfully.');
        } else {
            alert(`❌ ${result.passed}/${result.total} test cases passed. Keep trying!`);
        }
        
        displayResults(result.results, false);
    } catch (error) {
        document.getElementById('results').innerHTML = `<div class="result fail">Error: ${error.message}</div>`;
    }
}

// Display results
function displayResults(results, isSample) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = results.map((result, i) => {
        const inputStr = Object.entries(result.input)
            .map(([key, val]) => `${key} = ${JSON.stringify(val)}`)
            .join(', ');
        
        return `
            <div class="result ${result.passed ? 'pass' : 'fail'}">
                <strong>${isSample ? 'Example' : 'Test Case'} ${i + 1}:</strong> ${result.passed ? '✅ Passed' : '❌ Failed'}
                <br><small>Input: ${inputStr}</small>
                ${!result.passed ? `<br><small>Expected: ${JSON.stringify(result.expected)}<br>Got: ${JSON.stringify(result.actual)}</small>` : ''}
            </div>
        `;
    }).join('');
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
        if (submissions[i] && submissions[i].result && submissions[i].result.allPassed) {
            // Already submitted and passed
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
