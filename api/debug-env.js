const database = require('../src/config/database');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  try {
    await database.connect();
    res.status(200).json({
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
      MONGODB_URI: process.env.MONGODB_URI ? 'set' : undefined,
      isConnected: database.isConnected,
      readyState: require('mongoose').connection.readyState,
      host: require('mongoose').connection.host,
      name: require('mongoose').connection.name,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      readyState: require('mongoose').connection.readyState,
    });
  }
};
