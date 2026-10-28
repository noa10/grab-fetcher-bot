/**
 * Public landing page for the hosted deployment.
 *
 * This is deliberately data-free: the deployment used to serve a live merchant
 * dashboard (and a public API) at `/`. The project page explains what the tool is
 * and how to run it against your own Grab Merchant account, while the dashboard
 * moved behind /login.
 */
function getLandingHTML() {
  const repo = process.env.PROJECT_REPO_URL || 'https://github.com/noa10/grab-fetcher-bot';
  const deployUrl = `https://vercel.com/new/clone?repository-url=${encodeURIComponent(repo)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Grab Order Fetcher — self-hosted dashboard for Grab Merchant</title>
<meta name="description" content="Open-source order, review and analytics dashboard for Grab Merchant. Runs on your own infrastructure with your own account.">
<meta property="og:title" content="Grab Order Fetcher">
<meta property="og:description" content="Self-hosted order, review and analytics dashboard for Grab Merchant.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --green: #00B14F;
    --green-dark: #00753A;
    --ink: #101828;
    --muted: #5B6472;
    --line: #E4E7EC;
    --bg: #FFFFFF;
    --soft: #F7F9FC;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: var(--ink);
    background: var(--bg);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  .wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }

  nav {
    position: sticky; top: 0; z-index: 10;
    background: rgba(255,255,255,.85);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.01em; }
  .brand .dot {
    width: 26px; height: 26px; border-radius: 8px;
    background: linear-gradient(135deg, var(--green), #00D46A);
    display: grid; place-items: center; color: #fff; font-size: 13px; font-weight: 800;
  }
  .nav-links { display: flex; align-items: center; gap: 22px; font-size: 14px; color: var(--muted); }
  .nav-links a:hover { color: var(--ink); }
  @media (max-width: 720px) { .nav-links .hide-sm { display: none; } }

  header { padding: 84px 0 64px; background:
      radial-gradient(900px 380px at 12% -10%, rgba(0,177,79,.10), transparent 60%),
      radial-gradient(700px 320px at 90% 0%, rgba(0,177,79,.07), transparent 55%); }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid rgba(0,177,79,.28); background: rgba(0,177,79,.07);
    color: var(--green-dark); font-size: 12.5px; font-weight: 600;
    padding: 6px 12px; border-radius: 999px; margin-bottom: 22px;
  }
  h1 { font-size: clamp(34px, 5vw, 56px); line-height: 1.08; letter-spacing: -.03em; margin: 0 0 20px; font-weight: 800; }
  h1 .accent { color: var(--green-dark); }
  .lede { font-size: 18px; color: var(--muted); max-width: 640px; margin: 0 0 32px; }
  .cta { display: flex; flex-wrap: wrap; gap: 12px; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 12px 20px; border-radius: 10px; font-weight: 600; font-size: 14.5px;
    border: 1px solid transparent; transition: transform .12s ease, box-shadow .12s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  /* #00B14F behind white text is ~2.9:1, below WCAG AA. The darker fill keeps the
     brand green recognisable while passing at 4.6:1. */
  .btn-primary { background: #00843B; color: #fff; box-shadow: 0 8px 20px rgba(0,132,59,.22); }
  .btn-primary:hover { background: #006B30; }
  .btn-ghost { border-color: var(--line); background: #fff; color: var(--ink); }
  .btn-ghost:hover { border-color: #C9CFD8; }

  .hero-grid { display: grid; grid-template-columns: 1.12fr .88fr; gap: 52px; align-items: center; }
  @media (max-width: 940px) { .hero-grid { grid-template-columns: 1fr; gap: 36px; } .preview { max-width: 420px; } }

  .preview {
    background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px 14px;
    box-shadow: 0 18px 44px rgba(16,24,40,.10), 0 1px 0 rgba(16,24,40,.02);
  }
  .pv-head { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .pv-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green); box-shadow: 0 0 0 3px rgba(0,177,79,.15); }
  .pv-name { font-size: 13px; font-weight: 650; }
  .pv-live { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--green-dark); background: rgba(0,177,79,.10); padding: 3px 8px; border-radius: 999px; }
  .pv-metrics { display: flex; gap: 10px; margin-bottom: 16px; }
  .pv-metric { flex: 1; background: var(--soft); border-radius: 10px; padding: 11px 12px; }
  .pv-label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 3px; }
  .pv-value { display: block; font-size: 19px; font-weight: 700; letter-spacing: -.02em; }
  .pv-chart { display: flex; align-items: flex-end; gap: 7px; height: 76px; padding: 0 2px; margin-bottom: 14px; }
  .pv-chart span { flex: 1; background: linear-gradient(180deg, #35D07F, var(--green)); border-radius: 4px 4px 2px 2px; opacity: .85; }
  .pv-chart span.dim { background: #DCEFE4; }
  .pv-foot { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 11px; }
  .pv-note { margin-top: 9px; font-size: 10.5px; color: #98A2B3; }

  section { padding: 72px 0; }
  section.soft { background: var(--soft); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  h2 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 12px; font-weight: 700; }
  .sub { color: var(--muted); margin: 0 0 40px; max-width: 620px; }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 620px) { .grid { grid-template-columns: 1fr; } }
  .card {
    background: #fff; border: 1px solid var(--line); border-radius: var(--radius);
    padding: 22px; transition: border-color .12s ease, box-shadow .12s ease;
  }
  .card:hover { border-color: #CFE9D9; box-shadow: 0 10px 26px rgba(16,24,40,.06); }
  .card .icon {
    width: 34px; height: 34px; border-radius: 9px; background: rgba(0,177,79,.10);
    color: var(--green-dark); display: grid; place-items: center; margin-bottom: 14px;
  }
  .card .icon svg { width: 18px; height: 18px; stroke: currentColor; fill: none;
    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .card h3 { font-size: 15.5px; margin: 0 0 6px; font-weight: 650; }
  .card p { margin: 0; color: var(--muted); font-size: 14px; }

  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; counter-reset: step; }
  @media (max-width: 900px) { .steps { grid-template-columns: 1fr; } }
  .step { position: relative; padding-left: 46px; }
  .step::before {
    counter-increment: step; content: counter(step);
    position: absolute; left: 0; top: 0;
    width: 30px; height: 30px; border-radius: 999px;
    background: var(--ink); color: #fff; font-size: 13px; font-weight: 700;
    display: grid; place-items: center;
  }
  .step h3 { margin: 2px 0 6px; font-size: 15.5px; }
  .step p { margin: 0; color: var(--muted); font-size: 14px; }

  pre {
    background: #0E1621; color: #D7E3EE; border-radius: 12px;
    padding: 16px 18px; overflow-x: auto; font-size: 13px; line-height: 1.65;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  pre .c { color: #7C8FA3; }
  code.inline {
    background: rgba(16,24,40,.06); padding: 2px 6px; border-radius: 6px;
    font-family: ui-monospace, Menlo, monospace; font-size: 13px;
  }

  .split { display: grid; grid-template-columns: 1.05fr .95fr; gap: 40px; align-items: start; }
  @media (max-width: 900px) { .split { grid-template-columns: 1fr; gap: 26px; } }

  ul.checks { list-style: none; padding: 0; margin: 0; }
  ul.checks li { position: relative; padding-left: 28px; margin-bottom: 12px; color: var(--muted); font-size: 14.5px; }
  ul.checks li::before {
    content: "✓"; position: absolute; left: 0; top: 0;
    color: var(--green-dark); font-weight: 800;
  }
  ul.checks strong { color: var(--ink); font-weight: 600; }

  .notice {
    display: flex; gap: 12px; align-items: flex-start;
    background: #FFF8E6; border: 1px solid #F3DFA8; border-radius: 12px;
    padding: 14px 16px; font-size: 13.5px; color: #6B520F; margin-top: 26px;
  }

  footer { border-top: 1px solid var(--line); padding: 30px 0 44px; color: var(--muted); font-size: 13.5px; }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 14px; justify-content: space-between; align-items: center; }
  footer a { color: var(--ink); }
  footer a:hover { color: var(--green-dark); }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <div class="brand"><span class="dot">G</span> Grab Order Fetcher</div>
    <div class="nav-links">
      <a class="hide-sm" href="#features">Features</a>
      <a class="hide-sm" href="#setup">Setup</a>
      <a class="hide-sm" href="${repo}">GitHub</a>
      <a class="btn btn-ghost" href="/login">Sign in</a>
    </div>
  </div>
</nav>

<header>
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <span class="badge">Open source · MIT · self-hosted</span>
        <h1>Your Grab Merchant data,<br><span class="accent">on your own infrastructure.</span></h1>
        <p class="lede">
          An order, review and analytics dashboard that signs in to the Grab Merchant portal
          as you, stores everything in your own database, and never shares it with anyone else.
          Bring your own account, run your own copy.
        </p>
        <div class="cta">
          <a class="btn btn-primary" href="${deployUrl}">Deploy your own →</a>
          <a class="btn btn-ghost" href="${repo}#-quick-start">Self-host guide</a>
        </div>
      </div>

      <div class="preview" aria-hidden="true">
        <div class="pv-head">
          <span class="pv-dot"></span>
          <span class="pv-name">Today</span>
          <span class="pv-live">live</span>
        </div>
        <div class="pv-metrics">
          <div class="pv-metric"><span class="pv-label">Revenue</span><span class="pv-value">RM 1,284.50</span></div>
          <div class="pv-metric"><span class="pv-label">Orders</span><span class="pv-value">42</span></div>
        </div>
        <div class="pv-chart">
          <span style="height:34%"></span><span style="height:52%"></span><span style="height:41%"></span>
          <span style="height:68%"></span><span style="height:57%"></span><span style="height:83%"></span>
          <span style="height:100%"></span>
        </div>
        <div class="pv-foot">
          <span><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.9z"/></svg>4.8 average</span><span>125 reviews</span><span>12 to reply</span>
        </div>
        <div class="pv-note">Illustrative preview — your data stays in your own database</div>
      </div>
    </div>
  </div>
</header>

<section id="features" class="soft">
  <div class="wrap">
    <h2>What it does</h2>
    <p class="sub">Built for a single merchant account. Everything below runs from one checkout and one MongoDB database.</p>
    <div class="grid">
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></div>
        <h3>Order sync every 5 minutes</h3>
        <p>Logs in with your credentials, reads the History tab during trading hours and stores each order with items, modifiers and pricing.</p>
      </div>
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.9z"/></svg></div>
        <h3>Customer reviews</h3>
        <p>Pulls ratings, review text and per-aspect sentiment from the merchant feedback API, then tracks which reviews still need a reply.</p>
      </div>
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg></div>
        <h3>Dashboard and analytics</h3>
        <p>Revenue, order mix, customer retention and RFM segments, served from your data. CSV and JSON export included.</p>
      </div>
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-11.3-2M6 16a6 6 0 0 0 11.3 2"/><path d="M18 3v5h-5M6 21v-5h5"/></svg></div>
        <h3>Failure alerting</h3>
        <p>Optional Telegram alerts when a poll fails, plus a daily heartbeat that says whether the numbers look normal for your shop.</p>
      </div>
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></div>
        <h3>Your database</h3>
        <p>MongoDB Atlas free tier is enough. Your orders, customers and reviews stay in an account you control.</p>
      </div>
      <div class="card">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/></svg></div>
        <h3>No lock-in</h3>
        <p>MIT licensed, no telemetry, no paid tier. Fork it, change the selectors, run it on a Raspberry Pi if you like.</p>
      </div>
    </div>
  </div>
</section>

<section id="setup">
  <div class="wrap">
    <h2>Use it with your own account</h2>
    <p class="sub">Three things are yours: the Grab login, the database, and the admin password that guards the dashboard.</p>
    <div class="steps">
      <div class="step">
        <h3>Get the code</h3>
        <p>Deploy to Vercel for the dashboard, or clone the repo and run it with systemd or PM2. Both paths use the same source.</p>
      </div>
      <div class="step">
        <h3>Set your secrets</h3>
        <p>Your Grab Merchant username/password, a MongoDB URI, an admin login and a <code class="inline">SESSION_SECRET</code>. Nothing is baked into the image.</p>
      </div>
      <div class="step">
        <h3>Sign in and sync</h3>
        <p>Open the dashboard, log in with the admin account, and let the poller fill your database during trading hours.</p>
      </div>
    </div>

    <div class="split" style="margin-top: 44px;">
      <div>
        <h3 style="margin: 0 0 10px; font-size: 16px;">Minimum environment</h3>
<pre><span class="c"># .env — never commit this file</span>
GRAB_USERNAME=you@example.com
GRAB_PASSWORD=your-grab-password
MONGODB_URI=mongodb+srv://…

ADMIN_USERNAME=admin
ADMIN_PASSWORD=a-strong-password
SESSION_SECRET=$(openssl rand -hex 64)

<span class="c"># optional</span>
OPERATING_HOURS=11:00-15:00,17:00-22:30
GRAB_ALERT_TARGET=telegram</pre>
      </div>
      <div>
        <ul class="checks">
          <li><strong>Your credentials stay server-side.</strong> They are read from the environment by the poller; the browser never sees them.</li>
          <li><strong>The dashboard is not public.</strong> Every data endpoint requires a signed session from your admin login.</li>
          <li><strong>Your data is yours.</strong> Point <code class="inline">MONGODB_URI</code> at your own cluster and delete it whenever you want.</li>
          <li><strong>Read-only with respect to Grab.</strong> It scrapes the merchant portal you already have access to; it does not touch anything you cannot see in the portal.</li>
        </ul>
        <div class="notice">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#B8860B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 18px;margin-top:1px;"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <span>Scraping the merchant portal is not an official Grab API. Check the terms that apply to your account before running this in production, and keep the poll interval reasonable.</span>
        </div>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <span>MIT licensed · built for merchants who want their own data.</span>
    <span><a href="${repo}">GitHub</a> · <a href="/login">Sign in</a> · <a href="/health">Status</a></span>
  </div>
</footer>

</body>
</html>`;
}

module.exports = getLandingHTML;
