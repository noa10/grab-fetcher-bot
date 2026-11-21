// Vercel serverless function for health check
const database = require('../src/config/database');
const getHealthHTML = require('../src/api/health-template');
const { sanitizeDatabaseHealth } = require('../src/api/health-utils');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
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
      status: dbHealth.status === 'connected' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      database: sanitizeDatabaseHealth(dbHealth),
      uptime: process.uptime(),
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
    const message = 'Health check failed';
    if (acceptsHtml) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(500).send(getHealthHTML({ error: message }));
    }
    res.status(500).json({
      status: 'error',
      message,
      timestamp: new Date().toISOString()
    });
  }
};
