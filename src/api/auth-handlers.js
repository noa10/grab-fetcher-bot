/**
 * Auth handlers for the serverless deployment, kept out of `api/` on purpose.
 *
 * Vercel counts every file under `api/` as a serverless function, and the Hobby
 * plan caps that per deployment. Three tiny auth files (login, logout, forgot)
 * were enough to tip the project over the limit and fail the build, so they live
 * here and `api/auth/[action].js` dispatches to them — one function for all three
 * routes instead of three.
 */
const database = require('../config/database');
const User = require('../models/User');
const logger = require('../utils/logger');
const getLoginHTML = require('./login-template');
const { issueSession, clearSession, getSecret } = require('./serverless-auth');

// Best-effort throttle. Vercel may run several warm instances, so this is not a
// guarantee — it raises the cost of naive credential stuffing without pretending
// to be a real rate limiter (that needs a shared store).
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(ip, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body;
}

/** First run: create the admin from env if the collection is empty. */
async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return false;

  const count = await User.estimatedDocumentCount();
  if (count > 0) return true;

  await User.create({ username, password, role: 'admin' });
  logger.api('Created the admin user from ADMIN_USERNAME/ADMIN_PASSWORD');
  return true;
}

async function login(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(getLoginHTML());
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  // Fail closed: without a signing secret no session could be trusted anyway.
  if (!getSecret()) {
    res.status(503).json({
      success: false,
      message: 'This deployment is missing SESSION_SECRET. Set it in the environment and redeploy.'
    });
    return;
  }

  const ip = clientIp(req);
  if (tooManyAttempts(ip)) {
    res.status(429).json({ success: false, message: 'Too many login attempts. Try again in 15 minutes.' });
    return;
  }

  const { username, password } = readBody(req);
  if (!username || !password) {
    res.status(400).json({ success: false, message: 'Username and password are required' });
    return;
  }

  try {
    await database.connect();
    await ensureAdmin();

    const user = await User.findOne({ username: String(username).trim().toLowerCase() });
    const ok = user ? await user.comparePassword(String(password)) : false;

    if (!ok) {
      // Same message and roughly the same shape for "no such user" and "wrong
      // password" so the endpoint does not confirm which usernames exist.
      logger.warn(`Failed login for "${username}" from ${ip}`);
      res.status(401).json({ success: false, message: 'Invalid username or password' });
      return;
    }

    if (user.isActive === false) {
      res.status(403).json({ success: false, message: 'This account is disabled' });
      return;
    }

    issueSession(res, user);
    user.lastLogin = new Date();
    await user.save().catch(() => {});

    logger.api(`Login succeeded for "${user.username}" from ${ip}`);
    res.status(200).json({ success: true, user: user.toJSON() });
  } catch (error) {
    logger.error('Serverless login failed:', error);
    res.status(500).json({ success: false, message: 'Login failed. Check the deployment logs.' });
  }
}

async function logout(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  clearSession(res);
  res.status(200).json({ success: true, message: 'Logged out' });
}

async function forgotPassword(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  // No mail transport and no shared token store on a serverless deployment, so
  // advertising a reset it cannot deliver would be worse than saying so. The
  // response is identical for every username, so it cannot enumerate accounts.
  res.status(501).json({
    success: false,
    message: 'Password reset is not available on this deployment. Change ADMIN_PASSWORD in the environment and redeploy.'
  });
}

module.exports = { login, logout, forgotPassword };
