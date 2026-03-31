const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const { 
  generateScreenshotFilename, 
  ensureDirectory, 
  sanitizeFilename 
} = require('../utils/helpers');

class ScreenshotService {
  constructor() {
    this.screenshotDir = path.join(process.cwd(), 'screenshots');
    this.isEnabled = process.env.SCREENSHOT_ENABLED === 'true';
  }

  /**
   * Initialize screenshot service
   */
  async init() {
    try {
      if (!this.isEnabled) {
        logger.screenshot('Screenshot service disabled');
        return true;
      }

      // Ensure screenshot directory exists
      const dirCreated = await ensureDirectory(this.screenshotDir);
      if (!dirCreated) {
        throw new Error('Failed to create screenshot directory');
      }

      logger.screenshot('Screenshot service initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize screenshot service:', error);
      throw error;
    }
  }

  /**
   * Capture screenshot of the current page
   */
  async capturePageScreenshot(page, orderNumber, options = {}) {
    try {
      if (!this.isEnabled) {
        logger.screenshot('Screenshot capture skipped - service disabled');
        return null;
      }

      if (!page) {
        throw new Error('Page not available for screenshot');
      }

      logger.screenshot(`Capturing screenshot for order ${orderNumber}`);

      // Generate filename
      const filename = generateScreenshotFilename(orderNumber);
      const filepath = path.join(this.screenshotDir, filename);

      // Default screenshot options
      const screenshotOptions = {
        path: filepath,
        type: 'png',
        fullPage: true,
        ...options
      };
      
      // Only add quality for jpeg type
      if (options.type === 'jpeg') {
        screenshotOptions.quality = options.quality || 80;
      }

      // Capture screenshot
      await page.screenshot(screenshotOptions);

      // Verify file was created
      const fileExists = await fs.pathExists(filepath);
      if (!fileExists) {
        throw new Error('Screenshot file was not created');
      }

      logger.screenshot(`Screenshot saved: ${filename}`);
      
      return {
        filename: filename,
        filepath: filepath,
        relativePath: path.relative(process.cwd(), filepath),
        size: (await fs.stat(filepath)).size
      };
    } catch (error) {
      logger.error('Failed to capture screenshot:', error);
      return null;
    }
  }

  /**
   * Capture screenshot of a specific element
   */
  async captureElementScreenshot(page, selector, orderNumber, options = {}) {
    try {
      if (!this.isEnabled) {
        logger.screenshot('Element screenshot capture skipped - service disabled');
        return null;
      }

      if (!page) {
        throw new Error('Page not available for screenshot');
      }

      logger.screenshot(`Capturing element screenshot for order ${orderNumber}`);

      // Wait for element to be visible
      await page.waitForSelector(selector, { timeout: 5000 });
      const element = await page.$(selector);

      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Generate filename
      const filename = generateScreenshotFilename(`${orderNumber}_element`);
      const filepath = path.join(this.screenshotDir, filename);

      // Default screenshot options
      const screenshotOptions = {
        path: filepath,
        type: 'png',
        ...options
      };

      // Capture element screenshot
      await element.screenshot(screenshotOptions);

      // Verify file was created
      const fileExists = await fs.pathExists(filepath);
      if (!fileExists) {
        throw new Error('Element screenshot file was not created');
      }

      logger.screenshot(`Element screenshot saved: ${filename}`);
      
      return {
        filename: filename,
        filepath: filepath,
        relativePath: path.relative(process.cwd(), filepath),
        size: (await fs.stat(filepath)).size
      };
    } catch (error) {
      logger.error('Failed to capture element screenshot:', error);
      return null;
    }
  }

  /**
   * Capture screenshot of order details
   */
  async captureOrderDetailsScreenshot(page, orderNumber) {
    try {
      if (!this.isEnabled) {
        return null;
      }

      logger.screenshot(`Capturing order details screenshot for ${orderNumber}`);

      // Try to find order details container
      const detailSelectors = [
        '.order-details',
        '.order-detail',
        '.modal-content',
        '.detail-view',
        '[class*="order-detail"]',
        '[class*="order-info"]'
      ];

      let screenshotResult = null;

      for (const selector of detailSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            screenshotResult = await this.captureElementScreenshot(
              page, 
              selector, 
              `${orderNumber}_details`
            );
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // If no specific element found, capture full page
      if (!screenshotResult) {
        screenshotResult = await this.capturePageScreenshot(page, `${orderNumber}_full`);
      }

      return screenshotResult;
    } catch (error) {
      logger.error('Failed to capture order details screenshot:', error);
      return null;
    }
  }

  /**
   * Upload screenshot to cloud storage (if configured)
   */
  async uploadScreenshot(filepath) {
    try {
      // Check if Cloudinary is configured
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (!cloudName || !apiKey || !apiSecret) {
        logger.screenshot('Cloud storage not configured, keeping local file');
        return null;
      }

      // Note: Cloudinary integration would go here
      // For now, we'll just return the local path
      logger.screenshot('Cloud upload not implemented yet, using local storage');
      return null;
    } catch (error) {
      logger.error('Failed to upload screenshot:', error);
      return null;
    }
  }

  /**
   * Clean up old screenshots
   */
  async cleanupOldScreenshots(maxAgeHours = 24) {
    try {
      if (!this.isEnabled) {
        return 0;
      }

      logger.screenshot('Cleaning up old screenshots...');

      const files = await fs.readdir(this.screenshotDir);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.screenshotDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
          logger.screenshot(`Deleted old screenshot: ${file}`);
        }
      }

      logger.screenshot(`Cleaned up ${deletedCount} old screenshots`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old screenshots:', error);
      return 0;
    }
  }

  /**
   * Get screenshot statistics
   */
  async getScreenshotStats() {
    try {
      if (!this.isEnabled) {
        return { enabled: false, count: 0, totalSize: 0 };
      }

      const files = await fs.readdir(this.screenshotDir);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(this.screenshotDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }

      return {
        enabled: true,
        count: files.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        directory: this.screenshotDir
      };
    } catch (error) {
      logger.error('Failed to get screenshot stats:', error);
      return { enabled: this.isEnabled, count: 0, totalSize: 0, error: error.message };
    }
  }

  /**
   * Check if screenshot service is enabled
   */
  isScreenshotEnabled() {
    return this.isEnabled;
  }

  /**
   * Get screenshot directory path
   */
  getScreenshotDirectory() {
    return this.screenshotDir;
  }

  /**
   * Alias for cleanupOldScreenshots - used by GitHubActionsRunner
   */
  async cleanup() {
    return this.cleanupOldScreenshots(24);
  }
}

module.exports = ScreenshotService;
