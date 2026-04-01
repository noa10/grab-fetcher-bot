const mongoose = require('mongoose');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI environment variable is not set');
      }

      const options = {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        bufferCommands: true,
      };

      // Reconnect if connection was closed (warm container scenario)
      if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
        this.isConnected = false;
        this.connection = null;
      }

      if (this.isConnected && mongoose.connection.readyState === 1) {
        logger.info('Database already connected');
        return this.connection;
      }

      this.connection = await mongoose.connect(mongoUri, options);
      this.isConnected = true;

      logger.info('Successfully connected to MongoDB Atlas');

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
        this.isConnected = true;
      });

      return this.connection;
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    // Don't disconnect on serverless - keep connection alive for warm containers
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return;
    }
    try {
      if (this.connection) {
        await mongoose.disconnect();
        this.isConnected = false;
        logger.info('Disconnected from MongoDB');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
    }
  }

  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: 'disconnected', message: 'Not connected to database' };
      }

      // Simple ping to check connection
      await mongoose.connection.db.admin().ping();
      return { status: 'connected', message: 'Database connection is healthy' };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return { status: 'error', message: error.message };
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };
  }
}

// Create singleton instance
const database = new Database();

module.exports = database;
