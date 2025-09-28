#!/usr/bin/env node

/**
 * Simple test script for Grab Order Fetcher Bot
 * This script performs basic functionality tests
 */

require('dotenv').config();

const logger = require('./src/utils/logger');
const database = require('./src/config/database');
const Order = require('./src/models/Order');
const { validateOrderData } = require('./src/utils/helpers');

class BotTester {
  constructor() {
    this.testResults = [];
  }

  /**
   * Run a test and record the result
   */
  async runTest(testName, testFunction) {
    try {
      logger.info(`🧪 Running test: ${testName}`);
      const startTime = Date.now();
      
      await testFunction();
      
      const duration = Date.now() - startTime;
      this.testResults.push({
        name: testName,
        status: 'PASS',
        duration: duration,
        error: null
      });
      
      logger.info(`✅ Test passed: ${testName} (${duration}ms)`);
    } catch (error) {
      this.testResults.push({
        name: testName,
        status: 'FAIL',
        duration: Date.now() - Date.now(),
        error: error.message
      });
      
      logger.error(`❌ Test failed: ${testName} - ${error.message}`);
    }
  }

  /**
   * Test environment variables
   */
  async testEnvironmentVariables() {
    const requiredVars = [
      'GRAB_USERNAME',
      'GRAB_PASSWORD',
      'MONGODB_URI'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
    }

    // Test MongoDB URI format
    if (!process.env.MONGODB_URI.startsWith('mongodb')) {
      throw new Error('Invalid MongoDB URI format');
    }
  }

  /**
   * Test database connection
   */
  async testDatabaseConnection() {
    await database.connect();
    
    const healthCheck = await database.healthCheck();
    if (healthCheck.status !== 'connected') {
      throw new Error(`Database health check failed: ${healthCheck.message}`);
    }
  }

  /**
   * Test Order model
   */
  async testOrderModel() {
    // Test creating a sample order
    const sampleOrder = {
      orderNumber: `TEST_${Date.now()}`,
      customerName: 'Test Customer',
      driverName: 'Test Driver',
      orderDetails: {
        restaurantName: 'Test Restaurant',
        orderType: 'delivery',
        items: [
          {
            name: 'Test Item',
            quantity: 1,
            price: 10.50
          }
        ]
      },
      pricing: {
        subtotal: 10.50,
        deliveryFee: 2.00,
        total: 12.50,
        currency: 'SGD'
      },
      deliveryInfo: {
        address: 'Test Address'
      },
      status: 'pending',
      orderTimestamp: new Date(),
      source: 'test'
    };

    // Validate order data
    const validation = validateOrderData(sampleOrder);
    if (!validation.isValid) {
      throw new Error(`Order validation failed: ${validation.errors.join(', ')}`);
    }

    // Create and save order
    const order = new Order(sampleOrder);
    await order.save();

    // Verify order was saved
    const savedOrder = await Order.findByOrderNumber(sampleOrder.orderNumber);
    if (!savedOrder) {
      throw new Error('Order was not saved to database');
    }

    // Test order methods
    await savedOrder.markAsProcessed();
    if (!savedOrder.isProcessed) {
      throw new Error('Order.markAsProcessed() failed');
    }

    // Clean up test order
    await Order.findByIdAndDelete(savedOrder._id);
  }

  /**
   * Test helper functions
   */
  async testHelperFunctions() {
    const { 
      parsePrice, 
      formatPrice, 
      sanitizeFilename,
      generateScreenshotFilename 
    } = require('./src/utils/helpers');

    // Test parsePrice
    if (parsePrice('$12.50') !== 12.50) {
      throw new Error('parsePrice failed for $12.50');
    }

    if (parsePrice('SGD 15.00') !== 15.00) {
      throw new Error('parsePrice failed for SGD 15.00');
    }

    // Test formatPrice
    if (formatPrice(12.50, 'SGD') !== 'SGD 12.50') {
      throw new Error('formatPrice failed');
    }

    // Test sanitizeFilename
    const sanitized = sanitizeFilename('test/file:name?.txt');
    if (sanitized.includes('/') || sanitized.includes(':') || sanitized.includes('?')) {
      throw new Error('sanitizeFilename failed to remove invalid characters');
    }

    // Test generateScreenshotFilename
    const screenshotName = generateScreenshotFilename('ORDER123');
    if (!screenshotName.includes('order_order123') || !screenshotName.endsWith('.png')) {
      throw new Error('generateScreenshotFilename failed');
    }
  }

  /**
   * Test logging system
   */
  async testLogging() {
    // Test different log levels
    logger.info('Test info message');
    logger.warn('Test warning message');
    logger.error('Test error message');
    logger.debug('Test debug message');

    // Test specialized loggers
    logger.bot('Test bot message');
    logger.database('Test database message');
    logger.api('Test API message');
    logger.order('Test order message');

    // Test performance logging
    const startTime = Date.now();
    setTimeout(() => {
      logger.performance('Test operation', startTime);
    }, 10);
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    const { errorHandler, GrabBotError } = require('./src/utils/errorHandler');

    // Test custom error
    const testError = new GrabBotError('Test error', 'TEST_ERROR', { test: true });
    errorHandler.handle(testError, { context: 'test' });

    // Test error statistics
    const stats = errorHandler.getErrorStats();
    if (stats.totalErrors === 0) {
      throw new Error('Error handler did not record the test error');
    }

    // Test recovery strategy
    const strategy = errorHandler.getRecoveryStrategy(new Error('Target closed'));
    if (strategy !== 'REINITIALIZE_BROWSER') {
      throw new Error('Error handler returned wrong recovery strategy');
    }
  }

  /**
   * Test export functionality
   */
  async testExportFunctionality() {
    const ExportService = require('./src/services/exportService');
    const exportService = new ExportService();
    
    await exportService.init();

    // Test export stats (should work even with no orders)
    const stats = await exportService.getExportStats();
    if (typeof stats.fileCount !== 'number') {
      throw new Error('Export service stats failed');
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚗 Grab Order Fetcher Bot - Test Suite');
    console.log('=====================================\n');

    await this.runTest('Environment Variables', () => this.testEnvironmentVariables());
    await this.runTest('Database Connection', () => this.testDatabaseConnection());
    await this.runTest('Order Model', () => this.testOrderModel());
    await this.runTest('Helper Functions', () => this.testHelperFunctions());
    await this.runTest('Logging System', () => this.testLogging());
    await this.runTest('Error Handling', () => this.testErrorHandling());
    await this.runTest('Export Functionality', () => this.testExportFunctionality());

    // Cleanup
    await database.disconnect();

    // Print results
    this.printResults();
  }

  /**
   * Print test results
   */
  printResults() {
    console.log('\n📊 Test Results');
    console.log('================');

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const total = this.testResults.length;

    this.testResults.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : '❌';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`${icon} ${result.name}${duration}`);
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log(`\n📈 Summary: ${passed}/${total} tests passed`);
    
    if (failed > 0) {
      console.log(`❌ ${failed} test(s) failed`);
      process.exit(1);
    } else {
      console.log('🎉 All tests passed!');
      console.log('\n✨ Your Grab Order Fetcher Bot is ready to use!');
      console.log('Run "npm start" to start the bot');
      process.exit(0);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new BotTester();
  
  tester.runAllTests().catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  });
}

module.exports = BotTester;
