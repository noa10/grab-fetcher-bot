// Vercel serverless function for health check
const database = require('../src/config/database');

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
    // Connect to database for health check
    await database.connect();
    const dbHealth = await database.healthCheck();
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      deployment: 'vercel-serverless'
    };

    res.status(200).json(health);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
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
