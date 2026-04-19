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
            --grab-green-dark: #009640;
            --grab-green-light: #00d45f;
            --bg-primary: #f8fafc;
            --bg-secondary: #ffffff;
            --bg-tertiary: #f1f5f9;
            --bg-card: #ffffff;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #94a3b8;
            --border-color: #e2e8f0;
            --border-light: #f1f5f9;
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --sidebar-width: 260px;
            --sidebar-collapsed: 64px;
            --header-height: 64px;
            --status-ok: #10b981;
            --status-error: #ef4444;
            --status-warning: #f59e0b;
            --status-cancelled: #ef4444;
        }
        [data-theme="dark"] {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --bg-card: #1e293b;
            --text-primary: #f1f5f9;
            --text-secondary: #cbd5e1;
            --text-muted: #64748b;
            --border-color: #334155;
            --border-light: #1e293b;
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
        }
        .sidebar {
            position: sticky;
            top: 0;
            height: 100vh;
            width: var(--sidebar-width);
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-color);
            padding: 20px 0;
            z-index: 100;
            display: flex;
            flex-direction: column;
            transition: width 0.3s ease;
            flex-shrink: 0;
            overflow: hidden;
        }
        .sidebar.collapsed { width: var(--sidebar-collapsed); }
        .sidebar-header {
            padding: 0 20px 24px;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }
        .sidebar-logo-icon {
            width: 40px;
            height: 40px;
            min-width: 40px;
            min-height: 40px;
            background: linear-gradient(135deg, var(--grab-green), var(--grab-green-light));
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            line-height: 1;
            flex-shrink: 0;
        }
        .sidebar-logo-text { white-space: nowrap; transition: opacity 0.2s ease, width 0.2s ease; overflow: hidden; }
        .sidebar.collapsed .sidebar-logo-text { opacity: 0; pointer-events: none; width: 0; }
        .sidebar-logo-text h1 { font-size: 16px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
        .sidebar-logo-text span { font-size: 11px; color: var(--text-muted); font-weight: 500; }
        .sidebar-collapse-btn {
            background: none;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: var(--text-muted);
            transition: all 0.15s ease;
            flex-shrink: 0;
        }
        .sidebar-collapse-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        .sidebar.collapsed .sidebar-collapse-btn svg { transform: rotate(180deg); }
        .sidebar-collapse-btn svg { transition: transform 0.3s ease; }
        .sidebar-nav { flex: 1; padding: 8px 12px; overflow-y: auto; }
        .nav-item {
            position: relative;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            margin-bottom: 4px;
            white-space: nowrap;
        }
        .nav-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        .nav-item.active { background: var(--grab-green); color: white; }
        .nav-item svg { width: 20px; height: 20px; flex-shrink: 0; }
        .nav-item .nav-text { transition: opacity 0.2s ease; }
        .sidebar.collapsed .nav-item .nav-text { position: absolute; opacity: 0; pointer-events: none; width: 0; overflow: hidden; white-space: nowrap; }
        .sidebar.collapsed .nav-item { justify-content: center; padding: 10px; color: var(--text-primary); }
        .sidebar.collapsed .nav-item:hover { color: var(--grab-green); }
        .sidebar.collapsed .nav-item.active { color: white; }
        .sidebar.collapsed .nav-item svg { stroke: var(--text-primary); }
        .sidebar.collapsed .nav-item:hover svg { stroke: var(--grab-green); }
        .sidebar.collapsed .nav-item.active svg { stroke: white; }
        .sidebar.collapsed .sidebar-header { padding: 16px 12px 24px; flex-direction: column; align-items: center; gap: 8px; }
        .sidebar.collapsed .sidebar-logo { justify-content: center; gap: 0; flex: 0 0 auto; min-width: 36px; }
        .sidebar.collapsed .sidebar-logo-icon { width: 36px; height: 36px; min-width: 36px; min-height: 36px; font-size: 18px; }
        .sidebar.collapsed .sidebar-logo-icon svg { width: 20px; height: 20px; }
        .sidebar.collapsed .sidebar-footer { opacity: 0; }
        .sidebar-footer {
            padding: 16px 20px;
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-muted);
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .app-layout { display: flex; min-height: 100vh; }
        .main-content { flex: 1; min-width: 0; }
        .header {
            position: sticky;
            top: 0;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 0 24px;
            height: var(--header-height);
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 50;
            backdrop-filter: blur(12px);
        }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .mobile-menu-btn {
            display: none;
            background: none;
            border: none;
            color: var(--text-primary);
            cursor: pointer;
            padding: 8px;
        }
        .header-title h2 { font-size: 18px; font-weight: 600; }
        .header-title p { font-size: 12px; color: var(--text-muted); }
        .header-right { display: flex; align-items: center; gap: 12px; }
        .theme-toggle {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: var(--text-secondary);
            transition: all 0.15s ease;
        }
        .theme-toggle:hover { background: var(--border-color); }
        .refresh-btn {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            color: var(--text-secondary);
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
        }
        .refresh-btn:hover { background: var(--border-color); }
        .btn-label { transition: opacity 0.15s ease, width 0.15s ease; overflow: hidden; white-space: nowrap; }
        .content-area { padding: 24px; }
        .sidebar-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 99;
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
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 20px;
            transition: all 0.15s ease;
        }
        .card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
        .card-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 16px;
        }
        .card-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .card-status { width: 10px; height: 10px; border-radius: 50%; }
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
        @media (max-width: 768px) {
            .sidebar { position: fixed; transform: translateX(-100%); width: var(--sidebar-width); z-index: 200; }
            .sidebar.open { transform: translateX(0); }
            .sidebar.collapsed { transform: translateX(-100%); width: var(--sidebar-width); }
            .sidebar.collapsed.open { transform: translateX(0); width: var(--sidebar-width); }
            .sidebar-overlay.show { display: block; }
            .main-content { margin-left: 0; }
            .mobile-menu-btn { display: block; }
            .header { padding: 0 16px; }
            .header-right { gap: 8px; }
            .refresh-btn { padding: 8px; }
            .refresh-btn .btn-label { display: none; }
            .content-area { padding: 16px; }
        }
        @media (max-width: 480px) {
            .content-area { padding: 12px; }
            .nav-item { padding: 12px 10px; }
        }
    </style>
