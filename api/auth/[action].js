// Single entry point for /api/auth/* (and the /login rewrite).
//
// Vercel treats every file under api/ as its own serverless function, and the
// Hobby plan caps the number of functions per deployment — three separate auth
// files pushed this project over it and failed the build. One dynamic route
// dispatching on the path segment keeps the URLs intact:
//
//   GET  /login                  -> login page   (rewritten to /api/auth/login)
//   POST /api/auth/login         -> issue cookie
//   POST /api/auth/logout        -> clear cookie
//   POST /api/auth/forgot-password
//
// The handlers themselves live in src/api/auth-handlers.js so they are not
// counted as functions.
const { login, logout, forgotPassword } = require('../../src/api/auth-handlers');

const HANDLERS = {
  login,
  logout,
  'forgot-password': forgotPassword
};

module.exports = async (req, res) => {
  // `action` is a single dynamic segment; Vercel also hands it over as an array
  // for catch-all routes, so normalise both shapes.
  const raw = req.query?.action;
  const action = Array.isArray(raw) ? raw[0] : raw;

  const handler = HANDLERS[action];
  if (!handler) {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ success: false, message: 'Unknown auth endpoint' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  await handler(req, res);
};
