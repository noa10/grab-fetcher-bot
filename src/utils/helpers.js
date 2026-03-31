const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the specified time
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Generate a random delay between min and max milliseconds
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 * @returns {number} Random delay in milliseconds
 */
const randomDelay = (min = 1000, max = 3000) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Get a random user agent string
 * @returns {string} Random user agent string
 */
const getRandomUserAgent = () => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

/**
 * Sanitize filename for safe file system usage
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
};

/**
 * Ensure directory exists, create if it doesn't
 * @param {string} dirPath - Directory path
 * @returns {Promise<boolean>} True if directory exists or was created
 */
const ensureDirectory = async (dirPath) => {
  try {
    await fs.ensureDir(dirPath);
    return true;
  } catch (error) {
    logger.error(`Failed to ensure directory ${dirPath}:`, error);
    return false;
  }
};

/**
 * Format timestamp for filename
 * @param {Date} date - Date object
 * @returns {string} Formatted timestamp
 */
const formatTimestampForFilename = (date = new Date()) => {
  return date.toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .replace('T', '_')
    .slice(0, -5); // Remove milliseconds and Z
};

/**
 * Parse price string to number
 * @param {string} priceStr - Price string (e.g., "$12.50", "SGD 15.00")
 * @returns {number} Parsed price as number
 */
const parsePrice = (priceStr) => {
  if (!priceStr || typeof priceStr !== 'string') {
    return 0;
  }
  
  // Remove currency symbols and letters, keep numbers and decimal points
  const cleanPrice = priceStr.replace(/[^\d.]/g, '');
  const parsed = parseFloat(cleanPrice);
  
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Format price for display
 * @param {number} price - Price as number
 * @param {string} currency - Currency code
 * @returns {string} Formatted price string
 */
const formatPrice = (price, currency = 'SGD') => {
  if (typeof price !== 'number' || isNaN(price)) {
    return `${currency} 0.00`;
  }
  
  return `${currency} ${price.toFixed(2)}`;
};

/**
 * Validate order data structure
 * @param {Object} orderData - Order data object
 * @returns {Object} Validation result with isValid and errors
 */
const validateOrderData = (orderData) => {
  const errors = [];
  
  if (!orderData.orderNumber) {
    errors.push('Order number is required');
  }
  
  if (!orderData.customerName) {
    errors.push('Customer name is required');
  }
  
  if (!orderData.orderTimestamp) {
    errors.push('Order timestamp is required');
  }
  
  if (!orderData.pricing || typeof orderData.pricing.total !== 'number') {
    errors.push('Valid pricing information is required');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Result of the function or throws last error
 */
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
    }
  }
  
  throw lastError;
};

/**
 * Check if a date is within the last N minutes
 * @param {Date} date - Date to check
 * @param {number} minutes - Number of minutes
 * @returns {boolean} True if date is within the last N minutes
 */
const isWithinLastMinutes = (date, minutes) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - (minutes * 60 * 1000));
  return date >= cutoff;
};

/**
 * Generate screenshot filename
 * @param {string} orderNumber - Order number
 * @param {Date} timestamp - Timestamp
 * @returns {string} Screenshot filename
 */
const generateScreenshotFilename = (orderNumber, timestamp = new Date()) => {
  const sanitizedOrderNumber = sanitizeFilename(orderNumber);
  const formattedTimestamp = formatTimestampForFilename(timestamp);
  return `order_${sanitizedOrderNumber}_${formattedTimestamp}.png`;
};

/**
 * Parse Grab timestamp format: "31 Mar, Tue, 12:39 PM"
 * @param {string} str - Timestamp string
 * @returns {Date} Parsed date
 */
const monthMap = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function parseGrabTimestamp(str) {
  if (!str || typeof str !== 'string') return new Date();
  
  const match = str.match(/(\d{1,2})\s+(\w{3}),\s+\w+,\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    const [, day, monthStr, hour, min, ampm] = match;
    const month = monthMap[monthStr.toLowerCase()];
    if (month === undefined) return new Date();
    
    let h = parseInt(hour);
    const upperAmpm = ampm.toUpperCase();
    if (upperAmpm === 'PM' && h !== 12) h += 12;
    else if (upperAmpm === 'AM' && h === 12) h = 0;
    
    return new Date(new Date().getFullYear(), month, parseInt(day), h, parseInt(min));
  }
  
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

const cleanupOldFiles = async (dirPath, maxAgeHours = 24) => {
  try {
    const files = await fs.readdir(dirPath);
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime.getTime() < cutoffTime) {
        await fs.remove(filePath);
        deletedCount++;
        logger.debug(`Deleted old file: ${filePath}`);
      }
    }
    
    return deletedCount;
  } catch (error) {
    logger.error(`Failed to cleanup old files in ${dirPath}:`, error);
    return 0;
  }
};

module.exports = {
  sleep,
  randomDelay,
  getRandomUserAgent,
  sanitizeFilename,
  ensureDirectory,
  formatTimestampForFilename,
  parsePrice,
  formatPrice,
  validateOrderData,
  retryWithBackoff,
  isWithinLastMinutes,
  generateScreenshotFilename,
  cleanupOldFiles,
  parseGrabTimestamp
};
