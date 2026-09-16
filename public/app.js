/**
 * app.js — Contest frontend logic
 *
 * Timer is display-only. All contest validation is server-authoritative.
 * The server enforces submission windows, not the browser timer.
 *
 * API calls use JWT from localStorage for every authenticated request.
 */

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

const token = localStorage.getItem('token');
const userStr = localStorage.getItem('user');
let user = {};
try { user = JSON.parse(userStr || '{}'); } catch (_) { }

let editor = null;
let problems = [];
let currentIndex = 0;
let contestId = null;
let contestEndTime = null;
let timerInterval = null;
let savedCode = {};   // { [problemIndex]: { code, language } }
let antiCheatEnabled = true;

// ──────────────────────────────────────────────
// Auth Guard
// ──────────────────────────────────────────────

if (!token) { window.location.href = '/index.html'; }

// ──────────────────────────────────────────────
// Authenticated Fetch Helper
// ──────────────────────────────────────────────

async function authFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });
    if (res.status === 401 || res.status === 403) {
        localStorage.clear();
        window.location.href = '/index.html';
    }
    return res;
}

// ──────────────────────────────────────────────
// Initialise
// ──────────────────────────────────────────────

async function init() {
    // Show student info
    document.getElementById('studentDisplay').textContent =
        `${user.name || 'Student'} (${user.reg_no || ''})`;

    initEditor();

    // Load active contest
    try {
        const res = await authFetch('/api/contests/active');
        const data = await res.json();

        if (data.active && data.contest) {
            contestId = data.contest.id;
            contestEndTime = new Date(data.contest.end_time);
            antiCheatEnabled = data.contest.anti_cheat;

            // Join the contest (no-op if already joined)
            await authFetch(`/api/contests/${contestId}/join`, { method: 'POST' });

            // Load problems for this contest
            await loadProblems(contestId);
        } else {
            // No active contest — load all problems globally
            await loadProblems(null);
        }
    } catch (err) {
        console.error('Init error:', err);
        await loadProblems(null);
    }

    startTimer();
    if (antiCheatEnabled) enableAntiCheat();
}

// ──────────────────────────────────────────────
// Editor
// ──────────────────────────────────────────────

function initEditor() {
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

function changeLanguage() {
    const lang = document.getElementById('languageSelect').value;
    const modeMap = {
        python: 'python', javascript: 'javascript',
        cpp: 'text/x-c++src', c: 'text/x-csrc', java: 'text/x-java'
    };
    editor.setOption('mode', modeMap[lang] || lang);

    const problem = problems[currentIndex];
    if (problem?.starterCode?.[lang]) {
        const existing = editor.getValue().trim();
        if (!existing) editor.setValue(problem.starterCode[lang]);
    }
}

// ──────────────────────────────────────────────
// Load Problems
// ──────────────────────────────────────────────

async function loadProblems(cId) {
    try {
        const url = cId ? `/api/contests/${cId}/problems` : '/api/judge/problems';
        const res = await authFetch(url);

        if (!res.ok) {
            document.getElementById('problemsContainer').innerHTML =
                '<p style="color:#ef4444;padding:20px;">No active contest or problems available.</p>';
            return;
        }

        problems = await res.json();
        renderProblemNav();
        if (problems.length > 0) selectProblem(0);
    } catch (err) {
        console.error('Load problems error:', err);
    }
}

function renderProblemNav() {
    const sel = document.getElementById('problemSelector');
    sel.innerHTML = '';
    problems.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.className = 'problem-btn';
        btn.id = `prob-btn-${i}`;
        btn.textContent = `P${i + 1}`;
        btn.title = p.title;
        btn.onclick = () => selectProblem(i);
        sel.appendChild(btn);
    });
}

function selectProblem(index) {
    if (!savedCode[currentIndex]) savedCode[currentIndex] = {};
    if (editor) {
        const currentLang = document.getElementById('languageSelect').value;
        savedCode[currentIndex][currentLang] = editor.getValue();
    }

    document.querySelectorAll('.problem-btn').forEach((b, i) => b.classList.toggle('active', i === index));

    currentIndex = index;
    const problem = problems[index];
    if (!problem) return;

    // Render problem
    document.getElementById('problemsContainer').innerHTML = `
        <div class="problem-content active">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <span class="problem-badge diff-${(problem.difficulty||'medium').toLowerCase()}">${problem.difficulty || 'Medium'}</span>
                <span class="problem-badge points-badge">${problem.points || 100} pts</span>
            </div>
            <h1 class="problem-title">${problem.title}</h1>
            <div class="problem-description">${problem.description}</div>
            ${renderTestCases(problem.testCases || [])}
        </div>
    `;

    // Load starter/saved code for selected language
    changeLanguage();
}

