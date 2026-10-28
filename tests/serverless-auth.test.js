// Serverless auth: the HMAC cookie and the endpoint guard.
//
// These run without a database on purpose — the signature/expiry logic and the
// "fail closed when unconfigured" behaviour are what keep the deployment from
// publishing customer data, and they must be provable on any checkout.
const assert = require('assert');
const {
  sign, verify, parseCookies, issueSession, clearSession, readSession, requireAuth, COOKIE_NAME
} = require('../src/api/serverless-auth');

const SECRET = 'test-secret-not-the-default';

/** Minimal res double: records status/headers/body, mirrors Express' API. */
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const NOW = Math.floor(Date.now() / 1000);
const validPayload = () => ({ uid: '507f1f77bcf86cd799439011', username: 'admin', iat: NOW, exp: NOW + 60 });

module.exports = {
  name: 'serverless auth',

  tests: [
    {
      name: 'a signed session verifies and round-trips the user id',
      fn: async () => {
        const token = sign(validPayload(), SECRET);
        const decoded = verify(token, SECRET);
        assert.ok(decoded, 'expected the token to verify');
        assert.strictEqual(decoded.uid, '507f1f77bcf86cd799439011');
      }
    },
    {
      name: 'a token signed with a different secret is rejected',
      fn: async () => {
        const token = sign(validPayload(), SECRET);
        assert.strictEqual(verify(token, 'another-secret'), null);
      }
    },
    {
      name: 'payload tampering breaks the signature',
      fn: async () => {
        const [body, sig] = sign(validPayload(), SECRET).split('.');
        const forgedBody = Buffer.from(JSON.stringify({ ...validPayload(), uid: 'evil' })).toString('base64url');
        assert.strictEqual(verify(`${forgedBody}.${sig}`, SECRET), null,
          'changing the body must invalidate the HMAC');
        assert.ok(body && sig);
      }
    },
    {
      name: 'an expired token is rejected even with a valid signature',
      fn: async () => {
        const token = sign({ ...validPayload(), exp: NOW - 1 }, SECRET);
        assert.strictEqual(verify(token, SECRET), null);
      }
    },
    {
      name: 'garbage and empty tokens are rejected without throwing',
      fn: async () => {
        for (const bad of ['', null, undefined, 'nonsense', 'a.b.c', '.', 'abc.']) {
          assert.strictEqual(verify(bad, SECRET), null, `expected ${JSON.stringify(bad)} to be rejected`);
        }
      }
    },
    {
      name: 'parseCookies handles several cookies and URL-encoded values',
      fn: async () => {
        const parsed = parseCookies('a=1; gf_session=abc%3Ddef; empty=');
        assert.strictEqual(parsed.a, '1');
        assert.strictEqual(parsed.gf_session, 'abc=def');
        assert.strictEqual(parsed.empty, '');
      }
    },
    {
      name: 'issueSession sets an HttpOnly, Secure, SameSite cookie',
      fn: async () => withEnv({ SESSION_SECRET: SECRET, AUTH_SECRET: undefined, COOKIE_SECURE: undefined }, async () => {
        const res = mockRes();
        issueSession(res, { _id: 'abc123', username: 'admin' });
        const cookie = res.getHeader('Set-Cookie');
        assert.ok(cookie.startsWith(`${COOKIE_NAME}=`), 'cookie name');
        assert.ok(/HttpOnly/.test(cookie), 'HttpOnly');
        assert.ok(/Secure/.test(cookie), 'Secure by default on HTTPS deployments');
        assert.ok(/SameSite=Lax/.test(cookie), 'SameSite');
        assert.ok(/Path=\//.test(cookie), 'Path');
        assert.ok(/Max-Age=\d+/.test(cookie), 'expiry');
      })
    },
    {
      name: 'clearSession expires the cookie',
      fn: async () => {
        const res = mockRes();
        clearSession(res);
        assert.ok(/Max-Age=0/.test(res.getHeader('Set-Cookie')));
      }
    },
    {
      name: 'requireAuth fails closed with 503 when no secret is configured',
      fn: async () => withEnv({ SESSION_SECRET: undefined, AUTH_SECRET: undefined }, async () => {
        const res = mockRes();
        const allowed = requireAuth({ url: '/api/orders', headers: { accept: 'application/json' } }, res);
        assert.strictEqual(allowed, false);
        assert.strictEqual(res.statusCode, 503);
        assert.strictEqual(res.body.error, 'AuthNotConfigured');
      })
    },
    {
      name: 'the shipped default secret is treated as unconfigured',
      fn: async () => withEnv({
        SESSION_SECRET: 'grab-fetcher-secret-change-in-production', AUTH_SECRET: undefined
      }, async () => {
        const res = mockRes();
        assert.strictEqual(requireAuth({ url: '/api/orders', headers: {} }, res), false);
        assert.strictEqual(res.statusCode, 503);
      })
    },
    {
      name: 'requireAuth rejects an anonymous API call with 401 JSON',
      fn: async () => withEnv({ SESSION_SECRET: SECRET, AUTH_SECRET: undefined }, async () => {
        const res = mockRes();
        const allowed = requireAuth({ url: '/api/orders/recent', headers: { accept: 'application/json' } }, res);
        assert.strictEqual(allowed, false);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(res.body.error, 'Unauthorized');
      })
    },
    {
      name: 'requireAuth redirects a browser to /login instead of JSON',
      fn: async () => withEnv({ SESSION_SECRET: SECRET, AUTH_SECRET: undefined }, async () => {
        const res = mockRes();
        const allowed = requireAuth({ url: '/dashboard', headers: { accept: 'text/html' } }, res);
        assert.strictEqual(allowed, false);
        assert.strictEqual(res.statusCode, 302);
        assert.strictEqual(res.getHeader('Location'), '/login');
      })
    },
    {
      name: 'requireAuth allows a request carrying a valid cookie',
      fn: async () => withEnv({ SESSION_SECRET: SECRET, AUTH_SECRET: undefined }, async () => {
        const token = sign(validPayload(), SECRET);
        const res = mockRes();
        const allowed = requireAuth({
          url: '/api/orders', headers: { accept: 'application/json', cookie: `${COOKIE_NAME}=${token}` }
        }, res);
        assert.strictEqual(allowed, true);
        assert.strictEqual(res.statusCode, 200, 'guard must not write a response when it allows');
      })
    },
    {
      name: 'readSession distinguishes unconfigured from anonymous',
      fn: async () => {
        const unconfigured = withEnv({ SESSION_SECRET: undefined, AUTH_SECRET: undefined },
          () => readSession({ headers: {} }));
        assert.strictEqual(unconfigured.configured, false);

        const anonymous = withEnv({ SESSION_SECRET: SECRET, AUTH_SECRET: undefined },
          () => readSession({ headers: {} }));
        assert.strictEqual(anonymous.configured, true);
        assert.strictEqual(anonymous.session, null);
      }
    }
  ]
};
