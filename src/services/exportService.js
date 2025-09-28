const fs = require('fs-extra');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const logger = require('../utils/logger');
const Order = require('../models/Order');
const { ensureDirectory, formatTimestampForFilename } = require('../utils/helpers');

class ExportService {
  constructor() {
    this.exportDir = path.join(process.cwd(), 'exports');
  }

  /**
   * Initialize export service
   */
  async init() {
    try {
      // Ensure export directory exists
      const dirCreated = await ensureDirectory(this.exportDir);
      if (!dirCreated) {
        throw new Error('Failed to create export directory');
      }

      logger.export('Export service initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize export service:', error);
      throw error;
    }
  }

  /**
   * Export orders to CSV format
   */
  async exportToCSV(options = {}) {
    try {
      logger.export('Starting CSV export...');

      const {
        startDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)), // 7 days ago
        endDate = new Date(),
        filename = null,
        includeRawData = false
      } = options;

      // Fetch orders
      const orders = await Order.findOrdersByDateRange(startDate, endDate).lean();
      
      if (orders.length === 0) {
        logger.export('No orders found for CSV export');
        return null;
      }

      // Generate filename if not provided
      const csvFilename = filename || `grab-orders-${formatTimestampForFilename()}.csv`;
      const csvPath = path.join(this.exportDir, csvFilename);

      // Define CSV headers and mapping
      const csvHeaders = [
        { id: 'orderNumber', title: 'Order Number' },
        { id: 'customerName', title: 'Customer Name' },
        { id: 'driverName', title: 'Driver Name' },
        { id: 'restaurantName', title: 'Restaurant' },
        { id: 'orderType', title: 'Order Type' },
        { id: 'status', title: 'Status' },
        { id: 'subtotal', title: 'Subtotal' },
        { id: 'deliveryFee', title: 'Delivery Fee' },
        { id: 'serviceFee', title: 'Service Fee' },
        { id: 'tax', title: 'Tax' },
        { id: 'discount', title: 'Discount' },
        { id: 'total', title: 'Total' },
        { id: 'currency', title: 'Currency' },
        { id: 'orderTimestamp', title: 'Order Time' },
        { id: 'deliveryAddress', title: 'Delivery Address' },
        { id: 'estimatedDeliveryTime', title: 'Estimated Delivery' },
        { id: 'actualDeliveryTime', title: 'Actual Delivery' },
        { id: 'fetchedAt', title: 'Fetched At' },
        { id: 'screenshotPath', title: 'Screenshot Path' }
      ];

      if (includeRawData) {
        csvHeaders.push({ id: 'rawData', title: 'Raw Data' });
      }

      // Create CSV writer
      const csvWriter = createCsvWriter({
        path: csvPath,
        header: csvHeaders
      });

      // Transform orders for CSV
      const csvData = orders.map(order => ({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        driverName: order.driverName,
        restaurantName: order.orderDetails?.restaurantName || '',
        orderType: order.orderDetails?.orderType || '',
        status: order.status,
        subtotal: order.pricing?.subtotal || 0,
        deliveryFee: order.pricing?.deliveryFee || 0,
        serviceFee: order.pricing?.serviceFee || 0,
        tax: order.pricing?.tax || 0,
        discount: order.pricing?.discount || 0,
        total: order.pricing?.total || 0,
        currency: order.pricing?.currency || 'SGD',
        orderTimestamp: order.orderTimestamp?.toISOString() || '',
        deliveryAddress: order.deliveryInfo?.address || '',
        estimatedDeliveryTime: order.deliveryInfo?.estimatedDeliveryTime?.toISOString() || '',
        actualDeliveryTime: order.deliveryInfo?.actualDeliveryTime?.toISOString() || '',
        fetchedAt: order.fetchedAt?.toISOString() || '',
        screenshotPath: order.screenshotPath || '',
        rawData: includeRawData ? JSON.stringify(order.rawData || {}) : undefined
      }));

      // Write CSV file
      await csvWriter.writeRecords(csvData);

      const stats = await fs.stat(csvPath);
      
      logger.export(`CSV export completed: ${csvFilename} (${orders.length} orders, ${stats.size} bytes)`);

