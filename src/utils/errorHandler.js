const logger = require('./logger');

/**
 * Custom error classes for different types of errors
 */
class GrabBotError extends Error {
  constructor(message, type = 'GENERAL', details = {}) {
    super(message);
    this.name = 'GrabBotError';
    this.type = type;
    this.details = details;
    this.timestamp = new Date();
  }
}

class LoginError extends GrabBotError {
  constructor(message, details = {}) {
    super(message, 'LOGIN_ERROR', details);
    this.name = 'LoginError';
  }
}

class NavigationError extends GrabBotError {
  constructor(message, details = {}) {
    super(message, 'NAVIGATION_ERROR', details);
    this.name = 'NavigationError';
  }
}

class ExtractionError extends GrabBotError {
  constructor(message, details = {}) {
    super(message, 'EXTRACTION_ERROR', details);
    this.name = 'ExtractionError';
  }
}

class DatabaseError extends GrabBotError {
  constructor(message, details = {}) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

class ScreenshotError extends GrabBotError {
  constructor(message, details = {}) {
    super(message, 'SCREENSHOT_ERROR', details);
    this.name = 'ScreenshotError';
  }
}

/**
 * Error handler class for centralized error management
 */
class ErrorHandler {
  constructor() {
    this.errorCounts = new Map();
    this.lastErrors = [];
    this.maxLastErrors = 100;
  }

  /**
   * Handle and log errors with context
   */
  handle(error, context = {}) {
    const errorInfo = {
      message: error.message,
      name: error.name,
      type: error.type || 'UNKNOWN',
      stack: error.stack,
      timestamp: new Date(),
      context: context
    };

    // Log the error
    logger.error(`[${errorInfo.type}] ${errorInfo.message}`, {
      error: errorInfo,
      context: context
    });

    // Track error counts
    const errorKey = `${error.name}:${error.message}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    // Store in recent errors list
    this.lastErrors.unshift(errorInfo);
    if (this.lastErrors.length > this.maxLastErrors) {
      this.lastErrors = this.lastErrors.slice(0, this.maxLastErrors);
    }

    return errorInfo;
  }

  /**
   * Handle login errors specifically
   */
  handleLoginError(error, context = {}) {
    const loginError = new LoginError(error.message, {
      originalError: error,
      ...context
    });

    return this.handle(loginError, {
      action: 'login',
      ...context
    });
  }

  /**
   * Handle navigation errors specifically
   */
  handleNavigationError(error, context = {}) {
    const navError = new NavigationError(error.message, {
      originalError: error,
      ...context
    });

    return this.handle(navError, {
      action: 'navigation',
      ...context
    });
  }

  /**
   * Handle extraction errors specifically
   */
  handleExtractionError(error, context = {}) {
    const extractError = new ExtractionError(error.message, {
      originalError: error,
      ...context
    });

    return this.handle(extractError, {
      action: 'extraction',
      ...context
    });
  }

  /**
   * Handle database errors specifically
   */
  handleDatabaseError(error, context = {}) {
    const dbError = new DatabaseError(error.message, {
      originalError: error,
      ...context
    });

    return this.handle(dbError, {
      action: 'database',
      ...context
    });
  }

  /**
   * Handle screenshot errors specifically
   */
  handleScreenshotError(error, context = {}) {
    const screenshotError = new ScreenshotError(error.message, {
      originalError: error,
      ...context
    });

    return this.handle(screenshotError, {
      action: 'screenshot',
      ...context
    });
  }

  /**
   * Check if an error is recoverable
   */
  isRecoverable(error) {
    const recoverableErrors = [
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NETWORK_CHANGED',
      'Navigation timeout',
      'Target closed',
      'Session closed',
      'Connection refused',
      'ECONNRESET',
      'ETIMEDOUT'
    ];

    return recoverableErrors.some(pattern => 
      error.message.includes(pattern) || 
      error.stack?.includes(pattern)
    );
  }

  /**
   * Get recovery strategy for an error
   */
  getRecoveryStrategy(error) {
    if (error.message.includes('Target closed') || error.message.includes('Session closed')) {
      return 'REINITIALIZE_BROWSER';
    }

    if (error.message.includes('Navigation timeout') || error.message.includes('net::')) {
      return 'RETRY_WITH_DELAY';
    }

    if (error.message.includes('login') || error.message.includes('authentication')) {
      return 'RELOGIN';
    }

    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return 'WAIT_AND_RETRY';
    }

    return 'LOG_AND_CONTINUE';
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {
      totalErrors: this.lastErrors.length,
      errorCounts: Object.fromEntries(this.errorCounts),
      recentErrors: this.lastErrors.slice(0, 10),
      errorsByType: {}
    };

    // Group errors by type
    this.lastErrors.forEach(error => {
      const type = error.type || 'UNKNOWN';
      stats.errorsByType[type] = (stats.errorsByType[type] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clear error history
   */
  clearErrorHistory() {
    this.errorCounts.clear();
    this.lastErrors = [];
    logger.info('Error history cleared');
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 10) {
    return this.lastErrors.slice(0, limit);
  }

  /**
   * Check if error rate is too high
   */
  isErrorRateHigh(timeWindowMinutes = 10, maxErrors = 20) {
    const cutoff = new Date(Date.now() - (timeWindowMinutes * 60 * 1000));
    const recentErrors = this.lastErrors.filter(error => error.timestamp > cutoff);
    
    return recentErrors.length > maxErrors;
  }
}

/**
 * Global error handler for uncaught exceptions
 */
function setupGlobalErrorHandlers(errorHandler) {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    errorHandler.handle(error, { type: 'UNCAUGHT_EXCEPTION' });
    
    // Give time for logging then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    errorHandler.handle(new Error(reason), { 
      type: 'UNHANDLED_REJECTION',
      promise: promise.toString()
    });
  });

  // Handle warnings
  process.on('warning', (warning) => {
    logger.warn('Process Warning:', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack
    });
  });
}

/**
 * Async error wrapper for better error handling
 */
function asyncErrorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw error; // Re-throw to be handled by caller
    }
  };
}

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithErrorHandling(fn, maxRetries = 3, baseDelay = 1000, errorHandler = null) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (errorHandler) {
        errorHandler.handle(error, { attempt: attempt + 1, maxRetries });
      }
      
      if (attempt === maxRetries) {
        break;
      }
      
      // Check if error is recoverable
      if (errorHandler && !errorHandler.isRecoverable(error)) {
        logger.warn('Non-recoverable error, stopping retries');
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Create singleton error handler instance
const errorHandler = new ErrorHandler();

module.exports = {
  ErrorHandler,
  GrabBotError,
  LoginError,
  NavigationError,
  ExtractionError,
  DatabaseError,
  ScreenshotError,
  errorHandler,
  setupGlobalErrorHandlers,
  asyncErrorHandler,
  retryWithErrorHandling
};
