const mongoose = require('mongoose');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      if (this.isConnected) {
        logger.info('Database already connected');
        return this.connection;
      }

      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI environment variable is not set');
      }

      // Connection options for MongoDB Atlas
      const options = {
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        bufferCommands: false, // Disable mongoose buffering
      };

      this.connection = await mongoose.connect(mongoUri, options);
      this.isConnected = true;

      // Wait for mongoose to be fully connected before allowing queries
      if (mongoose.connection.readyState !== 1) {
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (mongoose.connection.readyState === 1) {
              clearInterval(check);
              resolve();
            }
          }, 50);
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 3000);
        });
      }

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
    try {
      if (this.connection) {
        await mongoose.disconnect();
        this.isConnected = false;
        logger.info('Disconnected from MongoDB');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
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
