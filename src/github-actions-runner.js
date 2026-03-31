require('dotenv').config();

const logger = require('./utils/logger');
const database = require('./config/database');
const Order = require('./models/Order');
const GrabBot = require('./services/grabBot');
const OrderExtractor = require('./services/orderExtractor');
const ScreenshotService = require('./services/screenshotService');
const { 
  retryWithBackoff, 
  sleep, 
  cleanupOldFiles 
} = require('./utils/helpers');

class GitHubActionsRunner {
  constructor() {
    this.bot = new GrabBot();
    this.extractor = null;
    this.screenshotService = new ScreenshotService();
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
  }

  /**
   * Initialize the order fetcher for one-time run
   */
  async init() {
    try {
      logger.bot('Initializing Grab Order Fetcher for GitHub Actions...');

      // Connect to database
      await database.connect();
      logger.database('Database connected successfully');

      // Initialize screenshot service
      await this.screenshotService.init();

      // Initialize browser and login
      await this.bot.initBrowser();
      await this.bot.login();
      await this.bot.navigateToOrders();
      await this.bot.navigateToHistoryTab();

      // Initialize order extractor
      this.extractor = new OrderExtractor(this.bot.getPage());

      logger.bot('Grab Order Fetcher initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Grab Order Fetcher:', error);
      throw error;
    }
  }

  /**
   * Run a single polling cycle
   */
  async runOnce() {
    const startTime = Date.now();
    
    try {
      logger.bot('Starting single order polling cycle...');

      // Check if session is still valid
      const sessionValid = await this.bot.isSessionValid();
      if (!sessionValid) {
        logger.bot('Session invalid, re-initializing...');
        await this.reinitialize();
      }

      // Extract orders with retry mechanism
      const orders = await retryWithBackoff(
        () => this.extractor.extractOrders(),
        this.maxRetries,
        2000
      );

      if (orders.length === 0) {
        logger.bot('No new orders found');
        logger.performance('Poll cycle (no orders)', startTime);
        return { success: true, ordersProcessed: 0 };
      }

      logger.bot(`Found ${orders.length} new orders`);

      // Process each order
      let processedCount = 0;
      for (const orderData of orders) {
        const processed = await this.processOrder(orderData);
        if (processed) processedCount++;
      }

      logger.performance('Poll cycle completed', startTime);
      logger.bot(`Successfully processed ${processedCount}/${orders.length} orders`);

      return { success: true, ordersProcessed: processedCount };

    } catch (error) {
      logger.error('Error during polling cycle:', error);
      logger.performance('Poll cycle (error)', startTime);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process a single order
   */
  async processOrder(orderData) {
    try {
      logger.order(`Processing order: ${orderData.orderNumber}`);

      // Check if order already exists
      const existingOrder = await Order.findByOrderNumber(orderData.orderNumber);
      if (existingOrder) {
        logger.order(`Order ${orderData.orderNumber} already exists, skipping`);
        return false;
      }

      // Capture screenshot if enabled
      if (this.screenshotService.isScreenshotEnabled()) {
        const screenshotResult = await this.screenshotService.captureOrderDetailsScreenshot(
          this.bot.getPage(),
          orderData.orderNumber
        );

        if (screenshotResult) {
          orderData.screenshotPath = screenshotResult.relativePath;
          logger.screenshot(`Screenshot captured for order ${orderData.orderNumber}`);
        }
      }

      // Save order to database
      const order = new Order(orderData);
      await order.save();

      logger.order(`Order ${orderData.orderNumber} saved successfully`);
      logger.database(`Order stored: ${orderData.orderNumber} - ${orderData.pricing.currency} ${orderData.pricing.total}`);

      return true;
    } catch (error) {
      logger.error(`Failed to process order ${orderData.orderNumber}:`, error);
      
      // Try to save order with error flag
      try {
        const order = new Order({
          ...orderData,
          hasErrors: true,
          errorMessages: [{
            message: error.message,
            timestamp: new Date()
          }]
        });
        await order.save();
        logger.order(`Order ${orderData.orderNumber} saved with errors`);
        return true;
      } catch (saveError) {
        logger.error(`Failed to save order with errors:`, saveError);
        return false;
      }
    }
  }

  /**
   * Reinitialize browser and session
   */
  async reinitialize() {
    try {
      logger.bot('Reinitializing browser session...');
      
      await this.cleanup();
      await sleep(2000);
      
      await this.bot.initBrowser();
      await this.bot.login();
      await this.bot.navigateToOrders();
      
      this.extractor = new OrderExtractor(this.bot.getPage());
      
      logger.bot('Browser session reinitialized successfully');
    } catch (error) {
      logger.error('Failed to reinitialize browser session:', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.bot) {
        await this.bot.cleanup();
      }
      
      if (this.screenshotService) {
        await this.screenshotService.cleanup();
      }
      
      await database.disconnect();
      logger.bot('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      logger.bot('Performing maintenance tasks...');

      // Cleanup old screenshots (keep for 24 hours in GitHub Actions)
      const deletedScreenshots = await this.screenshotService.cleanupOldScreenshots(24);
      if (deletedScreenshots > 0) {
        logger.bot(`Cleaned up ${deletedScreenshots} old screenshots`);
      }

      // Cleanup old log files (keep for 72 hours in GitHub Actions)
      const deletedLogs = await cleanupOldFiles('./logs', 72);
      if (deletedLogs > 0) {
        logger.bot(`Cleaned up ${deletedLogs} old log files`);
      }

      logger.bot('Maintenance completed');
    } catch (error) {
      logger.error('Error during maintenance:', error);
    }
  }
}

// Main execution for GitHub Actions
async function main() {
  const runner = new GitHubActionsRunner();
  let exitCode = 0;

  try {
    // Initialize the runner
    await runner.init();

    // Run single polling cycle
    const result = await runner.runOnce();

    if (result.success) {
      logger.bot(`GitHub Actions run completed successfully. Processed ${result.ordersProcessed} orders.`);
    } else {
      logger.error(`GitHub Actions run failed: ${result.error}`);
      exitCode = 1;
    }

    // Perform maintenance every 10th run (approximately every 20 minutes)
    const runNumber = parseInt(process.env.GITHUB_RUN_NUMBER) || 0;
    if (runNumber % 10 === 0) {
      await runner.performMaintenance();
    }

  } catch (error) {
    logger.error('Failed to run GitHub Actions job:', error);
    exitCode = 1;
  } finally {
    // Always cleanup
    await runner.cleanup();
  }

  process.exit(exitCode);
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 GitHub Actions runner crashed:', error);
    process.exit(1);
  });
}

module.exports = GitHubActionsRunner;
