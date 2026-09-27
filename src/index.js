require('dotenv').config();

const cron = require('cron');
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

// Default trading windows in MYT (UTC+8): a mid-afternoon break, so the bot
// stays off the portal between 15:00 and 17:00.
const DEFAULT_OPERATING_HOURS = '11:00-15:00,17:00-22:30';

/**
 * Read a possibly-dotted path off a mongoose document (or plain object).
 * e.g. resolvePath(doc, 'pricing.total') -> number
 */
function resolvePath(obj, path) {
  if (!obj) return undefined;
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Compare a candidate value against the current one, tolerating the type
 * mismatches that appear between mongoose docs and plain extracted objects
 * (Date vs ISO string, subdocument vs plain object, missing keys).
 */
function isSameValue(current, next) {
  if (current === undefined || current === null) {
    return next === undefined || next === null || next === '';
  }
  if (next === undefined || next === null) {
    return current === null || current === '';
  }
  if (current instanceof Date || next instanceof Date) {
    const a = current instanceof Date ? current.getTime() : new Date(current).getTime();
    const b = next instanceof Date ? next.getTime() : new Date(next).getTime();
    if (isNaN(a) || isNaN(b)) return String(current) === String(next);
    return a === b;
  }
  if (typeof current === 'object' && typeof next === 'object') {
    return JSON.stringify(current) === JSON.stringify(next);
  }
  return current === next;
}

class GrabOrderFetcher {
  constructor() {
    this.bot = new GrabBot();
    this.extractor = null;
    this.screenshotService = new ScreenshotService();
    this.isRunning = false;
    this.isPolling = false;
    this.pollingInterval = parseInt(process.env.POLLING_INTERVAL_MINUTES) || 5;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    this.cronJob = null;
  }

  /**
   * Initialize the order fetcher
   */
  async init() {
    try {
      logger.bot('Initializing Grab Order Fetcher...');

      // Connect to database
      await database.connect();
      logger.database('Database connected successfully');

      // Initialize screenshot service
      await this.screenshotService.init();

      // Initialize browser and login
      await this.bot.initBrowser();
      await this.bot.login();
      await this.bot.navigateToOrders();
      
      // Navigate to History tab
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
   * Get the MYT (UTC+8) time of day in minutes since midnight.
   * Malaysia has no DST, so a fixed +8 offset is correct year-round.
   */
  static getMytMinutesOfDay(date = new Date()) {
    return ((date.getUTCHours() + 8) % 24) * 60 + date.getUTCMinutes();
  }

  /**
   * Parse an operating window like "11:00-15:00" into minutes since midnight.
   */
  static parseWindow(spec) {
    const match = String(spec).trim().match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
    if (!match) {
      throw new Error(`Invalid operating window "${spec}". Expected "HH:MM-HH:MM", e.g. "11:00-15:00"`);
    }
    const [, sh, sm, eh, em] = match;
    const start = parseInt(sh) * 60 + parseInt(sm || 0);
    const end = parseInt(eh) * 60 + parseInt(em || 0);
    if (start > end) {
      throw new Error(`Invalid operating window "${spec}": start must not be after end`);
    }
    return { start, end };
  }

  /**
   * Operating windows in MYT. Defaults to the merchant's trading hours with a
   * mid-afternoon break, overridable via OPERATING_HOURS (comma-separated).
   *
   *   OPERATING_HOURS=11:00-15:00,17:00-22:30
   *
   * Outside every window pollForOrders() returns immediately, so the cron job
   * can keep a simple "every N minutes" schedule and this decides whether to act.
   */
  static getOperatingWindows() {
    const spec = process.env.OPERATING_HOURS || DEFAULT_OPERATING_HOURS;
    return spec
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(GrabOrderFetcher.parseWindow);
  }

  /**
   * Check whether we are inside any operating window (MYT / GMT+8).
   */
  isWithinOperatingHours(date = new Date()) {
    const now = GrabOrderFetcher.getMytMinutesOfDay(date);
    return GrabOrderFetcher.getOperatingWindows().some(
      ({ start, end }) => now >= start && now <= end
    );
  }

  /**
   * Human-readable schedule for logs and the dashboard.
   */
  static describeSchedule() {
    const windows = GrabOrderFetcher.getOperatingWindows();
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return windows.map(w => `${fmt(w.start)}-${fmt(w.end)}`).join(', ');
  }

  /**
   * Start the polling process
   */
  async startPolling() {
    try {
      if (this.isRunning) {
        logger.bot('Polling is already running');
        return;
      }

      logger.bot(`Starting polling every ${this.pollingInterval} minutes (MYT windows: ${GrabOrderFetcher.describeSchedule()})...`);
      this.isRunning = true;

      // Set up cron job for polling
      const cronPattern = `*/${this.pollingInterval} * * * *`; // Every N minutes
      
      this.cronJob = new cron.CronJob(cronPattern, async () => {
        await this.pollForOrders();
      }, null, true, 'UTC');

      // Run initial poll
      await this.pollForOrders();

      logger.bot('Polling started successfully');
    } catch (error) {
      logger.error('Failed to start polling:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the polling process
   */
  async stopPolling() {
    try {
      logger.bot('Stopping polling...');
      this.isRunning = false;

      if (this.cronJob) {
        this.cronJob.stop();
        this.cronJob = null;
      }

      await this.bot.close();
      await database.disconnect();

      logger.bot('Polling stopped successfully');
    } catch (error) {
      logger.error('Error stopping polling:', error);
    }
  }

  /**
   * Poll for new orders
   */
  async pollForOrders() {
    if (!this.isWithinOperatingHours()) {
      return;
    }

    if (this.isPolling) {
      logger.bot('Poll cycle already running, skipping...');
      return;
    }

    const startTime = Date.now();
    
    try {
      this.isPolling = true;

      if (!this.isRunning) {
        return;
      }

      logger.bot('Starting order polling cycle...');

      // Check if session is still valid
      const sessionValid = await this.bot.isSessionValid();
      if (!sessionValid) {
        logger.bot('Session invalid, re-initializing...');
        await this.reinitialize();
      }

      // Navigate to Orders page and History tab
      try {
        await this.bot.navigateToOrders();
        await this.bot.navigateToHistoryTab();
      } catch (navError) {
        logger.error('Failed to navigate to orders/history:', navError);
        if (navError.message.includes('detached') || navError.message.includes('not valid')) {
          await this.reinitialize();
          try {
            await this.bot.navigateToOrders();
            await this.bot.navigateToHistoryTab();
          } catch (retryError) {
            logger.error('Navigation failed after reinitialize:', retryError);
            return;
          }
        } else {
          await this.reinitialize();
        }
      }

      if (!this.bot.isPageValid()) {
        logger.error('Page is not valid after navigation, reinitializing...');
        await this.reinitialize();
        try {
          await this.bot.navigateToOrders();
          await this.bot.navigateToHistoryTab();
        } catch (retryError) {
          logger.error('Navigation failed after reinitialize:', retryError);
          return;
        }
      }

      // Reuse the existing extractor when the page object is unchanged. Constructing
      // a new one every cycle reset lastPollTime to null, which made filterNewOrders
      // fall back to "now - 365 days" and re-extract the entire visible history table
      // (clicking every drawer, every poll) instead of just new orders. A new page
      // object still forces a fresh extractor, since the old one holds a dead page.
      if (!this.extractor || this.extractor.page !== this.bot.getPage()) {
        this.extractor = new OrderExtractor(this.bot.getPage());
      }

      // Extract orders with retry mechanism
      const orders = await retryWithBackoff(
        () => this.extractor.extractOrders(),
        this.maxRetries,
        2000
      );

      if (orders.length === 0) {
        logger.bot('No new orders found, proceeding with state sync...');
      } else {
        logger.bot(`Found ${orders.length} new orders`);

        // Process each order
        for (const orderData of orders) {
          await this.processOrder(orderData);
        }
      }

      // Sync driver state and order status for ALL orders in history table
      const syncResult = await this.syncOrderStates();

      // Early-exit check: if nothing changed in either loop, skip further work
      const hasChanges = orders.length > 0 || syncResult.updatedCount > 0 || syncResult.registeredCount > 0;

      if (!hasChanges) {
        logger.bot('No updates needed — all orders up to date, no new orders found');
      }

      // Logout from portal after cycle completes
      await this.logoutFromPortal();

      logger.bot('Poll cycle completed — logged out from portal');

      // Cleanup old files periodically
      if (Math.random() < 0.1) { // 10% chance each poll
        await this.performMaintenance();
      }

      logger.performance('Poll cycle completed', startTime, { ordersFound: orders.length });
    } catch (error) {
      logger.error('Error during polling cycle:', error);
      
      // Try to recover from errors
      try {
        await this.handlePollingError(error);
      } catch (recoveryError) {
        logger.error('Failed to recover from polling error:', recoveryError);
      }
    } finally {
      this.isPolling = false;
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
        logger.order(`Order ${orderData.orderNumber} already exists for this date, updating with fresh data...`);

        // Preserve customer name if drawer shows *** (expired after 15 min)
        if (orderData._preserveCustomerName && existingOrder.customerName && existingOrder.customerName !== 'Customer') {
          orderData.customerName = existingOrder.customerName;
          logger.order(`Preserved existing customer name: ${existingOrder.customerName}`);
        }

        // Update existing order with fresh data
        const updateFields = {
          driverName: orderData.driverName !== 'Pending' ? orderData.driverName : existingOrder.driverName,
          driverPhone: orderData.driverPhone || existingOrder.driverPhone,
          driverPhotoUrl: orderData.driverPhotoUrl || existingOrder.driverPhotoUrl,
          driverStatus: orderData.driverStatus || existingOrder.driverStatus,
          customerPhone: orderData.customerPhone || existingOrder.customerPhone,
          customerNote: orderData.customerNote || existingOrder.customerNote,
          status: orderData.status !== 'pending' ? orderData.status : existingOrder.status,
          orderTimestamp: orderData.orderTimestamp !== existingOrder.orderTimestamp ? orderData.orderTimestamp : existingOrder.orderTimestamp,
          'orderDetails.items': orderData.orderDetails.items.length > 0 ? orderData.orderDetails.items : existingOrder.orderDetails.items,
          'pricing.subtotal': orderData.pricing.subtotal || existingOrder.pricing.subtotal,
          'pricing.total': orderData.pricing.total || existingOrder.pricing.total,
          'pricing.discount': orderData.pricing.discount || existingOrder.pricing.discount,
        };

        // Only write when a value actually differs. Compare field-to-field: the
        // previous check compared each scalar against JSON.stringify(wholeDocument),
        // which is never equal, so every poll rewrote every order.
        const hasChanges = Object.entries(updateFields).some(([path, value]) =>
          !isSameValue(resolvePath(existingOrder, path), value)
        );

        if (hasChanges) {
          updateFields.lastUpdated = new Date();
          // orderDate MUST be part of the filter: Grab reuses order numbers across
          // dates, so an orderNumber-only update writes to an arbitrary match.
          await Order.updateOne(
            { orderNumber: orderData.orderNumber, orderDate: orderData.orderDate },
            { $set: updateFields }
          );
          logger.order(`Order ${orderData.orderNumber} updated with fresh data`);
        } else {
          logger.order(`Order ${orderData.orderNumber} already up to date`);
        }
        return;
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
      } catch (saveError) {
        logger.error(`Failed to save order with errors:`, saveError);
      }
    }
  }

  /**
   * Sync driver state and order status for all orders in history table
   */
  async syncOrderStates() {
    try {
      logger.bot('Starting order state synchronization...');

      // Reuse the live extractor when its page is still current. Building a second
      // extractor here (as this used to) worked against a different page object than
      // the one extractOrders() just used, and made the method untestable in isolation.
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
   * Handle polling errors and attempt recovery
   */
  async handlePollingError(error) {
    logger.bot('Attempting to recover from polling error...');

    // If it's a browser/page error, try to reinitialize
    if (error.message.includes('Target closed') || 
        error.message.includes('Session closed') ||
        error.message.includes('Navigation failed')) {
      
      logger.bot('Browser error detected, reinitializing...');
      await this.reinitialize();
      return;
    }

    // If it's a network error, wait and retry
    if (error.message.includes('net::') || 
        error.message.includes('timeout')) {
      
      logger.bot('Network error detected, waiting before retry...');
      await sleep(30000); // Wait 30 seconds
      return;
    }

    // For other errors, just log and continue
    logger.bot('Unknown error, continuing with next poll cycle');
  }

  /**
   * Reinitialize the bot after errors
   */
  async reinitialize() {
    try {
      logger.bot('Reinitializing bot...');
      
      // Close existing browser
      await this.bot.close();
      
      // Wait a bit before reinitializing
      await sleep(5000);
      
      // Reinitialize
      await this.bot.initBrowser();
      await this.bot.login();
      await this.bot.navigateToOrders();
      
      // Update extractor with new page
      this.extractor = new OrderExtractor(this.bot.getPage());
      
      logger.bot('Bot reinitialized successfully');
    } catch (error) {
      logger.error('Failed to reinitialize bot:', error);
      throw error;
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      logger.bot('Performing maintenance tasks...');

      // Cleanup old screenshots
      const deletedScreenshots = await this.screenshotService.cleanupOldScreenshots(24);
      if (deletedScreenshots > 0) {
        logger.bot(`Cleaned up ${deletedScreenshots} old screenshots`);
      }

      // Cleanup old log files
      const deletedLogs = await cleanupOldFiles('./logs', 168); // 7 days
      if (deletedLogs > 0) {
        logger.bot(`Cleaned up ${deletedLogs} old log files`);
      }

      logger.bot('Maintenance completed');
    } catch (error) {
      logger.error('Error during maintenance:', error);
    }
  }

  /**
   * Get system status
   */
  async getStatus() {
    try {
      const dbStatus = await database.healthCheck();
      const screenshotStats = await this.screenshotService.getScreenshotStats();
      const orderStats = await Order.getOrderStats(7);

      return {
        isRunning: this.isRunning,
        pollingInterval: this.pollingInterval,
        database: dbStatus,
        screenshots: screenshotStats,
        orders: orderStats[0] || { totalOrders: 0, totalRevenue: 0 },
        lastPollTime: this.extractor ? this.extractor.getLastPollTime() : null,
        uptime: process.uptime()
      };
    } catch (error) {
      logger.error('Error getting status:', error);
      return { error: error.message };
    }
  }
}

// Main execution
async function main() {
  const fetcher = new GrabOrderFetcher();

  try {
    // Initialize the fetcher
    await fetcher.init();

    // Start polling
    await fetcher.startPolling();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.bot('Received SIGINT, shutting down gracefully...');
      await fetcher.stopPolling();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.bot('Received SIGTERM, shutting down gracefully...');
      await fetcher.stopPolling();
      process.exit(0);
    });

    logger.bot('Grab Order Fetcher is running...');

  } catch (error) {
    logger.error('Failed to start Grab Order Fetcher:', error);
    process.exit(1);
  }
}

// Export for use in other modules
module.exports = GrabOrderFetcher;

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}
