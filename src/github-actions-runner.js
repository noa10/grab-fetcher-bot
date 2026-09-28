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
   * Whether we are inside a trading window (MYT / GMT+8).
   *
   * Delegates to GrabOrderFetcher so the scheduler has one definition of the
   * windows, and so changing OPERATING_HOURS in .env is the only edit needed to
   * reschedule. Required because the systemd timer fires every 5 minutes
   * regardless: without this the runner would hit the portal around the clock.
   */
  isWithinOperatingHours(date = new Date()) {
    // The window logic needs no instance state, so call it directly off the class
    // and skip constructing a fetcher (which would build a bot and browser).
    const GrabOrderFetcher = require('./index');
    const now = GrabOrderFetcher.getMytMinutesOfDay(date);
    return GrabOrderFetcher.getOperatingWindows().some(({ start, end }) => now >= start && now <= end);
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

      let totalNewOrders = 0;
      if (orders.length === 0) {
        logger.bot('No new orders found, proceeding with state sync...');
      } else {
        logger.bot(`Found ${orders.length} new orders`);

        // Process each order
        let processedCount = 0;
        for (const orderData of orders) {
          const processed = await this.processOrder(orderData);
          if (processed) processedCount++;
        }
        totalNewOrders = processedCount;

        logger.bot(`Successfully processed ${processedCount}/${orders.length} new orders`);
      }

      // Sync driver state and order status for ALL orders in history table
      const syncResult = await this.syncOrderStates();

      // Early-exit check: if nothing changed in either loop
      const hasChanges = totalNewOrders > 0 || syncResult.updatedCount > 0 || syncResult.registeredCount > 0;

      if (!hasChanges) {
        logger.bot('No updates needed — all orders up to date, no new orders found');
      }

      // Logout from portal before cleanup
      await this.logoutFromPortal();

      logger.performance('Poll cycle completed', startTime);
      logger.bot('Poll cycle completed — logged out from portal');

      return { success: true, ordersProcessed: totalNewOrders, stateUpdates: syncResult.updatedCount };

    } catch (error) {
      logger.error('Error during polling cycle:', error);
      logger.performance('Poll cycle (error)', startTime);
      
      // Attempt logout even on error
      try {
        await this.logoutFromPortal();
      } catch (logoutError) {
        logger.error('Failed to logout on error:', logoutError);
      }
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync driver state and order status for all orders in history table
   */
  async syncOrderStates() {
    try {
      logger.bot('Starting order state synchronization...');

      // Reuse the live extractor when its page is still current, mirroring index.js.
      if (!this.extractor || this.extractor.page !== this.bot.getPage()) {
        this.extractor = new OrderExtractor(this.bot.getPage());
      }
      const stateUpdates = await this.extractor.extractOrdersForStateUpdate();

      if (stateUpdates.length === 0) {
        logger.bot('No orders found for state sync');
        return { updatedCount: 0, registeredCount: 0, totalChecked: 0 };
      }

      let updatedCount = 0;
      let registeredCount = 0;
      let skippedUnknownDate = 0;

      for (const update of stateUpdates) {
        // Key the lookup on the order's OWN date, not today. The history table spans
        // many days; keying on toOrderDate(new Date()) made every non-today row miss
        // the lookup and fall into the insert branch, fabricating zero-value stubs.
        const orderTimestamp = update.orderTimestamp instanceof Date
          ? update.orderTimestamp
          : (update.orderTimestamp ? new Date(update.orderTimestamp) : null);

        if (!orderTimestamp || isNaN(orderTimestamp.getTime())) {
          // Without a reliable date we cannot match or dedup safely. Skip rather than
          // corrupt: an insert here would produce an undeduplicable duplicate.
          skippedUnknownDate++;
          logger.order(`Skipped state sync for ${update.orderNumber}: no usable order timestamp`);
          continue;
        }

        const orderDate = Order.toOrderDate(orderTimestamp);
        const existingOrder = await Order.findOne({ orderNumber: update.orderNumber, orderDate });

        if (existingOrder) {
          const needsUpdate = update.driverStatus && existingOrder.driverStatus !== update.driverStatus
            || existingOrder.status !== update.status;

          if (!needsUpdate) {
            continue;
          }

          const updateFields = {
            lastUpdated: new Date(),
          };

          if (update.driverStatus) {
            updateFields.driverStatus = update.driverStatus;
          }

          updateFields.status = update.status;

          await Order.updateOne(
            { orderNumber: update.orderNumber, orderDate },
            { $set: updateFields }
          );

          updatedCount++;
        } else if (update.status !== 'unknown' && update.orderNumber) {
          const order = new Order({
            orderNumber: update.orderNumber,
            longOrderId: update.longOrderId || '',
            orderDate,
            customerName: 'Customer',
            driverName: 'Pending',
            driverStatus: update.driverStatus,
            status: update.status,
            orderTimestamp,
            pricing: {
              subtotal: 0,
              deliveryFee: 0,
              serviceFee: 0,
              tax: 0,
              discount: 0,
              total: 0,
              currency: 'MYR',
            },
            orderDetails: {
              restaurantName: 'Grab Order',
              orderType: 'delivery',
              items: [],
              specialInstructions: '',
            },
            deliveryInfo: {
              address: '',
              coordinates: { latitude: null, longitude: null },
              estimatedDeliveryTime: null,
              actualDeliveryTime: null
            },
            source: 'grab-merchant-portal-history-state-sync',
          });

          await order.save();
          registeredCount++;
          logger.order(`Registered new order from state sync: ${update.orderNumber} (${orderDate.toISOString().slice(0, 10)})`);
        }
      }

      if (skippedUnknownDate > 0) {
        logger.bot(`State sync skipped ${skippedUnknownDate} order(s) with no usable timestamp`);
      }

      logger.bot(`State sync completed: ${updatedCount} orders updated, ${registeredCount} orders registered, ${stateUpdates.length} total checked`);
      return { updatedCount, registeredCount, totalChecked: stateUpdates.length, skippedUnknownDate };
    } catch (error) {
      logger.error('Failed to sync order states:', error);
      return { updatedCount: 0, registeredCount: 0, totalChecked: 0 };
    }
  }

  /**
   * Logout from Grab Merchant Portal
   */
  async logoutFromPortal() {
    try {
      await this.bot.logoutFromPortal();
    } catch (error) {
      logger.error('Failed to logout from portal:', error);
    }
  }

  /**
   * Process a single order
   */
  async processOrder(orderData) {
    try {
      logger.order(`Processing order: ${orderData.orderNumber}`);

      // Set orderDate for dedup (Grab reuses order numbers across dates)
      orderData.orderDate = Order.toOrderDate(orderData.orderTimestamp);

      // Check if order already exists for this date
      const existingOrder = await Order.findByOrderNumberAndDate(orderData.orderNumber, orderData.orderTimestamp);
      if (existingOrder) {
        logger.order(`Order ${orderData.orderNumber} already exists for this date, skipping`);
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
    // Respect trading hours before doing anything, including launching a browser.
    // The systemd timer fires every 5 minutes around the clock, so this is what
    // keeps the bot off the portal outside 11:00-15:00 and 17:00-22:30 MYT.
    // Set FORCE_POLL=true to override (useful for a manual one-off run).
    if (!runner.isWithinOperatingHours() && process.env.FORCE_POLL !== 'true') {
      const GrabOrderFetcher = require('./index');
      logger.bot(`Outside trading hours (${GrabOrderFetcher.describeSchedule()} MYT) — skipping poll.`);
      // Let the logger flush to disk before exiting, otherwise the skip is
      // invisible in the log and a silent overnight run looks like a crash.
      setTimeout(() => process.exit(0), 300);
      return;
    }

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
