/**
 * Auth for the Vercel serverless deployment.
 *
 * Why this exists: the `api/` functions were written as an unauthenticated mirror
 * of the dashboard, with `Access-Control-Allow-Origin: *` on every data endpoint.
 * That published real customer names and phone numbers to anyone who asked.
 *
 * The self-hosted Express app can keep `express-session` because it is one long
 * process. Serverless has no shared session store, so this uses a stateless
 * HMAC-signed cookie instead: the signature is verified locally, and the only
 * thing that has to be shared across invocations is SESSION_SECRET.
 *
 * Deliberate choices:
 *  - No default secret. If no secret is configured everything fails closed with
 *    503 rather than signing with a value an attacker knows.
 *  - `Secure` unless COOKIE_SECURE is explicitly false, because every Vercel
 *    deployment terminates TLS.
 *  - The cookie carries the user id + expiry only. Revocation is by expiry
 *    (12h) or by rotating SESSION_SECRET, which invalidates every session.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'gf_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;
const DEFAULT_SECRET = 'grab-fetcher-secret-change-in-production';

function getSecret() {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret === DEFAULT_SECRET) return null;
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(input) {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload, secret) {
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  const given = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.uid) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieFlags(maxAge) {
  const secure = process.env.COOKIE_SECURE === 'false' ? '' : '; Secure';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function issueSession(res, user) {
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SECRET or SESSION_SECRET is not configured');

  const now = Math.floor(Date.now() / 1000);
  const token = sign({
    uid: String(user._id),
    username: user.username,
    iat: now,
    exp: now + MAX_AGE_SECONDS
  }, secret);

  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieFlags(MAX_AGE_SECONDS)}`);
  return token;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieFlags(0)}`);
}

/** Returns the session payload, or null. Distinguishes "unconfigured" from "anonymous". */
function readSession(req) {
  const secret = getSecret();
  if (!secret) return { configured: false, session: null };
  const cookies = parseCookies(req.headers?.cookie);
  return { configured: true, session: verify(cookies[COOKIE_NAME], secret) };
}

/**
 * Guard for every data endpoint.
 *
 * Returns true when the caller may proceed; otherwise writes the response itself
 * (401 JSON for API callers, 302 to /login for a browser asking for HTML).
 */
function requireAuth(req, res) {
  const { configured, session } = readSession(req);

  if (!configured) {
    res.status(503).json({
      success: false,
      error: 'AuthNotConfigured',
      message: 'Set SESSION_SECRET (or AUTH_SECRET) and ADMIN_USERNAME/ADMIN_PASSWORD on this deployment.'
    });
    return false;
  }

  if (session) return true;

  const wantsJson = String(req.url || '').startsWith('/api/')
    || String(req.headers?.accept || '').includes('application/json');

  if (wantsJson) {
    res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
  } else {
    res.statusCode = 302;
    res.setHeader('Location', '/login');
    res.end();
  }
  return false;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SECONDS,
  getSecret,
  sign,
  verify,
  parseCookies,
  issueSession,
  clearSession,
  readSession,
  requireAuth
};