</head>
<body>
    <div class="app-layout">
        <div class="sidebar-overlay" id="sidebarOverlay"></div>

        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">
                    <div class="sidebar-logo-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 01-2-2V9a2 2 0 012-2h1l2-3h8l2 3h1a2 2 0 012 2v6a2 2 0 01-2 2M5 17v2m14-2v2"/><circle cx="7.5" cy="14.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/></svg></div>
                    <div class="sidebar-logo-text">
                        <h1>Grab Orders</h1>
                        <span>Fetcher Dashboard</span>
                    </div>
                </div>
                <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Toggle sidebar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
            </div>
            <nav class="sidebar-nav">
                <a class="nav-item" href="/dashboard">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    <span class="nav-text">Dashboard</span>
                </a>
                <a class="nav-item" href="/dashboard?view=orders">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    <span class="nav-text">All Orders</span>
                </a>
                <a class="nav-item" href="/dashboard?view=marketing">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                    <span class="nav-text">Marketing</span>
                </a>
                <a class="nav-item active" href="/health">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span class="nav-text">Health Check</span>
                </a>
            </nav>
            <div class="sidebar-footer">
                <span>System Monitor</span>
            </div>
        </aside>

        <main class="main-content">
            <header class="header">
                <div class="header-left">
                    <button class="mobile-menu-btn" id="mobileMenuBtn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                    </button>
                    <div class="header-title">
                        <h2>System Health</h2>
                        <p>Grab Order Fetcher Bot</p>
                    </div>
                </div>
                <div class="header-right">
                    <button class="theme-toggle" id="themeToggle" title="Toggle theme">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="themeIcon"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                    </button>
                    <button class="refresh-btn" id="refreshBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                        <span class="btn-label">Refresh</span>
                    </button>
                </div>
            </header>

            <div class="content-area">
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
                </div>
            </div>
        </main>
    </div>

    <script>
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);

        const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        if (sidebarCollapsed) {
            document.getElementById('sidebar').classList.add('collapsed');
        }

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

        document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });

        document.getElementById('mobileMenuBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('show');
        });

        document.getElementById('sidebarOverlay').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('show');
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
