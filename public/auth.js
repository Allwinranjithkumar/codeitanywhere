const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginFormElement = document.querySelector('#loginForm form') || document.getElementById('loginForm');
const registerFormElement = document.querySelector('#registerForm form') || document.getElementById('registerForm');

// Elements
const loginBtn = loginForm.querySelector('button');
const regBtn = registerForm.querySelector('button');
const loginError = document.getElementById('loginError') || document.querySelector('#loginForm .error-msg');
const regError = document.getElementById('regError') || document.querySelector('#registerForm .error-msg');

// Constants
const REG_NO_REGEX = /^7155\d{2}1050\d{2}$/;
const EMAIL_DOMAIN = '@psgitech.ac.in';

function toggleForm() {
    loginForm.classList.toggle('hidden');
    registerForm.classList.toggle('hidden');
    if (loginError) loginError.textContent = '';
    if (regError) regError.textContent = '';

    // Clear inputs
    document.querySelectorAll('input').forEach(input => input.value = '');
}

// Attach event listeners to the switch links
document.querySelectorAll('.switch-form span').forEach(span => {
    span.onclick = toggleForm;
});

// Login Handler
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginError) loginError.textContent = 'Logging in...';
    loginBtn.disabled = true;

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            if (data.user.role === 'admin') {
                window.location.href = '/admin.html';
            } else {
                window.location.href = '/contest.html';
            }
        } else {
            if (loginError) loginError.textContent = data.error || 'Login failed';
        }
    } catch (err) {
        console.error(err);
        if (loginError) loginError.textContent = 'Network error. Please try again.';
    } finally {
        loginBtn.disabled = false;
    }
});

// Register Handler
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (regError) regError.textContent = 'Registering...';
    regBtn.disabled = true;

    const name = document.getElementById('regName').value;
    const regNo = document.getElementById('regNo').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;

    // Client-side Validation
    if (!REG_NO_REGEX.test(regNo)) {
        if (regError) regError.textContent = 'Invalid Register Number format (7155xx1050xx)';
        regBtn.disabled = false;
        return;
    }

    if (!email.endsWith(EMAIL_DOMAIN)) {
        if (regError) regError.textContent = `Email must end with ${EMAIL_DOMAIN}`;
        regBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, reg_no: regNo, email, password })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Registration Successful! Please login.');
            toggleForm();
        } else {
            console.log(data);
            if (regError) regError.textContent = data.error || 'Registration failed';
        }
    } catch (err) {
        console.error(err);
        if (regError) regError.textContent = 'Network error. Please try again.';
    } finally {
        regBtn.disabled = false;
    }
});
