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

class GrabOrderFetcher {
  constructor() {
    this.bot = new GrabBot();
    this.extractor = null;
    this.screenshotService = new ScreenshotService();
    this.isRunning = false;
    this.isPolling = false;
    this.pollingInterval = parseInt(process.env.POLLING_INTERVAL_MINUTES) || 2;
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
   * Check if we are within operating hours (11:00 AM - 10:30 PM MYT / GMT+8)
   */
  isWithinOperatingHours() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const mytTotalMinutes = ((utcHours + 8) % 24) * 60 + utcMinutes;
    
    const startMinutes = 11 * 60;
    const endMinutes = 22 * 60 + 30;
    
    return mytTotalMinutes >= startMinutes && mytTotalMinutes <= endMinutes;
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

      logger.bot(`Starting polling every ${this.pollingInterval} minutes (11:00 AM - 10:30 PM MYT)...`);
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

      this.extractor = new OrderExtractor(this.bot.getPage());

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
          lastUpdated: new Date()
        };
        
        // Only update if there are actual changes
        const hasChanges = Object.values(updateFields).some(v => 
          v !== undefined && JSON.stringify(v) !== JSON.stringify(existingOrder.toObject())
        );
        
        if (hasChanges || orderData._preserveCustomerName) {
          await Order.updateOne(
            { orderNumber: orderData.orderNumber },
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

      const extractor = new OrderExtractor(this.bot.getPage());
      const stateUpdates = await extractor.extractOrdersForStateUpdate();

      if (stateUpdates.length === 0) {
        logger.bot('No orders found for state sync');
        return { updatedCount: 0, registeredCount: 0, totalChecked: 0 };
      }

      let updatedCount = 0;
      let registeredCount = 0;

      for (const update of stateUpdates) {
        // Find order by orderNumber + today's date (Grab reuses order numbers across dates)
        const todayDate = Order.toOrderDate(new Date());
        const existingOrder = await Order.findOne({ orderNumber: update.orderNumber, orderDate: todayDate });

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
            { orderNumber: update.orderNumber, orderDate: todayDate },
            { $set: updateFields }
          );

          updatedCount++;
        } else if (update.status !== 'unknown' && update.orderNumber) {
          const orderTimestamp = new Date();
          const order = new Order({
            orderNumber: update.orderNumber,
            longOrderId: update.longOrderId || '',
            orderDate: Order.toOrderDate(orderTimestamp),
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
              actualDeliveryTime: null,
            },
            source: 'grab-merchant-portal-history-state-sync',
          });

          await order.save();
          registeredCount++;
          logger.order(`Registered new order from state sync: ${update.orderNumber}`);
        }
      }

      logger.bot(`State sync completed: ${updatedCount} orders updated, ${registeredCount} orders registered, ${stateUpdates.length} total checked`);
      return { updatedCount, registeredCount, totalChecked: stateUpdates.length };
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
