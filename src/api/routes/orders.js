const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const logger = require('../../utils/logger');

/**
 * GET /api/orders
 * Get all orders with pagination and filtering
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter query
    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.customerName) {
      filter.customerName = { $regex: req.query.customerName, $options: 'i' };
    }
    
    if (req.query.orderNumber) {
      filter.orderNumber = { $regex: req.query.orderNumber, $options: 'i' };
    }

    if (req.query.startDate || req.query.endDate) {
      filter.orderTimestamp = {};
      if (req.query.startDate) {
        filter.orderTimestamp.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.orderTimestamp.$lte = new Date(req.query.endDate);
      }
    }

    // Execute query
    const orders = await Order.find(filter)
      .sort({ orderTimestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments(filter);

    res.json({
      orders: orders,
      pagination: {
        page: page,
        limit: limit,
        total: total,
        pages: Math.ceil(total / limit)
      },
      filter: filter
    });

  } catch (error) {
    logger.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/recent
 * Get recent orders (last 24 hours by default)
 */
router.get('/recent', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const limit = parseInt(req.query.limit) || 50;
    
    const orders = await Order.findRecentOrders(hours)
      .limit(limit)
      .lean();

    res.json({
      orders: orders,
      timeframe: `${hours} hours`,
      count: orders.length
    });

  } catch (error) {
    logger.error('Error fetching recent orders:', error);
    res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
});

/**
 * GET /api/orders/stats
 * Get order statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = await Order.getOrderStats(days);
    
    const result = stats[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      maxOrderValue: 0,
      minOrderValue: 0
    };

    // Add additional stats
    const recentOrders = await Order.findRecentOrders(24);
    const todayOrders = await Order.findRecentOrders(24);
    
    result.ordersLast24h = todayOrders.length;
    result.currency = 'SGD';
    result.period = `${days} days`;

    res.json(result);

  } catch (error) {
    logger.error('Error fetching order stats:', error);
    res.status(500).json({ error: 'Failed to fetch order statistics' });
  }
});

/**
 * GET /api/orders/:id
 * Get a specific order by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);

  } catch (error) {
    logger.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/orders/number/:orderNumber
 * Get a specific order by order number
 */
router.get('/number/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findByOrderNumber(req.params.orderNumber).lean();
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);

  } catch (error) {
    logger.error('Error fetching order by number:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/orders/search/:query
 * Search orders by customer name, order number, or other fields
 */
router.get('/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const limit = parseInt(req.query.limit) || 20;

    const searchFilter = {
      $or: [
        { orderNumber: { $regex: query, $options: 'i' } },
        { customerName: { $regex: query, $options: 'i' } },
        { driverName: { $regex: query, $options: 'i' } },
        { 'orderDetails.restaurantName': { $regex: query, $options: 'i' } }
      ]
    };

    const orders = await Order.find(searchFilter)
      .sort({ orderTimestamp: -1 })
      .limit(limit)
      .lean();

    res.json({
      orders: orders,
      query: query,
      count: orders.length
    });

  } catch (error) {
    logger.error('Error searching orders:', error);
    res.status(500).json({ error: 'Failed to search orders' });
  }
});

/**
 * PUT /api/orders/:id
 * Update an order (limited fields)
 */
router.put('/:id', async (req, res) => {
  try {
    const allowedUpdates = ['status', 'driverName', 'deliveryInfo.actualDeliveryTime'];
    const updates = {};

    // Only allow specific fields to be updated
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    logger.api(`Order ${order.orderNumber} updated`, { updates });
    res.json(order);

  } catch (error) {
    logger.error('Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

/**
 * DELETE /api/orders/:id
 * Delete an order (soft delete by marking as cancelled)
 */
router.delete('/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'cancelled',
        lastUpdated: new Date()
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    logger.api(`Order ${order.orderNumber} marked as cancelled`);
    res.json({ message: 'Order cancelled successfully', order });

  } catch (error) {
    logger.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

/**
 * GET /api/orders/export/csv
 * Export orders as CSV
 */
router.get('/export/csv', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    const orders = await Order.findOrdersByDateRange(startDate, endDate).lean();

    // Convert to CSV format
    const csvHeaders = [
      'Order Number',
      'Customer Name',
      'Driver Name',
      'Restaurant',
      'Status',
      'Subtotal',
      'Delivery Fee',
      'Total',
      'Currency',
      'Order Time',
      'Delivery Address',
      'Fetched At'
    ];

    const csvRows = orders.map(order => [
      order.orderNumber,
      order.customerName,
      order.driverName,
      order.orderDetails.restaurantName || '',
      order.status,
      order.pricing.subtotal,
      order.pricing.deliveryFee,
      order.pricing.total,
      order.pricing.currency,
      order.orderTimestamp.toISOString(),
      order.deliveryInfo.address || '',
      order.fetchedAt.toISOString()
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="grab-orders-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

    logger.export(`CSV export generated: ${orders.length} orders`);

  } catch (error) {
    logger.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

/**
 * GET /api/orders/export/json
 * Export orders as JSON
 */
router.get('/export/json', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    const orders = await Order.findOrdersByDateRange(startDate, endDate).lean();

    const exportData = {
      exportDate: new Date().toISOString(),
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      totalOrders: orders.length,
      orders: orders.map(order => order.toExportFormat ? order.toExportFormat() : order)
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="grab-orders-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.json"`);
    res.json(exportData);

    logger.export(`JSON export generated: ${orders.length} orders`);

  } catch (error) {
    logger.error('Error exporting JSON:', error);
    res.status(500).json({ error: 'Failed to export JSON' });
  }
});

module.exports = router;
