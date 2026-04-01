function getLoginHTML() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Grab Order Fetcher</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --grab-green: #00b14f;
            --grab-green-dark: #009640;
            --grab-green-light: #00d45f;
            --bg-primary: #f8fafc;
            --bg-secondary: #ffffff;
            --bg-tertiary: #f1f5f9;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #94a3b8;
            --border-color: #e2e8f0;
            --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05);
            --radius-md: 12px;
            --radius-sm: 8px;
            --status-error: #ef4444;
            --status-success: #10b981;
        }

        [data-theme="dark"] {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #cbd5e1;
            --text-muted: #64748b;
            --border-color: #334155;
            --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .login-container {
            width: 100%;
            max-width: 420px;
        }

        .login-header {
            text-align: center;
            margin-bottom: 32px;
        }

        .login-logo {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, var(--grab-green), var(--grab-green-light));
            border-radius: 16px;
            margin-bottom: 16px;
            font-size: 28px;
        }

        .login-header h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .login-header p {
            color: var(--text-muted);
            font-size: 14px;
        }

        .login-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 32px;
            box-shadow: var(--shadow-lg);
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }

        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 14px;
            font-family: inherit;
            outline: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .form-input:focus {
            border-color: var(--grab-green);
            box-shadow: 0 0 0 3px rgba(0,177,79,0.1);
        }

        .form-input.error {
            border-color: var(--status-error);
        }

        .form-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
        }

        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
        }

        .checkbox-label input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--grab-green);
            cursor: pointer;
        }

        .forgot-link {
            font-size: 13px;
            color: var(--grab-green);
            text-decoration: none;
            font-weight: 500;
        }

        .forgot-link:hover { text-decoration: underline; }

        .btn {
            width: 100%;
            padding: 12px 16px;
            border: none;
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .btn-primary {
            background: var(--grab-green);
            color: white;
        }

        .btn-primary:hover { background: var(--grab-green-dark); }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

        .btn-secondary {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
        }

        .btn-secondary:hover { background: var(--border-color); }

        .alert {
            padding: 12px 16px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            margin-bottom: 20px;
            display: none;
        }

        .alert-error {
            background: rgba(239,68,68,0.1);
            color: var(--status-error);
            border: 1px solid rgba(239,68,68,0.2);
        }

        .alert-success {
            background: rgba(16,185,129,0.1);
            color: var(--status-success);
            border: 1px solid rgba(16,185,129,0.2);
        }

        .alert.show { display: block; }

        .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(4px);
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            z-index: 100;
        }

        .modal-overlay.active { display: flex; }

        .modal {
            background: var(--bg-secondary);
            border-radius: var(--radius-md);
            width: 100%;
            max-width: 400px;
            padding: 32px;
            box-shadow: var(--shadow-lg);
        }

        .modal h3 {
            font-size: 18px;
            margin-bottom: 8px;
        }

        .modal p {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 20px;
        }

        .modal-actions {
            display: flex;
            gap: 12px;
            margin-top: 20px;
        }

        .modal-actions .btn { flex: 1; }

        .reset-code-display {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 16px;
            text-align: center;
            margin: 16px 0;
        }

        .reset-code-display .code {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 4px;
            color: var(--grab-green);
            font-family: 'SF Mono', 'Fira Code', monospace;
        }

        .reset-code-display .note {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 8px;
        }

        .theme-toggle {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: var(--text-secondary);
        }

        .loading-spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }

        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <button class="theme-toggle" id="themeToggle" title="Toggle theme">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="themeIcon">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
    </button>

    <div class="login-container">
        <div class="login-header">
            <div class="login-logo">🚗</div>
            <h1>Grab Orders</h1>
            <p>Sign in to access your dashboard</p>
        </div>

        <div class="login-card">
            <div class="alert alert-error" id="loginError"></div>

            <form id="loginForm">
                <div class="form-group">
                    <label class="form-label" for="username">Username</label>
                    <input type="text" class="form-input" id="username" name="username" autocomplete="username" placeholder="Enter your username" required>
                </div>

                <div class="form-group">
                    <label class="form-label" for="password">Password</label>
                    <input type="password" class="form-input" id="password" name="password" autocomplete="current-password" placeholder="Enter your password" required>
                </div>

                <div class="form-row">
                    <label class="checkbox-label">
                        <input type="checkbox" id="rememberMe" name="rememberMe">
                        Remember me
                    </label>
                    <a href="#" class="forgot-link" id="forgotLink">Forgot password?</a>
                </div>

                <button type="submit" class="btn btn-primary" id="loginBtn">Sign In</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="forgotModal">
        <div class="modal">
            <h3>Reset Password</h3>
            <p>Enter your username to generate a reset code. Use the code below with your new password.</p>

            <div class="alert alert-error" id="forgotError"></div>
            <div class="alert alert-success" id="forgotSuccess"></div>

            <div id="forgotStep1">
                <div class="form-group">
                    <label class="form-label" for="resetUsername">Username</label>
                    <input type="text" class="form-input" id="resetUsername" placeholder="Enter your username">
                </div>
                <button class="btn btn-primary" id="generateCodeBtn">Generate Reset Code</button>
            </div>

            <div id="forgotStep2" style="display:none;">
                <div class="reset-code-display">
                    <div class="code" id="resetCode"></div>
                    <div class="note">This code expires in 15 minutes</div>
                </div>

                <div class="form-group">
                    <label class="form-label" for="newPassword">New Password</label>
                    <input type="password" class="form-input" id="newPassword" placeholder="Enter new password (min 6 characters)">
                </div>

                <button class="btn btn-primary" id="resetPasswordBtn">Reset Password</button>
            </div>

            <div class="modal-actions">
                <button class="btn btn-secondary" id="closeModal">Close</button>
            </div>
        </div>
    </div>

    <script>
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);

        function updateThemeIcon(theme) {
            const icon = document.getElementById('themeIcon');
            if (theme === 'dark') {
                icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
            } else {
                icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
            }
        }

        document.getElementById('themeToggle').addEventListener('click', () => {
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcon(next);
        });

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            const errorEl = document.getElementById('loginError');
            errorEl.classList.remove('show');

            btn.disabled = true;
            btn.innerHTML = '<span class="loading-spinner"></span>Signing in...';

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('username').value,
                        password: document.getElementById('password').value,
                        rememberMe: document.getElementById('rememberMe').checked
                    })
                });

                const data = await res.json();

                if (data.success) {
                    window.location.href = '/dashboard';
                } else {
                    errorEl.textContent = data.message || 'Login failed';
                    errorEl.classList.add('show');
                }
            } catch (err) {
                errorEl.textContent = 'Connection error. Please try again.';
                errorEl.classList.add('show');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Sign In';
            }
        });

        document.getElementById('forgotLink').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('forgotModal').classList.add('active');
            document.getElementById('forgotStep1').style.display = 'block';
            document.getElementById('forgotStep2').style.display = 'none';
            document.getElementById('forgotError').classList.remove('show');
            document.getElementById('forgotSuccess').classList.remove('show');
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            document.getElementById('forgotModal').classList.remove('active');
        });

        document.getElementById('generateCodeBtn').addEventListener('click', async () => {
            const username = document.getElementById('resetUsername').value.trim();
            if (!username) {
                document.getElementById('forgotError').textContent = 'Username is required';
                document.getElementById('forgotError').classList.add('show');
                return;
            }

            try {
                const res = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });

                const data = await res.json();

                if (data.success) {
                    document.getElementById('resetCode').textContent = data.resetCode || '------';
                    document.getElementById('forgotStep1').style.display = 'none';
                    document.getElementById('forgotStep2').style.display = 'block';
                    document.getElementById('forgotSuccess').textContent = 'Reset code generated. Enter a new password below.';
                    document.getElementById('forgotSuccess').classList.add('show');
                    document.getElementById('forgotError').classList.remove('show');
                } else {
                    document.getElementById('forgotError').textContent = data.message;
                    document.getElementById('forgotError').classList.add('show');
                }
            } catch (err) {
                document.getElementById('forgotError').textContent = 'Connection error';
                document.getElementById('forgotError').classList.add('show');
            }
        });

        document.getElementById('resetPasswordBtn').addEventListener('click', async () => {
            const username = document.getElementById('resetUsername').value.trim();
            const token = document.getElementById('resetCode').textContent.trim();
            const newPassword = document.getElementById('newPassword').value;

            if (!username || !token || !newPassword) {
                document.getElementById('forgotError').textContent = 'All fields are required';
                document.getElementById('forgotError').classList.add('show');
                return;
            }

            try {
                const res = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, token, newPassword })
                });

                const data = await res.json();

                if (data.success) {
                    document.getElementById('forgotSuccess').textContent = 'Password reset successful! You can now sign in.';
                    document.getElementById('forgotSuccess').classList.add('show');
                    document.getElementById('forgotError').classList.remove('show');
                    setTimeout(() => {
                        document.getElementById('forgotModal').classList.remove('active');
                    }, 2000);
                } else {
                    document.getElementById('forgotError').textContent = data.message;
                    document.getElementById('forgotError').classList.add('show');
                }
            } catch (err) {
                document.getElementById('forgotError').textContent = 'Connection error';
                document.getElementById('forgotError').classList.add('show');
            }
        });
    </script>
</body>
</html>`;
}

module.exports = getLoginHTML;
