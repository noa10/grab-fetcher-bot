const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists (skip on serverless environments)
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY === 'true';
const logsDir = isServerless ? '/tmp/logs' : path.join(process.cwd(), 'logs');
if (!isServerless) {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Failed to create logs directory:', err.message);
  }
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ' ' + JSON.stringify(meta);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const loggerTransports = [];
if (!isServerless) {
  loggerTransports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    })
  );
}
loggerTransports.push(new winston.transports.Console({ format: consoleFormat }));

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  defaultMeta: { service: 'grab-order-fetcher' },
  transports: loggerTransports,
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Add specific methods for different types of logging
logger.bot = (message, meta = {}) => {
  logger.info(`[BOT] ${message}`, meta);
};

logger.puppeteer = (message, meta = {}) => {
  logger.info(`[PUPPETEER] ${message}`, meta);
};

logger.database = (message, meta = {}) => {
  logger.info(`[DATABASE] ${message}`, meta);
};

logger.api = (message, meta = {}) => {
  logger.info(`[API] ${message}`, meta);
};

logger.order = (message, meta = {}) => {
  logger.info(`[ORDER] ${message}`, meta);
};

logger.screenshot = (message, meta = {}) => {
  logger.info(`[SCREENSHOT] ${message}`, meta);
};

logger.export = (message, meta = {}) => {
  logger.info(`[EXPORT] ${message}`, meta);
};

// Error handling for logger itself
logger.on('error', (error) => {
  console.error('Logger error:', error);
});

// Helper function to log performance metrics
logger.performance = (operation, startTime, meta = {}) => {
  const duration = Date.now() - startTime;
  logger.info(`[PERFORMANCE] ${operation} completed in ${duration}ms`, {
    operation,
    duration,
    ...meta
  });
};

// Helper function to log with context
logger.withContext = (context) => {
  return {
    info: (message, meta = {}) => logger.info(message, { context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { context, ...meta }),
    error: (message, meta = {}) => logger.error(message, { context, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { context, ...meta }),
  };
};

module.exports = logger;
