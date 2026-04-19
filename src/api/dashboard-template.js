// Shared dashboard HTML template - used by both Vercel serverless and Express server
function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grab Order Fetcher Dashboard</title>
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
            --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
            --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05);
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --sidebar-width: 260px;
            --sidebar-collapsed: 64px;
            --header-height: 64px;
            --status-pending: #f59e0b;
            --status-confirmed: #3b82f6;
            --status-preparing: #8b5cf6;
            --status-ready: #06b6d4;
            --status-picked-up: #f97316;
            --status-delivered: #10b981;
            --status-completed: #00b14f;
            --status-cancelled: #ef4444;
            --status-unknown: #6b7280;
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
            --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3);
            --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.3);
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

        .sidebar-logo-text h1 {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-primary);
            line-height: 1.2;
        }

        .sidebar-logo-text span {
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 500;
        }

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

        .app-layout {
            display: flex;
            min-height: 100vh;
        }

        .main-content {
            flex: 1;
            min-width: 0;
        }

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
        .refresh-btn.loading svg { animation: spin 1s linear infinite; }

        .logout-btn {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            color: var(--text-secondary);
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
        }
        .logout-btn:hover { background: rgba(239,68,68,0.1); color: var(--status-cancelled); border-color: var(--status-cancelled); }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .content-area { padding: 24px; }

        .view { display: none; }
        .view.active { display: block; }

        .date-display {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            padding: 6px 12px;
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 24px;
        }
        .date-display svg { width: 16px; height: 16px; color: var(--grab-green); }
        .date-display .date-text { font-weight: 600; color: var(--text-primary); }
        .date-display .timezone { font-size: 11px; color: var(--text-muted); }

        .filter-bar {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 16px;
            margin-bottom: 24px;
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
        }

        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
            min-width: 150px;
        }

        .filter-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .filter-input, .filter-select {
            padding: 8px 12px;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            font-family: inherit;
            outline: none;
            transition: border-color 0.15s ease;
        }

        .filter-input:focus, .filter-select:focus {
            border-color: var(--grab-green);
            box-shadow: 0 0 0 3px rgba(0,177,79,0.1);
        }

        .filter-actions { display: flex; gap: 8px; align-items: flex-end; }

        .btn {
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
            text-decoration: none;
        }

        .btn-primary { background: var(--grab-green); color: white; }
        .btn-primary:hover { background: var(--grab-green-dark); }
        .btn-secondary { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
        .btn-secondary:hover { background: var(--border-color); }
        .btn-sm { padding: 6px 12px; font-size: 12px; }
        .btn-label { transition: opacity 0.15s ease, width 0.15s ease; overflow: hidden; white-space: nowrap; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .marketing-tables-grid { display: grid; grid-template-columns: 1fr 1fr; margin-top: 16px; gap: 16px; }
        .compact-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .compact-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .compact-table td { padding: 8px; border-bottom: 1px solid var(--border-light); font-size: 13px; }
        .compact-table tr:hover td { background: var(--bg-tertiary); }
        .notice-text { font-size: 11px; color: var(--text-muted); margin-top: 12px; text-align: center; }
        .empty-cell { text-align: center; padding: 24px; color: var(--text-muted); }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 20px;
            transition: all 0.15s ease;
        }

        .stat-card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }

        .stat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }

        .stat-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .stat-icon {
            width: 36px;
            height: 36px;
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
        }

        .stat-icon.green { background: rgba(0,177,79,0.1); }
        .stat-icon.blue { background: rgba(59,130,246,0.1); }
        .stat-icon.purple { background: rgba(139,92,246,0.1); }
        .stat-icon.orange { background: rgba(249,115,22,0.1); }
        .stat-icon.red { background: rgba(239,68,68,0.1); }
        .stat-icon.cyan { background: rgba(6,182,212,0.1); }

        .stat-value {
            font-size: 28px;
            font-weight: 700;
            color: var(--text-primary);
            line-height: 1;
            margin-bottom: 4px;
        }

        .stat-change { font-size: 12px; color: var(--text-muted); }
        .stat-change.positive { color: var(--grab-green); }
        .stat-change.negative { color: var(--status-cancelled); }

        .charts-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 16px;
            margin-bottom: 24px;
        }

        .chart-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 20px;
        }

        .chart-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .chart-title { font-size: 14px; font-weight: 600; }
        .chart-body { min-height: 200px; }
        .chart-container { position: relative; height: 280px; }

        .bar-chart {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            height: 180px;
            padding-top: 20px;
        }

        .bar-group {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }

        .bar {
            width: 100%;
            background: linear-gradient(180deg, var(--grab-green), var(--grab-green-dark));
            border-radius: 4px 4px 0 0;
            min-height: 4px;
            transition: height 0.3s ease;
            position: relative;
        }

        .bar:hover { opacity: 0.8; }

        .bar-label {
            font-size: 10px;
            color: var(--text-muted);
            white-space: nowrap;
        }

        .bar-value {
            position: absolute;
            top: -18px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 10px;
            font-weight: 600;
            color: var(--text-secondary);
            white-space: nowrap;
        }

        .status-list { display: flex; flex-direction: column; gap: 12px; }

        .status-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: var(--bg-tertiary);
            border-radius: var(--radius-sm);
        }

        .status-info { display: flex; align-items: center; gap: 10px; }

        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }

        .status-name { font-size: 13px; font-weight: 500; }
        .status-count { font-size: 14px; font-weight: 700; color: var(--text-primary); }

        .table-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            overflow: hidden;
        }

        .table-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
            gap: 12px;
        }

        .table-title { font-size: 16px; font-weight: 600; }
        .table-count { font-size: 13px; color: var(--text-muted); }

        .table-actions { display: flex; gap: 8px; flex-wrap: wrap; }

        .table-wrapper { overflow-x: auto; }

        table { width: 100%; border-collapse: collapse; }

        th {
            padding: 12px 16px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-color);
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }

        th:hover { color: var(--text-primary); }
        th.sorted { color: var(--grab-green); }

        td {
            padding: 14px 16px;
            font-size: 13px;
            border-bottom: 1px solid var(--border-light);
            white-space: nowrap;
        }

        tr:hover td { background: var(--bg-tertiary); }
        tr.clickable { cursor: pointer; }

        .order-number {
            font-weight: 600;
            color: var(--grab-green);
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
        }

        .customer-cell { display: flex; flex-direction: column; }
        .customer-name { font-weight: 500; }
        .customer-phone { font-size: 11px; color: var(--text-muted); }

        .driver-cell { display: flex; flex-direction: column; }
        .driver-name { font-weight: 500; }
        .driver-status { font-size: 11px; color: var(--text-muted); }

        .total-cell { font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: capitalize;
        }

        .status-badge::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
        }

        .status-badge.pending { background: rgba(245,158,11,0.1); color: #f59e0b; }
        .status-badge.pending::before { background: #f59e0b; }
        .status-badge.confirmed { background: rgba(59,130,246,0.1); color: #3b82f6; }
        .status-badge.confirmed::before { background: #3b82f6; }
        .status-badge.preparing { background: rgba(139,92,246,0.1); color: #8b5cf6; }
        .status-badge.preparing::before { background: #8b5cf6; }
        .status-badge.ready { background: rgba(6,182,212,0.1); color: #06b6d4; }
        .status-badge.ready::before { background: #06b6d4; }
        .status-badge.picked_up { background: rgba(249,115,22,0.1); color: #f97316; }
        .status-badge.picked_up::before { background: #f97316; }
        .status-badge.delivered { background: rgba(16,185,129,0.1); color: #10b981; }
        .status-badge.delivered::before { background: #10b981; }
        .status-badge.completed { background: rgba(0,177,79,0.1); color: #00b14f; }
        .status-badge.completed::before { background: #00b14f; }
        .status-badge.cancelled { background: rgba(239,68,68,0.1); color: #ef4444; }
        .status-badge.cancelled::before { background: #ef4444; }
        .status-badge.unknown { background: rgba(107,114,128,0.1); color: #6b7280; }
        .status-badge.unknown::before { background: #6b7280; }

        .order-type-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            text-transform: capitalize;
        }

        .time-cell { display: flex; flex-direction: column; }
        .time-date { font-weight: 500; }
        .time-relative { font-size: 11px; color: var(--text-muted); }

        .error-indicator {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--status-cancelled);
            font-size: 11px;
        }

        .pagination {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-top: 1px solid var(--border-color);
        }

        .pagination-info { font-size: 13px; color: var(--text-muted); }
        .pagination-controls { display: flex; gap: 8px; }

        .page-btn {
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .page-btn:hover:not(:disabled) { background: var(--bg-tertiary); }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .page-btn.active { background: var(--grab-green); color: white; border-color: var(--grab-green); }

        .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(4px);
            z-index: 200;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .modal-overlay.active { display: flex; }

        .modal {
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            width: 100%;
            max-width: 700px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: var(--shadow-lg);
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid var(--border-color);
        }

        .modal-title { font-size: 18px; font-weight: 600; }

        .modal-close {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 8px;
            border-radius: var(--radius-sm);
        }

        .modal-close:hover { background: var(--bg-tertiary); }
        .modal-body { padding: 24px; }

        .detail-section { margin-bottom: 24px; }
        .detail-section:last-child { margin-bottom: 0; }

        .detail-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .detail-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }

        .detail-item { display: flex; flex-direction: column; gap: 4px; }

        .detail-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .detail-value { font-size: 14px; color: var(--text-primary); }

        .items-table { width: 100%; border-collapse: collapse; }
        .items-table th { background: none; padding: 8px 12px; }
        .items-table td { padding: 10px 12px; border-bottom: none; }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
        }

        .empty-state svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }
        .empty-state h3 { font-size: 16px; margin-bottom: 8px; color: var(--text-secondary); }
        .empty-state p { font-size: 14px; }

        .loading-skeleton {
            background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--border-color) 50%, var(--bg-tertiary) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            border-radius: var(--radius-sm);
        }

        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 12px 20px;
            box-shadow: var(--shadow-lg);
            z-index: 300;
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s ease;
        }

        .toast.show { transform: translateY(0); opacity: 1; }

        .sidebar-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 99;
        }

        .show-all-btn {
            font-size: 12px;
            color: var(--grab-green);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px 8px;
            font-weight: 500;
        }
        .show-all-btn:hover { text-decoration: underline; }

        .period-selector {
            display: flex;
            gap: 4px;
            margin-left: 12px;
            background: var(--bg-primary);
            padding: 2px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-color);
        }
        .period-btn {
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .period-btn:hover { color: var(--text-primary); }
        .period-btn.active {
            background: var(--bg-secondary);
            color: var(--grab-green);
            box-shadow: var(--shadow-sm);
        }

        @media (max-width: 1024px) {
            .charts-grid { grid-template-columns: 1fr; }
            .marketing-tables-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 768px) {
            .sidebar { position: fixed; transform: translateX(-100%); width: var(--sidebar-width); z-index: 200; }
            .sidebar.open { transform: translateX(0); }
            .sidebar.collapsed { transform: translateX(-100%); width: var(--sidebar-width); }
            .sidebar.collapsed.open { transform: translateX(0); width: var(--sidebar-width); }
            .sidebar-overlay.show { display: block; }
            .main-content { margin-left: 0; }
            .mobile-menu-btn { display: block; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
            .filter-bar { flex-direction: column; }
            .filter-group { min-width: 100%; }
            .filter-actions { width: 100%; }
            .filter-actions .btn { flex: 1; justify-content: center; }
            .detail-grid { grid-template-columns: 1fr; }
            .marketing-tables-grid { grid-template-columns: 1fr; }
            .header { padding: 0 16px; }
            .header-right { gap: 8px; }
            .refresh-btn { padding: 8px; }
            .logout-btn { padding: 8px; }
            .refresh-btn .btn-label { display: none; }
            .logout-btn .btn-label { display: none; }
            .date-display { flex-wrap: wrap; gap: 4px; }
            .period-selector { margin-left: 0; width: 100%; margin-top: 4px; }
            .show-all-btn { margin-left: 0; }
            .pagination { flex-wrap: wrap; gap: 12px; justify-content: center; }
            .pagination-controls { flex-wrap: wrap; justify-content: center; }
            .chart-container { height: 220px; }
            .modal { margin: 12px; max-height: 85vh; }
            .toast { left: 16px; right: 16px; bottom: 16px; }
            .table-header { padding: 12px 16px; }
            .table-actions { width: 100%; }
            .table-actions .btn { flex: 1; justify-content: center; }
        }

        @media (max-width: 480px) {
            .stats-grid { grid-template-columns: 1fr; }
            .content-area { padding: 12px; }
            .stat-card { padding: 16px; }
            .stat-value { font-size: 22px; }
            .chart-card { padding: 16px; }
            .header-title h2 { font-size: 16px; }
            .filter-input, .filter-select { font-size: 16px; }
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
                <a class="nav-item active" data-view="dashboard">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    <span class="nav-text">Dashboard</span>
                </a>
                <a class="nav-item" data-view="orders">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    <span class="nav-text">All Orders</span>
                </a>
                <a class="nav-item" data-view="marketing">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                    <span class="nav-text">Marketing</span>
                </a>
                <a class="nav-item" href="/health">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span class="nav-text">Health Check</span>
                </a>
            </nav>
            <div class="sidebar-footer">
                <span id="lastUpdate">Loading...</span>
            </div>
        </aside>

        <main class="main-content">
            <header class="header">
                <div class="header-left">
                    <button class="mobile-menu-btn" id="mobileMenuBtn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                    </button>
                    <div class="header-title">
                        <h2 id="headerTitle">Dashboard</h2>
                        <p id="headerSubtitle">Overview of your order activity</p>
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
                    <button class="logout-btn" id="logoutBtn" title="Logout">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        <span class="btn-label">Logout</span>
                    </button>
                </div>
            </header>

            <div class="content-area">
                <div class="view active" id="dashboardView">
                    <div class="date-display">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>Data for: </span>
                        <span class="date-text" id="dashboardDate"></span>
                        <span class="timezone">(MYT GMT+8)</span>
                    </div>

                    <div class="stats-grid" id="statsGrid">
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Total Orders</span>
                                <div class="stat-icon green">📦</div>
                            </div>
                            <div class="stat-value" id="statTotalOrders">-</div>
                            <div class="stat-change" id="statTotalOrdersChange">All time</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Today's Orders</span>
                                <div class="stat-icon blue">📅</div>
                            </div>
                            <div class="stat-value" id="statTodayOrders">-</div>
                            <div class="stat-change" id="statTodayOrdersChange">-</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Total Revenue</span>
                                <div class="stat-icon purple">💰</div>
                            </div>
                            <div class="stat-value" id="statTotalRevenue">-</div>
                            <div class="stat-change" id="statTotalRevenueChange">All time</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Today's Revenue</span>
                                <div class="stat-icon orange">💵</div>
                            </div>
                            <div class="stat-value" id="statTodayRevenue">-</div>
                            <div class="stat-change" id="statTodayRevenueChange">-</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Avg Order Value</span>
                                <div class="stat-icon cyan">📊</div>
                            </div>
                            <div class="stat-value" id="statAvgOrder">-</div>
                            <div class="stat-change">Per order average</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">This Week</span>
                                <div class="stat-icon green">📈</div>
                            </div>
                            <div class="stat-value" id="statWeekOrders">-</div>
                            <div class="stat-change" id="statWeekRevenue">-</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">This Month</span>
                                <div class="stat-icon blue">🗓️</div>
                            </div>
                            <div class="stat-value" id="statMonthOrders">-</div>
                            <div class="stat-change" id="statMonthRevenue">-</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <span class="stat-label">Error Rate</span>
                                <div class="stat-icon red">⚠️</div>
                            </div>
                            <div class="stat-value" id="statErrorRate">-</div>
                            <div class="stat-change" id="statErrorCount">-</div>
                        </div>
                    </div>

                    <div class="charts-grid">
                        <div class="chart-card">
                            <div class="chart-header">
                                <h3 class="chart-title">Orders (Last 7 Days)</h3>
                            </div>
                            <div class="chart-body">
                                <div class="bar-chart" id="activityChart"></div>
                            </div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <h3 class="chart-title">Status Breakdown</h3>
                            </div>
                            <div class="chart-body">
                                <div class="status-list" id="statusList"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="view" id="ordersView">
                    <div class="date-display">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>Showing orders for: </span>
                        <span class="date-text" id="ordersDate"></span>
                        <span class="timezone">(MYT GMT+8)</span>
                        <div class="period-selector">
                            <button class="period-btn" data-period="today">Today</button>
                            <button class="period-btn active" data-period="7d">7 Days</button>
                            <button class="period-btn" data-period="30d">30 Days</button>
                        </div>
                        <button class="show-all-btn" id="showAllOrders">Show All Orders</button>
                    </div>

                    <div class="filter-bar" id="filterBar">
                        <div class="filter-group">
                            <label class="filter-label">Search</label>
                            <input type="text" class="filter-input" id="searchInput" placeholder="Order #, customer, driver...">
                        </div>
                        <div class="filter-group">
                            <label class="filter-label">Status</label>
                            <select class="filter-select" id="statusFilter">
                                <option value="">All Statuses</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label">Order Type</label>
                            <select class="filter-select" id="orderTypeFilter">
                                <option value="">All Types</option>
                                <option value="delivery">Delivery</option>
                                <option value="pickup">Pickup</option>
                                <option value="dine-in">Dine-in</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label">From Date</label>
                            <input type="date" class="filter-input" id="dateFrom">
                        </div>
                        <div class="filter-group">
                            <label class="filter-label">To Date</label>
                            <input type="date" class="filter-input" id="dateTo">
                        </div>
                        <div class="filter-actions">
                            <button class="btn btn-primary" id="applyFilters">Apply</button>
                            <button class="btn btn-secondary" id="clearFilters">Clear</button>
                        </div>
                    </div>

                    <div class="table-card">
                        <div class="table-header">
                            <div>
                                <h3 class="table-title">Orders</h3>
                                <span class="table-count" id="tableCount">Loading...</span>
                            </div>
                            <div class="table-actions">
                                <button class="btn btn-secondary btn-sm" id="exportCsvBtn">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Export CSV
                                </button>
                                <button class="btn btn-secondary btn-sm" id="exportJsonBtn">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                    Export JSON
                                </button>
                            </div>
                        </div>
                        <div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th data-sort="orderTimestamp" class="sorted">Order #</th>
                                        <th data-sort="customer">Customer</th>
                                        <th>Restaurant</th>
                                        <th>Driver</th>
                                        <th>Type</th>
                                        <th data-sort="total">Total</th>
                                        <th data-sort="status">Status</th>
                                        <th>Order Time</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody id="ordersTableBody">
                                    <tr><td colspan="9" class="empty-state"><div class="loading-skeleton" style="height:200px;"></div></td></tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="pagination">
                            <div class="pagination-info" id="paginationInfo">Showing 0 of 0 orders</div>
                            <div class="pagination-controls" id="paginationControls"></div>
                        </div>
                    </div>
                </div>

                <div class="view" id="marketingView">
                    <div class="date-display">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>Marketing Analytics &mdash; </span>
                        <span class="date-text" id="marketingDate"></span>
                        <span class="timezone">(MYT GMT+8)</span>
                    </div>

                    <div class="stats-grid" id="marketingKpis">
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">Total Customers</span><span class="stat-icon green">&#128101;</span></div><div class="stat-value" id="kpiTotalCustomers">-</div><div class="stat-change" id="kpiTotalCustomersChange"></div></div>
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">Avg Order Value</span><span class="stat-icon blue">&#36;</span></div><div class="stat-value" id="kpiAvgOrderValue">-</div><div class="stat-change" id="kpiAvgOrderValueChange"></div></div>
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">Repeat Rate</span><span class="stat-icon purple">&#128260;</span></div><div class="stat-value" id="kpiRepeatRate">-</div><div class="stat-change" id="kpiRepeatRateChange"></div></div>
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">Champions</span><span class="stat-icon orange">&#127942;</span></div><div class="stat-value" id="kpiChampions">-</div><div class="stat-change" id="kpiChampionsChange"></div></div>
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">At-Risk</span><span class="stat-icon red">&#9888;</span></div><div class="stat-value" id="kpiAtRisk">-</div><div class="stat-change" id="kpiAtRiskChange"></div></div>
                        <div class="stat-card"><div class="stat-header"><span class="stat-label">Lost</span><span class="stat-icon cyan">&#128546;</span></div><div class="stat-value" id="kpiLost">-</div><div class="stat-change" id="kpiLostChange"></div></div>
                    </div>

                    <div class="charts-grid">
                        <div class="chart-card">
                            <div class="chart-header"><span class="chart-title">RFM Segments</span></div>
                            <div class="chart-body"><div class="chart-container"><canvas id="rfmChart"></canvas></div></div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header"><span class="chart-title">Retention Cohorts</span></div>
                            <div class="chart-body"><div class="chart-container"><canvas id="cohortChart"></canvas></div></div>
                        </div>
                    </div>

                    <div class="marketing-tables-grid">
                        <div class="chart-card">
                            <div class="chart-header">
                                <span class="chart-title">Win-Back Customers</span>
                                <div class="table-actions">
                                    <button class="btn btn-sm btn-secondary" id="exportWinbackCsv">CSV</button>
                                    <button class="btn btn-sm btn-secondary" id="exportWinbackJson">JSON</button>
                                </div>
                            </div>
                            <div class="table-wrapper">
                                <table class="compact-table">
                                    <thead><tr><th>Name</th><th>Phone</th><th>Segment</th><th class="text-right">Last Order</th><th class="text-right">Total Spent</th></tr></thead>
                                    <tbody id="winbackTableBody"><tr><td colspan="5" class="empty-cell">Loading...</td></tr></tbody>
                                </table>
                            </div>
                        </div>
                        <div class="chart-card">
                            <div class="chart-header">
                                <span class="chart-title">VIP Customers</span>
                                <div class="table-actions">
                                    <button class="btn btn-sm btn-secondary" id="exportVipCsv">CSV</button>
                                    <button class="btn btn-sm btn-secondary" id="exportVipJson">JSON</button>
                                </div>
                            </div>
                            <div class="table-wrapper">
                                <table class="compact-table">
                                    <thead><tr><th>Name</th><th>Phone</th><th>Segment</th><th class="text-right">Frequency</th><th class="text-right">Total Spent</th></tr></thead>
                                    <tbody id="vipTableBody"><tr><td colspan="5" class="empty-cell">Loading...</td></tr></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <p class="notice-text">Exported data includes customer name and phone for outreach purposes. Handle in accordance with PDPA / applicable data protection laws.</p>
                </div>

            </div>
        </main>
    </div>

    <div class="modal-overlay" id="orderModal">
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title" id="modalTitle">Order Details</h3>
                <button class="modal-close" id="modalClose">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="modal-body" id="modalBody"></div>
        </div>
    </div>

    <div class="toast" id="toast">
        <span id="toastMessage"></span>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" onerror="document.querySelectorAll('.chart-container').forEach(c=>c.innerHTML='<p style=\\'text-align:center;color:var(--text-muted);padding:40px;\\'>Chart.js failed to load. Check your network connection.</p>')"></script>
    <script>
        const state = {
            orders: [],
            pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 20 },
            filters: { search: '', status: '', orderType: '', dateFrom: '', dateTo: '' },
            sortBy: 'orderTimestamp',
            sortOrder: 'desc',
            loading: false,
            summary: null,
            currentView: 'dashboard',
            showAllOrders: false,
            activePeriod: '7d'
        };

        function getMalaysiaDate() {
            const now = new Date();
            const mytStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
            return new Date(mytStr);
        }

        function formatMalaysiaDate(date) {
            return date.toLocaleDateString('en-MY', {
                timeZone: 'Asia/Kuala_Lumpur',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }

        function getMalaysiaDateStr(date) {
            return date.toISOString().split('T')[0];
        }

        function formatCurrency(amount, currency) {
            return \`\${currency || 'MYR'} \${(amount || 0).toFixed(2)}\`;
        }

        function formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        function formatTime(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
        }

        function formatDateTime(dateStr) {
            if (!dateStr) return '-';
            return \`\${formatDate(dateStr)} \${formatTime(dateStr)}\`;
        }

        function timeAgo(dateStr) {
            if (!dateStr) return '';
            const now = getMalaysiaDate();
            const d = new Date(dateStr);
            const diff = Math.floor((now - d) / 1000);
            if (diff < 60) return 'just now';
            if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`;
            if (diff < 86400) return \`\${Math.floor(diff / 3600)}h ago\`;
            return \`\${Math.floor(diff / 86400)}d ago\`;
        }

        function updatePeriodButtons() {
            document.querySelectorAll('.period-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.period === state.activePeriod);
            });
        }

        function setPeriod(period) {
            state.activePeriod = period;
            const now = getMalaysiaDate();
            let from = getMalaysiaDate();
            const to = getMalaysiaDate();

            if (period === '7d') {
                from.setDate(now.getDate() - 6);
            } else if (period === '30d') {
                from.setDate(now.getDate() - 29);
            }

            const fromStr = getMalaysiaDateStr(from);
            const toStr = getMalaysiaDateStr(to);

            state.filters.dateFrom = fromStr;
            state.filters.dateTo = toStr;
            state.showAllOrders = false;
            state.pagination.currentPage = 1;

            document.getElementById('dateFrom').value = fromStr;
            document.getElementById('dateTo').value = toStr;

            updatePeriodButtons();
            fetchOrders();
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toastMessage').textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function updateDateDisplays() {
            const myt = getMalaysiaDate();
            const formatted = formatMalaysiaDate(myt);
            const dateStr = getMalaysiaDateStr(myt);
            document.getElementById('dashboardDate').textContent = formatted;
            document.getElementById('ordersDate').textContent = formatted;
            if (!state.showAllOrders && state.activePeriod === 'today') {
                document.getElementById('dateFrom').value = dateStr;
                document.getElementById('dateTo').value = dateStr;
                state.filters.dateFrom = dateStr;
                state.filters.dateTo = dateStr;
            }
        }

        async function fetchSummary() {
            try {
                const res = await fetch('/api/dashboard/summary');
                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();
                if (data.success) {
                    state.summary = data.data;
                    updateStats(data.data.summary);
                    updateActivityChart(data.data.recentActivity);
                    updateStatusList(data.data.statusBreakdown);
                    updateLastFetched(data.data.lastFetchedAt);
                }
            } catch (e) {
                console.error('Error fetching summary:', e);
            }
        }

        async function fetchOrders() {
            if (state.loading) return;
            state.loading = true;
            document.getElementById('refreshBtn').classList.add('loading');

            try {
                const params = new URLSearchParams({
                    page: state.pagination.currentPage,
                    limit: state.pagination.limit,
                    sortBy: state.sortBy,
                    sortOrder: state.sortOrder
                });

                if (state.filters.search) params.set('search', state.filters.search);
                if (state.filters.status) params.set('status', state.filters.status);
                if (state.filters.orderType) params.set('orderType', state.filters.orderType);
                if (state.filters.dateFrom) params.set('startDate', state.filters.dateFrom);
                if (state.filters.dateTo) params.set('endDate', state.filters.dateTo);

                const res = await fetch(\`/api/orders?\${params.toString()}\`);
                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();

                if (data.success) {
                    state.orders = data.data;
                    state.pagination = data.pagination;
                    if (data.filters) {
                        populateStatusFilter(data.filters.statuses);
                    }
                    renderOrders();
                    updatePagination();
                }
            } catch (e) {
                console.error('Error fetching orders:', e);
                showToast('Failed to load orders');
            } finally {
                state.loading = false;
                document.getElementById('refreshBtn').classList.remove('loading');
            }
        }

        function populateStatusFilter(statuses) {
            const select = document.getElementById('statusFilter');
            const currentVal = select.value;
            select.innerHTML = '<option value="">All Statuses</option>';
            statuses.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');
                select.appendChild(opt);
            });
            select.value = currentVal;
        }

        function updateStats(summary) {
            if (!summary) return;
            document.getElementById('statTotalOrders').textContent = summary.total.orders.toLocaleString();
            document.getElementById('statTodayOrders').textContent = summary.today.orders.toLocaleString();
            document.getElementById('statTotalRevenue').textContent = formatCurrency(summary.total.revenue, summary.total.currency);
            document.getElementById('statTodayRevenue').textContent = formatCurrency(summary.today.revenue, summary.total.currency);
            document.getElementById('statAvgOrder').textContent = formatCurrency(summary.total.avgOrderValue, summary.total.currency);
            document.getElementById('statWeekOrders').textContent = summary.week.orders.toLocaleString();
            document.getElementById('statWeekRevenue').textContent = formatCurrency(summary.week.revenue, summary.total.currency);
            document.getElementById('statMonthOrders').textContent = summary.month.orders.toLocaleString();
            document.getElementById('statMonthRevenue').textContent = formatCurrency(summary.month.revenue, summary.total.currency);

            if (state.summary && state.summary.errors) {
                const err = state.summary.errors;
                const rate = err.totalOrders > 0 ? ((err.ordersWithErrors / err.totalOrders) * 100).toFixed(1) : 0;
                document.getElementById('statErrorRate').textContent = rate + '%';
                document.getElementById('statErrorCount').textContent = \`\${err.ordersWithErrors} of \${err.totalOrders} orders\`;
            }

            document.getElementById('statTodayOrdersChange').textContent = \`\${formatCurrency(summary.today.revenue, summary.total.currency)} today\`;
        }

        function updateActivityChart(activity) {
            const container = document.getElementById('activityChart');
            if (!activity || activity.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No activity data</p></div>';
                return;
            }

            const maxOrders = Math.max(...activity.map(d => d.orders), 1);
            container.innerHTML = activity.map(d => {
                const height = Math.max((d.orders / maxOrders) * 140, 4);
                const date = new Date(d.date);
                const label = date.toLocaleDateString('en-MY', { weekday: 'short' });
                return \`
                    <div class="bar-group">
                        <div class="bar" style="height:\${height}px">
                            <span class="bar-value">\${d.orders}</span>
                        </div>
                        <span class="bar-label">\${label}</span>
                    </div>
                \`;
            }).join('');
        }

        function updateStatusList(statuses) {
            const container = document.getElementById('statusList');
            if (!statuses || statuses.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No status data</p></div>';
                return;
            }

            const colors = {
                pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6',
                ready: '#06b6d4', picked_up: '#f97316', delivered: '#10b981',
                completed: '#00b14f', cancelled: '#ef4444', unknown: '#6b7280'
            };

            container.innerHTML = statuses.map(s => \`
                <div class="status-item">
                    <div class="status-info">
                        <div class="status-dot" style="background:\${colors[s.status] || '#6b7280'}"></div>
                        <span class="status-name">\${s.status.charAt(0).toUpperCase() + s.status.slice(1).replace('_', ' ')}</span>
                    </div>
                    <span class="status-count">\${s.count}</span>
                </div>
            \`).join('');
        }

        function updateLastFetched(timestamp) {
            const el = document.getElementById('lastUpdate');
            if (timestamp) {
                const d = new Date(timestamp);
                const myt = d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: true });
                const ago = timeAgo(timestamp);
                el.textContent = \`Last fetch: \${myt} MYT (\${ago})\`;
                el.title = \`Fetched at: \${d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} MYT\`;
            } else {
                el.textContent = 'No orders fetched yet';
                el.title = '';
            }
        }

        function renderOrders() {
            const tbody = document.getElementById('ordersTableBody');
            const countEl = document.getElementById('tableCount');

            if (state.orders.length === 0) {
                tbody.innerHTML = \`
                    <tr><td colspan="9">
                        <div class="empty-state">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                            <h3>No orders found</h3>
                            <p>Try adjusting your filters</p>
                        </div>
                    </td></tr>
                \`;
                countEl.textContent = '0 orders';
                return;
            }

            countEl.textContent = \`\${state.pagination.totalCount} orders\`;

            tbody.innerHTML = state.orders.map(order => \`
                <tr class="clickable" data-order-id="\${order._id}">
                    <td><span class="order-number">\${order.orderNumber || '-'}</span></td>
                    <td>
                        <div class="customer-cell">
                            <span class="customer-name">\${order.customerName || '-'}</span>
                            \${order.customerPhone ? \`<span class="customer-phone">\${order.customerPhone}</span>\` : ''}
                        </div>
                    </td>
                    <td>\${order.orderDetails?.restaurantName || '-'}</td>
                    <td>
                        <div class="driver-cell">
                            <span class="driver-name">\${order.driverName || 'Pending'}</span>
                            \${order.driverStatus ? \`<span class="driver-status">\${order.driverStatus}</span>\` : ''}
                        </div>
                    </td>
                    <td><span class="order-type-badge">\${order.orderDetails?.orderType || 'delivery'}</span></td>
                    <td class="total-cell">\${formatCurrency(order.pricing?.total, order.pricing?.currency)}</td>
                    <td><span class="status-badge \${order.status || 'unknown'}">\${(order.status || 'unknown').replace('_', ' ')}</span></td>
                    <td>
                        <div class="time-cell">
                            <span class="time-date">\${formatDate(order.orderTimestamp)}</span>
                            <span class="time-relative">\${timeAgo(order.orderTimestamp)}</span>
                        </div>
                    </td>
                    <td>
                        \${order.hasErrors ? '<span class="error-indicator">⚠ Error</span>' : ''}
                    </td>
                </tr>
            \`).join('');

            document.querySelectorAll('.clickable').forEach(row => {
                row.addEventListener('click', () => {
                    const orderId = row.dataset.orderId;
                    const order = state.orders.find(o => o._id === orderId);
                    if (order) showOrderModal(order);
                });
            });
        }

        function updatePagination() {
            const info = document.getElementById('paginationInfo');
            const controls = document.getElementById('paginationControls');
            const p = state.pagination;

            const start = (p.currentPage - 1) * p.limit + 1;
            const end = Math.min(p.currentPage * p.limit, p.totalCount);
            info.textContent = p.totalCount > 0 ? \`Showing \${start}-\${end} of \${p.totalCount} orders\` : 'No orders';

            let html = '';
            html += \`<button class="page-btn" \${p.currentPage <= 1 ? 'disabled' : ''} data-page="\${p.currentPage - 1}">&larr; Prev</button>\`;

            const maxVisible = 5;
            let startPage = Math.max(1, p.currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(p.totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

            for (let i = startPage; i <= endPage; i++) {
                html += \`<button class="page-btn \${i === p.currentPage ? 'active' : ''}" data-page="\${i}">\${i}</button>\`;
            }

            html += \`<button class="page-btn" \${p.currentPage >= p.totalPages ? 'disabled' : ''} data-page="\${p.currentPage + 1}">Next &rarr;</button>\`;
            controls.innerHTML = html;

            controls.querySelectorAll('.page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page && page !== state.pagination.currentPage) {
                        state.pagination.currentPage = page;
                        fetchOrders();
                    }
                });
            });
        }

        function showOrderModal(order) {
            const modal = document.getElementById('orderModal');
            const title = document.getElementById('modalTitle');
            const body = document.getElementById('modalBody');

            title.textContent = \`Order \${order.orderNumber}\`;

            const itemsHtml = (order.orderDetails?.items || []).map(item => \`
                <tr>
                    <td>\${item.name}</td>
                    <td>\${item.quantity}</td>
                    <td>\${formatCurrency(item.price, order.pricing?.currency)}</td>
                    <td>\${formatCurrency(item.total, order.pricing?.currency)}</td>
                </tr>
            \`).join('');

            body.innerHTML = \`
                <div class="detail-section">
                    <h4 class="detail-title">Order Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Order Number</span>
                            <span class="detail-value">\${order.orderNumber}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Booking ID</span>
                            <span class="detail-value">\${order.bookingId || '-'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Status</span>
                            <span class="detail-value"><span class="status-badge \${order.status || 'unknown'}">\${(order.status || 'unknown').replace('_', ' ')}</span></span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Order Type</span>
                            <span class="detail-value"><span class="order-type-badge">\${order.orderDetails?.orderType || 'delivery'}</span></span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Order Date</span>
                            <span class="detail-value">\${formatDateTime(order.orderTimestamp)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Delivery Time</span>
                            <span class="detail-value">\${order.deliveryTime || '-'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Fetched At</span>
                            <span class="detail-value">\${formatDateTime(order.fetchedAt)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Source</span>
                            <span class="detail-value">\${order.source || '-'}</span>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h4 class="detail-title">Customer Details</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Name</span>
                            <span class="detail-value">\${order.customerName || '-'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Phone</span>
                            <span class="detail-value">\${order.customerPhone || '-'}</span>
                        </div>
                        <div class="detail-item" style="grid-column:span 2">
                            <span class="detail-label">Note</span>
                            <span class="detail-value">\${order.customerNote || '-'}</span>
                        </div>
                    </div>
                </div>

                \${order.orderDetails?.restaurantName ? \`
                <div class="detail-section">
                    <h4 class="detail-title">Restaurant</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Name</span>
                            <span class="detail-value">\${order.orderDetails.restaurantName}</span>
                        </div>
                        \${order.orderDetails.specialInstructions ? \`
                        <div class="detail-item">
                            <span class="detail-label">Special Instructions</span>
                            <span class="detail-value">\${order.orderDetails.specialInstructions}</span>
                        </div>
                        \` : ''}
                    </div>
                </div>
                \` : ''}

                <div class="detail-section">
                    <h4 class="detail-title">Driver</h4>
                    <div class="detail-grid">
                        \${order.driverPhotoUrl ? \`
                        <div class="detail-item" style="grid-column:span 2;display:flex;align-items:center;gap:12px">
                            <img src="\${order.driverPhotoUrl}" alt="Driver photo" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color)" onerror="this.style.display='none'">
                            <div>
                                <div style="font-weight:600">\${order.driverName || 'Pending'}</div>
                                \${order.driverPhone ? \`<div style="font-size:12px;color:var(--text-muted)">\${order.driverPhone}</div>\` : ''}
                            </div>
                        </div>
                        \` : \`
                        <div class="detail-item">
                            <span class="detail-label">Name</span>
                            <span class="detail-value">\${order.driverName || 'Pending'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Phone</span>
                            <span class="detail-value">\${order.driverPhone || '-'}</span>
                        </div>
                        \`}
                        \${order.driverStatus ? \`
                        <div class="detail-item">
                            <span class="detail-label">Status</span>
                            <span class="detail-value">\${order.driverStatus}</span>
                        </div>
                        \` : ''}
                    </div>
                </div>

                \${order.deliveryInfo?.address ? \`
                <div class="detail-section">
                    <h4 class="detail-title">Delivery Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item" style="grid-column:span 2">
                            <span class="detail-label">Address</span>
                            <span class="detail-value">\${order.deliveryInfo.address}</span>
                        </div>
                        \${order.deliveryInfo.estimatedDeliveryTime ? \`
                        <div class="detail-item">
                            <span class="detail-label">Estimated Delivery</span>
                            <span class="detail-value">\${formatDateTime(order.deliveryInfo.estimatedDeliveryTime)}</span>
                        </div>
                        \` : ''}
                        \${order.deliveryInfo.actualDeliveryTime ? \`
                        <div class="detail-item">
                            <span class="detail-label">Actual Delivery</span>
                            <span class="detail-value">\${formatDateTime(order.deliveryInfo.actualDeliveryTime)}</span>
                        </div>
                        \` : ''}
                    </div>
                </div>
                \` : ''}

                <div class="detail-section">
                    <h4 class="detail-title">Items</h4>
                    \${itemsHtml ? \`
                    <table class="items-table">
                        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                        <tbody>\${itemsHtml}</tbody>
                    </table>
                    \` : '<p style="color:var(--text-muted)">No items data</p>'}
                </div>

                <div class="detail-section">
                    <h4 class="detail-title">Pricing</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Subtotal</span>
                            <span class="detail-value">\${formatCurrency(order.pricing?.subtotal, order.pricing?.currency)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Delivery Fee</span>
                            <span class="detail-value">\${formatCurrency(order.pricing?.deliveryFee, order.pricing?.currency)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Service Fee</span>
                            <span class="detail-value">\${formatCurrency(order.pricing?.serviceFee, order.pricing?.currency)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Tax</span>
                            <span class="detail-value">\${formatCurrency(order.pricing?.tax, order.pricing?.currency)}</span>
                        </div>
                        \${order.pricing?.discount > 0 ? \`
                        <div class="detail-item">
                            <span class="detail-label">Discount</span>
                            <span class="detail-value">-\${formatCurrency(order.pricing.discount, order.pricing?.currency)}</span>
                        </div>
                        \` : ''}
                        \${order.pricing?.discountCode ? \`
                        <div class="detail-item">
                            <span class="detail-label">Discount Code</span>
                            <span class="detail-value">\${order.pricing.discountCode}</span>
                        </div>
                        \` : ''}
                        <div class="detail-item" style="grid-column:span 2">
                            <span class="detail-label">Total</span>
                            <span class="detail-value" style="font-size:18px;font-weight:700;color:var(--grab-green)">\${formatCurrency(order.pricing?.total, order.pricing?.currency)}</span>
                        </div>
                    </div>
                </div>

                \${order.hasErrors && order.errorMessages?.length > 0 ? \`
                <div class="detail-section">
                    <h4 class="detail-title" style="color:var(--status-cancelled)">Errors</h4>
                    \${order.errorMessages.map(e => \`<p style="color:var(--status-cancelled);margin-bottom:8px">\${e.message}</p>\`).join('')}
                </div>
                \` : ''}
            \`;

            modal.classList.add('active');
        }

        function applyFilters() {
            state.filters.search = document.getElementById('searchInput').value.trim();
            state.filters.status = document.getElementById('statusFilter').value;
            state.filters.orderType = document.getElementById('orderTypeFilter').value;
            state.filters.dateFrom = document.getElementById('dateFrom').value;
            state.filters.dateTo = document.getElementById('dateTo').value;
            state.pagination.currentPage = 1;
            state.activePeriod = null;
            updatePeriodButtons();
            fetchOrders();
        }

        function clearFilters() {
            document.getElementById('searchInput').value = '';
            document.getElementById('statusFilter').value = '';
            document.getElementById('orderTypeFilter').value = '';
            state.filters = { search: '', status: '', orderType: '', dateFrom: '', dateTo: '' };
            state.pagination.currentPage = 1;
            state.activePeriod = '7d';
            updateDateDisplays();
            updatePeriodButtons();
            fetchOrders();
        }

        function switchView(view) {
            if (window.rfmChartInstance) { window.rfmChartInstance.destroy(); window.rfmChartInstance = null; }
            if (window.cohortChartInstance) { window.cohortChartInstance.destroy(); window.cohortChartInstance = null; }

            state.currentView = view;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));

            if (view === 'dashboard') {
                document.getElementById('dashboardView').classList.add('active');
                document.querySelector('[data-view="dashboard"]').classList.add('active');
                document.getElementById('headerTitle').textContent = 'Dashboard';
                document.getElementById('headerSubtitle').textContent = 'Overview of your order activity';
                fetchSummary();
            } else if (view === 'orders') {
                document.getElementById('ordersView').classList.add('active');
                document.querySelector('[data-view="orders"]').classList.add('active');
                document.getElementById('headerTitle').textContent = 'All Orders';
                document.getElementById('headerSubtitle').textContent = 'Manage and filter your orders';
                if (!state.filters.dateFrom) setPeriod('7d');
                else fetchOrders();
            } else if (view === 'marketing') {
                document.getElementById('marketingView').classList.add('active');
                document.querySelector('[data-view="marketing"]').classList.add('active');
                document.getElementById('headerTitle').textContent = 'Marketing';
                document.getElementById('headerSubtitle').textContent = 'Customer segmentation & analytics';
                updateDateDisplays();
                fetchMarketingData();
            }
        }

        function getChartColors() {
            const dark = document.documentElement.getAttribute('data-theme') === 'dark';
            return {
                text: dark ? '#f1f5f9' : '#0f172a',
                grid: dark ? '#334155' : '#e2e8f0',
                segments: ['#00b14f','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#64748b'],
            };
        }

        async function fetchMarketingData() {
            try {
                const [kpisRes, rfmRes, cohortsRes, winbackRes, vipRes] = await Promise.all([
                    fetch('/api/marketing/kpis'), fetch('/api/marketing/rfm'),
                    fetch('/api/marketing/cohorts'), fetch('/api/marketing/customers/winback'),
                    fetch('/api/marketing/customers/vip'),
                ]);
                if (!kpisRes.ok || !rfmRes.ok || !cohortsRes.ok) throw new Error('Marketing API error');

                const kpis = await kpisRes.json();
                const rfm = await rfmRes.json();
                const cohorts = await cohortsRes.json();
                const winback = winbackRes.ok ? await winbackRes.json() : { data: [] };
                const vip = vipRes.ok ? await vipRes.json() : { data: [] };

                if (kpis.success) {
                    const d = kpis.data;
                    document.getElementById('kpiTotalCustomers').textContent = d.totalCustomers.toLocaleString();
                    document.getElementById('kpiAvgOrderValue').textContent = 'RM ' + (d.avgOrderValue || 0).toFixed(2);
                    document.getElementById('kpiRepeatRate').textContent = (d.repeatRate || 0).toFixed(1) + '%';
                    document.getElementById('kpiChampions').textContent = (d.championCount || 0).toLocaleString();
                    document.getElementById('kpiAtRisk').textContent = (d.atRiskCount || 0).toLocaleString();
                    document.getElementById('kpiLost').textContent = (d.lostCount || 0).toLocaleString();
                }

                if (rfm.success && typeof Chart !== 'undefined') {
                    const colors = getChartColors();
                    const segData = rfm.data.segments || [];
                    const labels = segData.map(s => s.segment);
                    const counts = segData.map(s => s.count);
                    window.rfmChartInstance = new Chart(document.getElementById('rfmChart'), {
                        type: 'doughnut',
                        data: { labels, datasets: [{ data: counts, backgroundColor: colors.segments.slice(0, labels.length) }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: colors.text } } } }
                    });
                }

                if (cohorts.success && typeof Chart !== 'undefined') {
                    const colors = getChartColors();
                    const cohortData = cohorts.data.cohorts || [];
                    const labels = cohortData.map(c => c.cohortMonth);
                    const retentionRates = cohortData.map(c => {
                        const months = Object.keys(c.retention || {}).sort();
                        return months.length > 1 ? c.retention[months[1]] || 0 : 100;
                    });
                    window.cohortChartInstance = new Chart(document.getElementById('cohortChart'), {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{ label: 'Month-1 Retention %', data: retentionRates, borderColor: colors.segments[0], backgroundColor: colors.segments[0] + '20', fill: true, tension: 0.3 }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            scales: { y: { beginAtZero: true, max: 100, ticks: { color: colors.text }, grid: { color: colors.grid } }, x: { ticks: { color: colors.text }, grid: { color: colors.grid } } },
                            plugins: { legend: { labels: { color: colors.text } } }
                        }
                    });
                }

                renderCustomerTable('winbackTableBody', winback.data?.customers || [], 'monetary');
                renderCustomerTable('vipTableBody', vip.data?.customers || [], 'frequency');
            } catch (e) {
                console.error('Marketing fetch error:', e);
            }
        }

        function escapeHtml(str) {
            if (typeof str !== 'string') return str;
            return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
        }

        function renderCustomerTable(tbodyId, customers, highlightField) {
            const tbody = document.getElementById(tbodyId);
            if (!customers.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No customers found</td></tr>';
                return;
            }
            tbody.innerHTML = customers.map(c => '<tr>' +
                '<td>' + escapeHtml(c.name || '-') + '</td>' +
                '<td>' + escapeHtml(c.phone || '-') + '</td>' +
                '<td>' + escapeHtml(c.segment || '-') + '</td>' +
                '<td class="text-right">' + (highlightField === 'monetary' ? formatDate(c.lastOrder) : (c.frequency || 0)) + '</td>' +
                '<td class="text-right">RM ' + ((c.monetary || c.avgOrderValue || 0).toFixed(2)) + '</td>' +
                '</tr>').join('');
        }

        function formatDate(d) {
            if (!d) return '-';
            return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        function downloadExport(type, format) {
            const a = document.createElement('a');
            a.href = '/api/marketing/export/' + type + '/' + format;
            a.download = type + '-' + format + '.' + format;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        function toggleTheme() {
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcon(next);
        }

        function updateThemeIcon(theme) {
            const icon = document.getElementById('themeIcon');
            if (theme === 'dark') {
                icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
            } else {
                icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
            }
        }

        function toggleMobileMenu() {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('show');
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        }

        async function logout() {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
            } catch (e) {
                window.location.href = '/login';
            }
        }

        function getExportParams() {
            const params = new URLSearchParams();
            if (state.filters.status) params.set('status', state.filters.status);
            if (state.filters.dateFrom) params.set('startDate', state.filters.dateFrom);
            if (state.filters.dateTo) params.set('endDate', state.filters.dateTo);
            if (state.filters.orderType) params.set('orderType', state.filters.orderType);
            if (state.filters.search) params.set('search', state.filters.search);
            return params.toString();
        }

        document.addEventListener('DOMContentLoaded', () => {
            const savedTheme = localStorage.getItem('theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
            updateThemeIcon(savedTheme);

            const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
            if (sidebarCollapsed) {
                document.getElementById('sidebar').classList.add('collapsed');
            }

            updateDateDisplays();

            document.getElementById('themeToggle').addEventListener('click', toggleTheme);
            document.getElementById('refreshBtn').addEventListener('click', () => {
                if (state.currentView === 'dashboard') {
                    fetchSummary();
                } else if (state.currentView === 'marketing') {
                    fetchMarketingData();
                } else {
                    fetchOrders();
                }
            });
            document.getElementById('logoutBtn').addEventListener('click', logout);
            document.getElementById('exportWinbackCsv').addEventListener('click', () => downloadExport('winback', 'csv'));
            document.getElementById('exportWinbackJson').addEventListener('click', () => downloadExport('winback', 'json'));
            document.getElementById('exportVipCsv').addEventListener('click', () => downloadExport('vip', 'csv'));
            document.getElementById('exportVipJson').addEventListener('click', () => downloadExport('vip', 'json'));
            document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
            document.getElementById('mobileMenuBtn').addEventListener('click', toggleMobileMenu);
            document.getElementById('sidebarOverlay').addEventListener('click', toggleMobileMenu);
            document.getElementById('modalClose').addEventListener('click', () => {
                document.getElementById('orderModal').classList.remove('active');
            });
            document.getElementById('orderModal').addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    document.getElementById('orderModal').classList.remove('active');
                }
            });

            document.getElementById('applyFilters').addEventListener('click', applyFilters);
            document.getElementById('clearFilters').addEventListener('click', clearFilters);

            document.getElementById('exportCsvBtn').addEventListener('click', () => {
                const params = getExportParams();
                window.open(\`/api/orders/export/csv?\${params}\`, '_blank');
            });

            document.getElementById('exportJsonBtn').addEventListener('click', () => {
                const params = getExportParams();
                window.open(\`/api/orders/export/json?\${params}\`, '_blank');
            });

            document.getElementById('showAllOrders').addEventListener('click', () => {
                state.showAllOrders = true;
                state.activePeriod = null;
                updatePeriodButtons();
                document.getElementById('dateFrom').value = '';
                document.getElementById('dateTo').value = '';
                state.filters.dateFrom = '';
                state.filters.dateTo = '';
                state.pagination.currentPage = 1;
                fetchOrders();
            });

            document.querySelectorAll('.period-btn').forEach(btn => {
                btn.addEventListener('click', () => setPeriod(btn.dataset.period));
            });

            document.querySelectorAll('.nav-item[data-view]').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const view = item.dataset.view;
                    switchView(view);
                    if (window.innerWidth < 768) {
                        toggleMobileMenu();
                    }
                });
            });

            document.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const sort = th.dataset.sort;
                    if (state.sortBy === sort) {
                        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
                    } else {
                        state.sortBy = sort;
                        state.sortOrder = 'desc';
                    }
                    document.querySelectorAll('th').forEach(t => t.classList.remove('sorted'));
                    th.classList.add('sorted');
                    fetchOrders();
                });
            });

            document.getElementById('searchInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') applyFilters();
            });

            switchView('dashboard');
            setInterval(() => {
                updateDateDisplays();
                if (state.currentView === 'dashboard') {
                    fetchSummary();
                } else if (state.currentView === 'marketing') {
                    fetchMarketingData();
                } else {
                    fetchOrders();
                }
            }, 60000);
        });
    </script>
</body>
</html>`;
}

module.exports = getDashboardHTML;