function renderTestCases(cases) {
    if (!cases.length) return '';
    return `<div class="test-cases space-y-3 mt-4">
        ${cases.map((tc, i) => {
            const inputStr = typeof tc.input === 'object'
                ? Object.entries(tc.input).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')
                : JSON.stringify(tc.input);
            return `<div class="example-card">
                <div class="example-title">Example ${i + 1}:</div>
                <div class="example-box">
                    <div><span class="label">Input:</span> ${inputStr}</div>
                    <div><span class="label">Output:</span> <span class="output-val">${JSON.stringify(tc.output)}</span></div>
                    ${tc.explanation ? `<div class="example-explanation" style="margin-top:6px;font-size:11.5px;color:var(--muted);"><strong style="color:var(--text);">Explanation:</strong> ${tc.explanation}</div>` : ''}
                </div>
            </div>`;
        }).join('')}
    </div>`;
}

// ──────────────────────────────────────────────
// Timer (display-only — server enforces timing)
// ──────────────────────────────────────────────

function startTimer() {
    const timerEl = document.getElementById('timer');
    if (!timerEl) return;

    function tick() {
        if (!contestEndTime) { timerEl.textContent = '--:--'; return; }
        const remaining = Math.max(0, Math.floor((contestEndTime - Date.now()) / 1000));
        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
        timerEl.classList.toggle('warning', remaining < 300 && remaining > 0);

        if (remaining === 0) {
            clearInterval(timerInterval);
            timerEl.textContent = '00:00';
            showBanner('⏰ Time is up! The contest has ended.', '#ef4444');
        }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
}

// ──────────────────────────────────────────────
// Run Code
// ──────────────────────────────────────────────

async function runCode() {
    const code = editor.getValue();
    const language = document.getElementById('languageSelect').value;

    if (!code.trim()) return alert('Write some code first!');

    const problem = problems[currentIndex];
    if (!problem) return;

    document.getElementById('outputSection').style.display = 'block';
    document.getElementById('results').innerHTML = '<p class="loading">⏳ Running sample tests...</p>';

    try {
        const res = await authFetch('/api/judge/run', {
            method: 'POST',
            body: JSON.stringify({ code, language, problemId: problem.id })
        });
        const data = await res.json();

        if (!res.ok) {
            document.getElementById('results').innerHTML =
                `<div class="result fail"><strong>Error:</strong> ${data.error}</div>`;
            return;
        }

        renderResults(data.results, true);
    } catch (err) {
        document.getElementById('results').innerHTML =
            `<div class="result fail">Connection error: ${err.message}</div>`;
    }
}

// ──────────────────────────────────────────────
// Submit Code
// ──────────────────────────────────────────────

async function submitCode() {
    const code = editor.getValue();
    const language = document.getElementById('languageSelect').value;
    const problem = problems[currentIndex];

    if (!code.trim()) return alert('Write some code first!');
    if (!problem) return;
    if (!confirm(`Submit solution for "${problem.title}"?`)) return;

    document.getElementById('outputSection').style.display = 'block';
    document.getElementById('results').innerHTML = '<p class="loading">⏳ Judging all test cases...</p>';

    try {
        const res = await authFetch('/api/judge/submit', {
            method: 'POST',
            body: JSON.stringify({
                code, language,
                problemId: problem.id,
                contestId: contestId || undefined
            })
        });
        const data = await res.json();

        if (!res.ok) {
            document.getElementById('results').innerHTML =
                `<div class="result fail"><strong>${data.status || 'Error'}:</strong> ${data.error}</div>`;
            return;
        }

        // Mark problem as solved if accepted
        if (data.allPassed) {
            document.getElementById(`prob-btn-${currentIndex}`)?.classList.add('solved');
        }

        // Show score summary
        const statusClass = data.allPassed ? 'pass' : 'fail';
        const summary = `<div class="result ${statusClass}" style="margin-bottom:12px;">
            <strong>${data.status}</strong> — ${data.passed}/${data.total} passed · ${data.score} pts · ${data.executionTimeMs}ms
        </div>`;
        document.getElementById('results').innerHTML = summary;
        renderResults(data.results, false, true);

    } catch (err) {
        document.getElementById('results').innerHTML =
            `<div class="result fail">Connection error: ${err.message}</div>`;
    }
}

function renderResults(results, isSample) {
    if (!results || !results.length) return;
    const container = document.getElementById('results');
    const rows = results.map((r, i) => {
        const inputDisplay = r.input === '[hidden]' ? '[hidden]'
            : (typeof r.input === 'object'
                ? Object.entries(r.input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
                : JSON.stringify(r.input));

        return `<div class="result ${r.passed ? 'pass' : 'fail'}">
            <strong>${isSample ? 'Example' : 'Test'} ${i + 1}:</strong> ${r.passed ? '✅ Passed' : '❌ Failed'}
            <br><small>Input: ${inputDisplay}</small>
            ${!r.passed && r.expected !== '[hidden]'
                ? `<br><small>Expected: ${JSON.stringify(r.expected)} · Got: ${JSON.stringify(r.actual)}</small>`
                : ''}
            ${r.error ? `<br><small style="color:#f87171;">Error: ${r.error}</small>` : ''}
        </div>`;
    });
    container.innerHTML += rows.join('');
}

// ──────────────────────────────────────────────
// Leaderboard
// ──────────────────────────────────────────────

async function showLeaderboard() {
    try {
        const url = contestId
            ? `/api/contests/${contestId}/leaderboard`
            : '/api/judge/leaderboard';
        const res = await authFetch(url);
        const data = await res.json();

        const tbody = document.getElementById('leaderboardBody');
        tbody.innerHTML = data.length === 0
            ? '<tr><td colspan="5" style="text-align:center;color:#64748b;">No submissions yet</td></tr>'
            : data.map((e, i) => `
                <tr>
                    <td class="${i < 3 ? `rank-${i + 1}` : ''}">${i + 1}</td>
                    <td>${e.name}</td>
                    <td>${e.reg_no}</td>
                    <td><strong>${e.total_score || 0}</strong></td>
                    <td>${e.problems_solved || 0}</td>
                </tr>`).join('');

        document.getElementById('leaderboardModal').classList.add('active');
    } catch (err) {
        alert('Error loading leaderboard: ' + err.message);
    }
}

function closeLeaderboard() {
    document.getElementById('leaderboardModal').classList.remove('active');
}

// ──────────────────────────────────────────────
// Anti-Cheat
// ──────────────────────────────────────────────

function enableAntiCheat() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) logViolation('tab_switch');
    });
    document.addEventListener('copy', () => logViolation('copy'));
    document.addEventListener('paste', () => {
        showBanner('⚠️ Paste detected — this violation has been logged.');
        logViolation('paste');
    });
    document.addEventListener('contextmenu', e => {
        e.preventDefault();
        logViolation('right_click');
    });
    window.addEventListener('blur', () => logViolation('blur'));
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
            const isEditorInput = e.target?.closest?.('.CodeMirror');
            if (!isEditorInput) {
                e.preventDefault();
                showBanner('⚠️ Copy/paste shortcuts are disabled outside the editor.');
                logViolation('copy');
            }
        }
        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
            e.preventDefault();
            showBanner('⚠️ Developer tools are disabled during the contest.');
            logViolation('devtools');
        }
    });
}

async function logViolation(type) {
    try {
        await authFetch('/api/judge/log-violation', {
            method: 'POST',
            body: JSON.stringify({ violationType: type, contestId: contestId || undefined })
        });
    } catch (_) { }
    showBanner(`⚠️ ${type.replace(/_/g, ' ')} detected — logged.`);
}

function showBanner(msg, color = '#ef4444') {
    const banner = document.getElementById('warningBanner');
    if (!banner) return;
    banner.textContent = msg;
    banner.style.background = color;
    banner.style.display = 'block';
    clearTimeout(banner._timeout);
    banner._timeout = setTimeout(() => { banner.style.display = 'none'; }, 3500);
}

// ──────────────────────────────────────────────
// Logout
// ──────────────────────────────────────────────

function logout() {
    if (confirm('Are you sure you want to log out?')) {
        localStorage.clear();
        window.location.href = '/index.html';
    }
}

function endTest() {
    if (confirm('End the test and submit all your solutions?')) {
        logout();
    }
}

// Prevent accidental navigation
window.addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });

// Start
init();
