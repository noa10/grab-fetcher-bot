function getHealthHTML(errorData) {
  const hasError = errorData && errorData.error;
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Health - Grab Order Fetcher</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --grab-green: #00b14f;
            --bg-primary: #f8fafc;
            --bg-secondary: #ffffff;
            --bg-tertiary: #f1f5f9;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #94a3b8;
            --border-color: #e2e8f0;
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07);
            --radius-md: 12px;
            --radius-sm: 8px;
            --status-ok: #10b981;
            --status-error: #ef4444;
            --status-warning: #f59e0b;
        }
        [data-theme="dark"] {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #cbd5e1;
            --text-muted: #64748b;
            --border-color: #334155;
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 24px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 32px;
        }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .header-logo {
            width: 48px; height: 48px;
            background: linear-gradient(135deg, var(--grab-green), #00d45f);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            font-size: 24px;
        }
        .header h1 { font-size: 24px; font-weight: 700; }
        .header p { font-size: 14px; color: var(--text-muted); }
        .theme-toggle {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 50%;
            width: 40px; height: 40px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: var(--text-secondary);
        }
        .overall-status {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 24px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .status-indicator {
            width: 48px; height: 48px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
        }
        .status-indicator.ok { background: rgba(16,185,129,0.1); color: var(--status-ok); }
        .status-indicator.error { background: rgba(239,68,68,0.1); color: var(--status-error); }
        .status-indicator.warning { background: rgba(245,158,11,0.1); color: var(--status-warning); }
        .status-text h2 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
        .status-text p { font-size: 13px; color: var(--text-muted); }
        .status-badge {
            margin-left: auto;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-badge.ok { background: rgba(16,185,129,0.1); color: var(--status-ok); }
        .status-badge.error { background: rgba(239,68,68,0.1); color: var(--status-error); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 20px;
        }
        .card-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 16px;
        }
        .card-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .card-status {
            width: 10px; height: 10px; border-radius: 50%;
        }
        .card-status.ok { background: var(--status-ok); }
        .card-status.error { background: var(--status-error); }
        .card-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
        .card-detail { font-size: 13px; color: var(--text-secondary); }
        .detail-list { display: flex; flex-direction: column; gap: 8px; }
        .detail-item {
            display: flex; justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-color);
            font-size: 13px;
        }
        .detail-item:last-child { border-bottom: none; }
        .detail-label { color: var(--text-muted); }
        .detail-value { font-weight: 500; font-family: 'SF Mono', 'Fira Code', monospace; }
        .refresh-bar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            font-size: 13px; color: var(--text-muted);
        }
        .refresh-btn {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: var(--text-secondary);
            display: flex; align-items: center; gap: 6px;
        }
        .refresh-btn:hover { background: var(--border-color); }
        .error-banner {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.2);
            border-radius: var(--radius-sm);
            padding: 16px;
            margin-bottom: 24px;
            color: var(--status-error);
            font-size: 14px;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .loading { animation: pulse 1.5s infinite; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-left">
                <div class="header-logo">🚗</div>
                <div>
                    <h1>System Health</h1>
                    <p>Grab Order Fetcher Bot</p>
                </div>
            </div>
            <button class="theme-toggle" id="themeToggle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="themeIcon"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            </button>
        </div>

        <div id="errorBanner" class="error-banner" style="display:${hasError ? 'block' : 'none'}">
            ⚠️ Error: ${hasError ? errorData.error : ''}
        </div>

        <div class="overall-status" id="overallStatus">
            <div class="status-indicator ${hasError ? 'error' : 'ok'}">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${hasError ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' : '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
                </svg>
            </div>
            <div class="status-text">
                <h2 id="overallText">${hasError ? 'System Error' : 'All Systems Operational'}</h2>
                <p id="overallTime">Last checked: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} MYT</p>
            </div>
            <span class="status-badge ${hasError ? 'error' : 'ok'}" id="overallBadge">${hasError ? 'ERROR' : 'HEALTHY'}</span>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Database</span>
                    <div class="card-status ok" id="dbStatus"></div>
                </div>
                <div class="card-value" id="dbText">Connected</div>
                <div class="card-detail" id="dbDetail">MongoDB connection active</div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Uptime</span>
                    <div class="card-status ok"></div>
                </div>
                <div class="card-value" id="uptimeValue">-</div>
                <div class="card-detail">Server runtime</div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Version</span>
                </div>
                <div class="card-value" id="versionValue">-</div>
                <div class="card-detail">Application version</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Memory Usage</span>
                </div>
                <div class="detail-list" id="memoryDetails">
                    <div class="detail-item"><span class="detail-label">RSS</span><span class="detail-value" id="memRss">-</span></div>
                    <div class="detail-item"><span class="detail-label">Heap Total</span><span class="detail-value" id="memHeapTotal">-</span></div>
                    <div class="detail-item"><span class="detail-label">Heap Used</span><span class="detail-value" id="memHeapUsed">-</span></div>
                    <div class="detail-item"><span class="detail-label">External</span><span class="detail-value" id="memExternal">-</span></div>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">System Info</span>
                </div>
                <div class="detail-list">
                    <div class="detail-item"><span class="detail-label">Node.js</span><span class="detail-value" id="nodeVersion">${process.version}</span></div>
                    <div class="detail-item"><span class="detail-label">Platform</span><span class="detail-value">${process.platform}</span></div>
                    <div class="detail-item"><span class="detail-label">PID</span><span class="detail-value">${process.pid}</span></div>
                    <div class="detail-item"><span class="detail-label">Deployment</span><span class="detail-value">${process.env.VERCEL ? 'Vercel' : 'Standalone'}</span></div>
                </div>
            </div>
        </div>

        <div class="refresh-bar">
            <span>Auto-refreshing every 30 seconds</span>
            <button class="refresh-btn" id="refreshBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                Refresh Now
            </button>
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

        function formatBytes(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1048576).toFixed(1) + ' MB';
        }

        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            if (days > 0) return days + 'd ' + hours + 'h';
            if (hours > 0) return hours + 'h ' + mins + 'm';
            return mins + 'm';
        }

        async function fetchHealth() {
            try {
                const res = await fetch('/health', { headers: { 'Accept': 'application/json' } });
                const data = await res.json();

                const isOk = data.status === 'ok';
                document.getElementById('overallText').textContent = isOk ? 'All Systems Operational' : 'System Error';
                document.getElementById('overallBadge').textContent = isOk ? 'HEALTHY' : 'ERROR';
                document.getElementById('overallBadge').className = 'status-badge ' + (isOk ? 'ok' : 'error');
                document.querySelector('.status-indicator').className = 'status-indicator ' + (isOk ? 'ok' : 'error');
                document.getElementById('overallTime').textContent = 'Last checked: ' + new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) + ' MYT';

                if (data.uptime) document.getElementById('uptimeValue').textContent = formatUptime(data.uptime);
                if (data.version) document.getElementById('versionValue').textContent = data.version;

                if (data.database) {
                    const dbOk = data.database.status === 'connected';
                    document.getElementById('dbStatus').className = 'card-status ' + (dbOk ? 'ok' : 'error');
                    document.getElementById('dbText').textContent = dbOk ? 'Connected' : (data.database.status || 'Unknown');
                    document.getElementById('dbDetail').textContent = data.database.message || '';
                }

                if (data.memory) {
                    document.getElementById('memRss').textContent = formatBytes(data.memory.rss);
                    document.getElementById('memHeapTotal').textContent = formatBytes(data.memory.heapTotal);
                    document.getElementById('memHeapUsed').textContent = formatBytes(data.memory.heapUsed);
                    document.getElementById('memExternal').textContent = formatBytes(data.memory.external);
                }
            } catch (e) {
                console.error('Health fetch error:', e);
            }
        }

        document.getElementById('refreshBtn').addEventListener('click', fetchHealth);
        setInterval(fetchHealth, 30000);
    </script>
</body>
</html>`;
}

module.exports = getHealthHTML;
