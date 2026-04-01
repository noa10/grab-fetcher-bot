// Vercel serverless function for health check
const database = require('../src/config/database');
const getHealthHTML = require('../src/api/health-template');

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

  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

  try {
    await database.connect();
    const dbHealth = await database.healthCheck();
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      deployment: 'vercel-serverless'
    };

    if (acceptsHtml) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(getHealthHTML());
    }

    res.status(200).json(health);
  } catch (error) {
    console.error('Health check failed:', error);
    if (acceptsHtml) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(500).send(getHealthHTML({ error: error.message }));
    }
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
