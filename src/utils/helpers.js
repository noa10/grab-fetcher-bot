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
 *
 * Grab's merchant portal renders timestamps in MYT (UTC+8) and omits the year.
 * Parsing this with the server's local timezone produced timestamps that were
 * off by 8 hours on a UTC host, which pushed orders placed before 08:00 MYT onto
 * the previous day and desynced them from the same-day dedup lookup.
 *
 * The instant is therefore built explicitly in UTC+8 and the year is inferred
 * from `referenceDate` (defaults to now, matching the portal's behaviour of
 * showing the current year's history).
 *
 * @param {string} str - Timestamp string, e.g. "31 Mar, Tue, 12:39 PM"
 * @param {Date} [referenceDate] - Date used to infer the missing year
 * @returns {Date} Parsed date, or the reference date if the string is unparseable
 */
const monthMap = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

// Grab merchant portal operates in Malaysia Time (UTC+8, no DST).
const GRAB_TZ_OFFSET_MINUTES = 8 * 60;

/**
 * Resolve a year-less MYT wall-clock time against a reference date.
 *
 * The portal lists recent history first, so a month/day that is in the future
 * relative to the reference belongs to the previous year (e.g. "28 Dec" seen in
 * early January is last December, not this December).
 */
function resolveGrabYear(month, day, referenceDate) {
  let year = referenceDate.getUTCFullYear();
  const candidate = Date.UTC(year, month, day);
  // Allow a small forward window: orders can be slightly ahead of the host clock.
  if (candidate - referenceDate.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
  }
  return year;
}

function parseGrabTimestamp(str, referenceDate = new Date()) {
  const reference = referenceDate instanceof Date && !isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date();

  // Guard before constructing a Date from the input: `new Date(null)` is a valid
  // epoch (1970), which would silently replace a missing timestamp with 1970.
  if (!str || typeof str !== 'string' || !str.trim()) {
    return new Date(reference);
  }

  // "27 Sep, Sun, 11:30 PM" (weekday shown) or "27 Sep, 11:30 PM" (omitted).
  const match = str.match(/(\d{1,2})\s+(\w{3}),(?:\s*[\w]{2,9},)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    // Not the portal format — accept a machine-parseable value if there is one.
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? new Date(reference) : fallback;
  }

  const [, day, monthStr, hour, min, ampm] = match;
  const month = monthMap[monthStr.toLowerCase()];
  if (month === undefined) {
    return new Date(reference);
  }

  let h = parseInt(hour);
  const upperAmpm = ampm.toUpperCase();
  if (upperAmpm === 'PM' && h !== 12) h += 12;
  else if (upperAmpm === 'AM' && h === 12) h = 0;

  const year = resolveGrabYear(month, parseInt(day), reference);
  const utcMs = Date.UTC(year, month, parseInt(day), h, parseInt(min))
    - GRAB_TZ_OFFSET_MINUTES * 60 * 1000;

  const parsed = new Date(utcMs);
  if (isNaN(parsed.getTime())) {
    return new Date(reference);
  }
  return parsed;
}

/**
 * Calendar-day helpers anchored to MYT (UTC+8).
 *
 * The dashboard speaks MYT calendar days, but serverless hosts run in UTC, so
 * parsing a YYYY-MM-DD filter value with `new Date()` treats it as a UTC day
 * and shifts every boundary by 8 hours — hiding orders placed between 00:00
 * and 07:59 MYT. Stored orderTimestamp values are true UTC instants, so
 * filters must query against the real instants of the MYT day boundaries.
 */

// YYYY-MM-DD of the current MYT calendar day (en-CA renders in that format).
function getMalaysiaDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function mytDayStart(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`);
}

function mytDayEnd(dateStr) {
  return new Date(`${dateStr}T23:59:59.999+08:00`);
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
  parseGrabTimestamp,
  getMalaysiaDateString,
  mytDayStart,
  mytDayEnd
};