      return {
        filename: csvFilename,
        path: csvPath,
        relativePath: path.relative(process.cwd(), csvPath),
        recordCount: orders.length,
        fileSize: stats.size,
        dateRange: { startDate, endDate }
      };

    } catch (error) {
      logger.error('Failed to export CSV:', error);
      throw error;
    }
  }

  /**
   * Export orders to JSON format
   */
  async exportToJSON(options = {}) {
    try {
      logger.export('Starting JSON export...');

      const {
        startDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)), // 7 days ago
        endDate = new Date(),
        filename = null,
        includeRawData = false,
        pretty = true
      } = options;

      // Fetch orders
      const orders = await Order.findOrdersByDateRange(startDate, endDate).lean();
      
      if (orders.length === 0) {
        logger.export('No orders found for JSON export');
        return null;
      }

      // Generate filename if not provided
      const jsonFilename = filename || `grab-orders-${formatTimestampForFilename()}.json`;
      const jsonPath = path.join(this.exportDir, jsonFilename);

      // Prepare export data
      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          totalOrders: orders.length,
          exportedBy: 'Grab Order Fetcher Bot',
          version: '1.0.0'
        },
        orders: orders.map(order => {
          const exportOrder = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            driverName: order.driverName,
            orderDetails: order.orderDetails,
            pricing: order.pricing,
            deliveryInfo: order.deliveryInfo,
            status: order.status,
            orderTimestamp: order.orderTimestamp,
            screenshotPath: order.screenshotPath,
            screenshotUrl: order.screenshotUrl,
            fetchedAt: order.fetchedAt,
            lastUpdated: order.lastUpdated,
            source: order.source,
            isProcessed: order.isProcessed,
            hasErrors: order.hasErrors
          };

          if (includeRawData) {
            exportOrder.rawData = order.rawData;
          }

          if (order.errorMessages && order.errorMessages.length > 0) {
            exportOrder.errorMessages = order.errorMessages;
          }

          return exportOrder;
        })
      };

      // Write JSON file
      const jsonContent = pretty ? 
        JSON.stringify(exportData, null, 2) : 
        JSON.stringify(exportData);

      await fs.writeFile(jsonPath, jsonContent, 'utf8');

      const stats = await fs.stat(jsonPath);
      
      logger.export(`JSON export completed: ${jsonFilename} (${orders.length} orders, ${stats.size} bytes)`);

      return {
        filename: jsonFilename,
        path: jsonPath,
        relativePath: path.relative(process.cwd(), jsonPath),
        recordCount: orders.length,
        fileSize: stats.size,
        dateRange: { startDate, endDate }
      };

    } catch (error) {
      logger.error('Failed to export JSON:', error);
      throw error;
    }
  }

  /**
   * Export order statistics
   */
  async exportStats(options = {}) {
    try {
      logger.export('Starting stats export...');

      const {
        days = 7,
        filename = null
      } = options;

      // Get order statistics
      const stats = await Order.getOrderStats(days);
      const recentOrders = await Order.findRecentOrders(24);

      const statsData = {
        metadata: {
          exportDate: new Date().toISOString(),
          period: `${days} days`,
          exportedBy: 'Grab Order Fetcher Bot'
        },
        summary: stats[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          maxOrderValue: 0,
          minOrderValue: 0
        },
        recentActivity: {
          ordersLast24h: recentOrders.length,
          lastOrderTime: recentOrders.length > 0 ? recentOrders[0].orderTimestamp : null
        }
      };

      // Generate filename if not provided
      const statsFilename = filename || `grab-order-stats-${formatTimestampForFilename()}.json`;
      const statsPath = path.join(this.exportDir, statsFilename);

      // Write stats file
      await fs.writeFile(statsPath, JSON.stringify(statsData, null, 2), 'utf8');

      const fileStats = await fs.stat(statsPath);
      
      logger.export(`Stats export completed: ${statsFilename} (${fileStats.size} bytes)`);

      return {
        filename: statsFilename,
        path: statsPath,
        relativePath: path.relative(process.cwd(), statsPath),
        fileSize: fileStats.size,
        data: statsData
      };

    } catch (error) {
      logger.error('Failed to export stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old export files
   */
  async cleanupOldExports(maxAgeHours = 168) { // 7 days default
    try {
      logger.export('Cleaning up old export files...');

      const files = await fs.readdir(this.exportDir);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.exportDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
          logger.export(`Deleted old export file: ${file}`);
        }
      }

      logger.export(`Cleaned up ${deletedCount} old export files`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old exports:', error);
      return 0;
    }
  }

  /**
   * Get export directory statistics
   */
  async getExportStats() {
    try {
      const files = await fs.readdir(this.exportDir);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(this.exportDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }

      return {
        fileCount: files.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        directory: this.exportDir
      };
    } catch (error) {
      logger.error('Failed to get export stats:', error);
      return { fileCount: 0, totalSize: 0, error: error.message };
    }
  }
}

module.exports = ExportService;
