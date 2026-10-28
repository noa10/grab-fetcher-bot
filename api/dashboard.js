// Vercel serverless function for dashboard
const getDashboardHTML = require('../src/api/dashboard-template');
const { readSession } = require('../src/api/serverless-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // The dashboard renders the merchant's own numbers, so it is not public: a
  // session cookie from /login is required before any HTML is produced.
  const { configured, session } = readSession(req);
  if (!configured) {
    res.status(503).send('This deployment is not configured: set SESSION_SECRET and ADMIN_USERNAME/ADMIN_PASSWORD.');
    return;
  }
  if (!session) {
    res.statusCode = 302;
    res.setHeader('Location', '/login');
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const dashboardHTML = getDashboardHTML();

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(dashboardHTML);
  } catch (error) {
    console.error('Error generating dashboard:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
