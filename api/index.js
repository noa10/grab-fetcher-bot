// Vercel serverless function for root endpoint
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    const response = {
      name: 'Grab Order Fetcher Bot API',
      version: '1.0.0',
      description: 'API for accessing fetched Grab orders',
      endpoints: {
        health: '/health',
        orders: '/api/orders',
        recent: '/api/orders/recent',
        stats: '/api/orders/stats',
        export: '/api/orders/export'
      },
      documentation: 'https://github.com/khairulanwar/grab-fetcher-bot',
      deployment: 'vercel-serverless'
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error in root endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
