// Vercel serverless function for dashboard
const getDashboardHTML = require('../src/api/dashboard-template');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
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
