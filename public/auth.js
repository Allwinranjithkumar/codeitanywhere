/**
 * auth.js — Login & Registration frontend logic
 *
 * Security: No credentials are cached beyond localStorage token.
 * The password field has NO pre-filled default value.
 */

// ──────────────────────────────────────────────
// Tab Switching
// ──────────────────────────────────────────────

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tab === 'login' ? 'tabLogin' : 'tabRegister').classList.add('active');
    document.getElementById(tab === 'login' ? 'panelLogin' : 'panelRegister').classList.add('active');
    clearErrors();
}

function clearErrors() {
    document.querySelectorAll('.error-msg').forEach(el => {
        el.textContent = '';
        el.classList.remove('visible');
    });
}

function showError(id, message) {
    const el = document.getElementById(id);
    if (el) { el.textContent = message; el.classList.add('visible'); }
}

// ──────────────────────────────────────────────
// Login
// ──────────────────────────────────────────────

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('loginBtn');

    if (!email || !password) {
        return showError('loginError', 'Email and password are required.');
    }

    btn.disabled    = true;
    btn.textContent = 'Signing in...';

    try {
        const res  = await fetch('/api/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (res.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user',  JSON.stringify(data.user));
            // Route based on role
            window.location.href = data.user.role === 'admin' ? '/admin.html' : '/contest.html';
        } else {
            showError('loginError', data.error || 'Login failed.');
        }
    } catch (err) {
        showError('loginError', 'Connection error. Please try again.');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Sign In';
    }
});

// ──────────────────────────────────────────────
// Register
// ──────────────────────────────────────────────

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const name     = document.getElementById('regName').value.trim();
    const reg_no   = document.getElementById('regNo').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn      = document.getElementById('regBtn');

    if (!name || !email || !password) {
        return showError('regError', 'Name, email, and password are required.');
    }
    if (password.length < 6) {
        return showError('regError', 'Password must be at least 6 characters.');
    }

    btn.disabled    = true;
    btn.textContent = 'Creating account...';

    try {
        const res  = await fetch('/api/register', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, reg_no, email, password })
        });
        const data = await res.json();

        if (res.ok) {
            // Show success, switch to login tab
            switchTab('login');
            const loginError = document.getElementById('loginError');
            loginError.style.color  = '#10b981';
            loginError.style.background = 'rgba(16,185,129,0.08)';
            loginError.textContent  = '✅ ' + (data.message || 'Registration successful! Please sign in.');
            loginError.classList.add('visible');
            document.getElementById('loginEmail').value = email;
        } else {
            showError('regError', data.error || 'Registration failed.');
        }
    } catch (err) {
        showError('regError', 'Connection error. Please try again.');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Create Account';
    }
});

// Redirect if already logged in
(function checkAuth() {
    const token = localStorage.getItem('token');
    const user  = localStorage.getItem('user');
    if (token && user) {
        try {
            const u = JSON.parse(user);
            window.location.href = u.role === 'admin' ? '/admin.html' : '/contest.html';
        } catch (_) {
            localStorage.clear();
        }
    }
})();
