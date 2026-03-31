// Vercel serverless function for recent orders
const database = require('../../src/config/database');
const Order = require('../../src/models/Order');

module.exports = async (req, res) => {
  // Set CORS headers
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
    // Connect to database
    await database.connect();

    // Get recent orders (last 24 hours by default)
    const hours = parseInt(req.query.hours) || 24;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours);

    const orders = await Order.find({
      orderTimestamp: { $gte: cutoffTime }
    })
    .sort({ orderTimestamp: -1 })
    .limit(limit)
    .lean();

    const response = {
      success: true,
      data: orders,
      meta: {
        timeframe: `Last ${hours} hours`,
        count: orders.length,
        cutoffTime: cutoffTime.toISOString(),
        timestamp: new Date().toISOString(),
        deployment: 'vercel-serverless'
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching recent orders:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  } finally {
    // Disconnect from database to avoid connection leaks
    try {
      await database.disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting from database:', disconnectError);
    }
  }
};
