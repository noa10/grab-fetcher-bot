// POST /api/auth/logout — clears the signed session cookie.
//
// The dashboard already calls this URL (it was 404ing on Vercel, so "Sign out"
// silently did nothing while the API stayed public).
const { clearSession } = require('../../src/api/serverless-auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  clearSession(res);
  res.status(200).json({ success: true, message: 'Logged out' });
};
