// Verifies the session-cookie fix by actually starting the server and logging in.
// Skipped unless a MongoDB instance is reachable.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'error';

const assert = require('assert');
const mongoose = require('mongoose');

const name = 'API session cookie';

const MONGODB_URI = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/grab_fetcher_test';
const PORT = 63999;
const BASE = `http://127.0.0.1:${PORT}`;

let server = null;
let child = null;

async function startServer(env) {
  const { spawn } = require('child_process');
  child = spawn(process.execPath, ['src/api/server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      MONGODB_URI,
      PORT: String(PORT),
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(64),
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'testpassword123',
      LOG_LEVEL: 'error',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for the port to accept connections.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server did not start');
}

function stopServer() {
  return new Promise(resolve => {
    if (!child) return resolve();
    const proc = child;
    child = null;
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}

// Between tests the port must be free again, otherwise the next server fails to
// bind and requests silently hit the previous process.
async function waitForPortRelease() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(500) });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      return; // connection refused => port released
    }
  }
}

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'testpassword123' }),
  });
  return res;
};

const tests = [
  {
    name: 'NODE_ENV=production over plain HTTP issues a usable cookie (regression)',
    fn: async () => {
      // Before the fix, cookie.secure was hardcoded to NODE_ENV === 'production',
      // so no Set-Cookie was emitted and every authed route redirected to /login.
      await startServer({});
      try {
        const res = await login();
        assert.strictEqual(res.status, 200);
        const setCookie = res.headers.get('set-cookie');
        assert.ok(setCookie, 'login must emit a Set-Cookie header');
        assert.ok(setCookie.includes('connect.sid='), `expected session cookie, got: ${setCookie}`);
        assert.ok(!/;\s*Secure/i.test(setCookie), 'must not be Secure over plain HTTP');

        const cookie = setCookie.split(';')[0];
        const dash = await fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie }, redirect: 'manual' });
        assert.strictEqual(dash.status, 200, 'dashboard should be reachable with the session cookie');

        const api = await fetch(`${BASE}/api/orders/recent`, { headers: { Cookie: cookie } });
        assert.strictEqual(api.status, 200, 'API should be reachable with the session cookie');
      } finally {
        await stopServer();
        await waitForPortRelease();
      }
    },
  },
  {
    name: 'COOKIE_SECURE=true suppresses the cookie over plain HTTP (documented)',
    fn: async () => {
      // express-session refuses to set a Secure cookie on a non-TLS request, which
      // is exactly why the default must stay off until TLS is really in front.
      // This test pins that behaviour so a future change is a deliberate one.
      await startServer({ COOKIE_SECURE: 'true' });
      try {
        const res = await login();
        assert.strictEqual(res.status, 200, 'login itself still succeeds');
        const setCookie = res.headers.get('set-cookie');
        assert.strictEqual(setCookie, null,
          'no cookie may be issued over plain HTTP when COOKIE_SECURE=true');
      } finally {
        await stopServer();
        await waitForPortRelease();
      }
    },
  },
  {
    name: 'unauthenticated API requests are rejected with 401 JSON',
    fn: async () => {
      // Regression: this used to 302 to the login page, because requireAuth tested
      // req.path (mount-relative) instead of req.originalUrl.
      await startServer({});
      try {
        const res = await fetch(`${BASE}/api/orders/recent`, { redirect: 'manual' });
        assert.strictEqual(res.status, 401);
        const body = await res.json();
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.error, 'Unauthorized');
      } finally {
        await stopServer();
        await waitForPortRelease();
      }
    },
  },
  {
    name: 'unauthenticated browser page requests redirect to /login',
    fn: async () => {
      await startServer({});
      try {
        const res = await fetch(`${BASE}/dashboard`, {
          redirect: 'manual',
          headers: { Accept: 'text/html' },
        });
        assert.strictEqual(res.status, 302, 'a page request should redirect, not 401');
        assert.strictEqual(res.headers.get('location'), '/login');
      } finally {
        await stopServer();
        await waitForPortRelease();
      }
    },
  },
  {
    name: 'login with a wrong password is rejected',
    fn: async () => {
      await startServer({});
      try {
        const res = await fetch(`${BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
        });
        assert.strictEqual(res.status, 401);
      } finally {
        await stopServer();
        await waitForPortRelease();
      }
    },
  },
  {
    name: 'cleanup',
    fn: async () => {
      await stopServer();
      await waitForPortRelease();
    },
  },
];

async function available() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.disconnect();
    return true;
  } catch (e) {
    try { await mongoose.disconnect(); } catch (e2) {}
    return false;
  }
}

module.exports = { name, tests, available };
