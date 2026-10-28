// GET /api/feedback — fetched reviews for the dashboard's Reviews view.
//
// Same query module the self-hosted Express route uses, so the two deployments
// cannot drift apart. Requires the session cookie like every other data route.
const database = require('../src/config/database');
const { requireAuth } = require('../src/api/serverless-auth');
const { listReviews } = require('../src/api/reviews-query');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!requireAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    await database.connect();
    const result = await listReviews(req.query || {});
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Feedback API error:', error);
    res.status(500).json({ success: false, message: 'Failed to load reviews' });
  }
};
