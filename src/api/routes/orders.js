const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const Order = require('../../models/Order');
const { sanitizeSortField, sanitizeSortOrder, buildSafeRegexQuery, sanitizeCsvField } = require('../../utils/inputSanitizer');
const logger = require('../../utils/logger');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId || req.ip
});

router.use(apiLimiter);

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.date) {
      const date = new Date(req.query.date);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
      }
      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);
      filter.orderTimestamp = { $gte: date, $lt: nextDay };
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter = {};
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        if (isNaN(startDate.getTime())) throw new Error('Invalid start date');
        dateFilter.$gte = startDate;
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        if (isNaN(endDate.getTime())) throw new Error('Invalid end date');
        endDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = endDate;
      }
      filter.orderTimestamp = { ...filter.orderTimestamp, ...dateFilter };
    }

    if (req.query.orderType) {
      filter['orderDetails.orderType'] = req.query.orderType;
    }

    if (req.query.restaurant) {
      filter['orderDetails.restaurantName'] = buildSafeRegexQuery(req.query.restaurant);
    }

    if (req.query.driver) {
      filter.driverName = buildSafeRegexQuery(req.query.driver);
    }

    if (req.query.customer) {
      filter.customerName = buildSafeRegexQuery(req.query.customer);
    }

    if (req.query.hasErrors !== undefined) {
      filter.hasErrors = req.query.hasErrors === 'true';
    }

    if (req.query.isProcessed !== undefined) {
      filter.isProcessed = req.query.isProcessed === 'true';
    }

    if (req.query.search) {
      const safeRegex = buildSafeRegexQuery(req.query.search);
      if (Object.keys(safeRegex).length > 0) {
        filter.$or = [
          { orderNumber: safeRegex },
          { customerName: safeRegex },
          { driverName: safeRegex },
          { 'orderDetails.restaurantName': safeRegex },
          { bookingId: safeRegex }
        ];
      }
    }

    const sortField = sanitizeSortField(req.query.sortBy);
    const sortOrder = sanitizeSortOrder(req.query.sortOrder);
    const sortOptions = {};
    
    if (sortField === 'total') sortOptions['pricing.total'] = sortOrder === 'asc' ? 1 : -1;
    else if (sortField === 'customer') sortOptions.customerName = sortOrder === 'asc' ? 1 : -1;
    else if (sortField === 'driver') sortOptions.driverName = sortOrder === 'asc' ? 1 : -1;
    else if (sortField === 'status') { sortOptions.status = sortOrder === 'asc' ? 1 : -1; sortOptions.orderTimestamp = -1; }
    else sortOptions.orderTimestamp = sortOrder === 'asc' ? 1 : -1;

    const [orders, total, filterOptions] = await Promise.all([
      Order.find(filter).sort(sortOptions).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
      Promise.all([
        Order.distinct('status'),
        Order.distinct('orderDetails.orderType'),
        Order.aggregate([
          { $match: { 'orderDetails.restaurantName': { $ne: '', $exists: true } } },
          { $group: { _id: '$orderDetails.restaurantName' } },
          { $sort: { _id: 1 } },
          { $limit: 50 }
        ]),
        Order.aggregate([
          { $match: { driverName: { $ne: 'Pending', $ne: '', $exists: true } } },
          { $group: { _id: '$driverName' } },
          { $sort: { _id: 1 } },
          { $limit: 50 }
        ])
      ])
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: orders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: total,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      filters: {
        statuses: filterOptions[0] || [],
        orderTypes: filterOptions[1] || [],
        restaurants: (filterOptions[2] || []).map(r => r._id),
        drivers: (filterOptions[3] || []).map(d => d._id)
      },
      meta: { timestamp: new Date().toISOString() }
    });

  } catch (error) {
    logger.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders', message: 'Internal server error' });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours);

    const orders = await Order.find({
      orderTimestamp: { $gte: cutoffTime }
    }).sort({ orderTimestamp: -1 }).limit(limit).lean();

    res.json({
      success: true,
      data: orders,
      meta: {
        timeframe: `Last ${hours} hours`,
        count: orders.length,
        cutoffTime: cutoffTime.toISOString(),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error fetching recent orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recent orders', message: 'Internal server error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalStats, todayStats, weekStats, monthStats,
      statusBreakdown, recentActivity, orderTypeBreakdown,
      topRestaurants, topDrivers, revenueByStatus,
      hourlyDistribution, errorStats, deliveryStats, currencyBreakdown
    ] = await Promise.all([
      Order.aggregate([
        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$pricing.total' }, avgOrderValue: { $avg: '$pricing.total' }, maxOrderValue: { $max: '$pricing.total' }, minOrderValue: { $min: '$pricing.total' }, currency: { $first: '$pricing.currency' } } }
      ]),
      // Today stats based on fetchedAt (orders fetched today, regardless of order date)
      Order.aggregate([
        { $match: { fetchedAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, todayOrders: { $sum: 1 }, todayRevenue: { $sum: '$pricing.total' }, todayAvgOrderValue: { $avg: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: weekStart } } },
        { $group: { _id: null, weekOrders: { $sum: 1 }, weekRevenue: { $sum: '$pricing.total' }, weekAvgOrderValue: { $avg: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: monthStart } } },
        { $group: { _id: null, monthOrders: { $sum: 1 }, monthRevenue: { $sum: '$pricing.total' }, monthAvgOrderValue: { $avg: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { count: -1 } }
      ]),
      // Recent activity based on fetchedAt (shows orders collected per day)
      Order.aggregate([
        { $match: { fetchedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$fetchedAt' } }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { _id: 1 } }
      ]),
      Order.aggregate([
        { $group: { _id: '$orderDetails.orderType', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { count: -1 } }
      ]),
      Order.aggregate([
        { $match: { 'orderDetails.restaurantName': { $ne: '', $exists: true } } },
        { $group: { _id: '$orderDetails.restaurantName', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { orders: -1 } },
        { $limit: 10 }
      ]),
      Order.aggregate([
        { $match: { driverName: { $ne: 'Pending', $ne: '', $exists: true } } },
        { $group: { _id: '$driverName', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { orders: -1 } },
        { $limit: 10 }
      ]),
      Order.aggregate([
        { $group: { _id: '$status', revenue: { $sum: '$pricing.total' }, count: { $sum: 1 } } },
        { $sort: { revenue: -1 } }
      ]),
      // Hourly distribution based on fetchedAt
      Order.aggregate([
        { $match: { fetchedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $hour: '$fetchedAt' }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { _id: 1 } }
      ]),
      Order.aggregate([
        { $group: { _id: null, totalOrders: { $sum: 1 }, ordersWithErrors: { $sum: { $cond: ['$hasErrors', 1, 0] } }, processedOrders: { $sum: { $cond: ['$isProcessed', 1, 0] } } } }
      ]),
      Order.aggregate([
        { $match: { 'deliveryInfo.estimatedDeliveryTime': { $exists: true }, 'deliveryInfo.actualDeliveryTime': { $exists: true } } },
        { $group: { _id: null, avgDeliveryTimeMinutes: { $avg: { $divide: [{ $subtract: ['$deliveryInfo.actualDeliveryTime', '$deliveryInfo.estimatedDeliveryTime'] }, 60000] } }, totalDeliveries: { $sum: 1 } } }
      ]),
      Order.aggregate([
        { $group: { _id: '$pricing.currency', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
      ])
    ]);

    const stats = {
      total: { orders: totalStats[0]?.totalOrders || 0, revenue: totalStats[0]?.totalRevenue || 0, avgOrderValue: totalStats[0]?.avgOrderValue || 0, maxOrderValue: totalStats[0]?.maxOrderValue || 0, minOrderValue: totalStats[0]?.minOrderValue || 0, currency: totalStats[0]?.currency || 'MYR' },
      today: { orders: todayStats[0]?.todayOrders || 0, revenue: todayStats[0]?.todayRevenue || 0, avgOrderValue: todayStats[0]?.todayAvgOrderValue || 0 },
      week: { orders: weekStats[0]?.weekOrders || 0, revenue: weekStats[0]?.weekRevenue || 0, avgOrderValue: weekStats[0]?.weekAvgOrderValue || 0 },
      month: { orders: monthStats[0]?.monthOrders || 0, revenue: monthStats[0]?.monthRevenue || 0, avgOrderValue: monthStats[0]?.monthAvgOrderValue || 0 },
      statusBreakdown: statusBreakdown.map(item => ({ status: item._id || 'unknown', count: item.count, revenue: item.revenue })),
      recentActivity: recentActivity.map(day => ({ date: day._id, orders: day.orders, revenue: day.revenue })),
      orderTypeBreakdown: orderTypeBreakdown.map(item => ({ type: item._id || 'unknown', count: item.count, revenue: item.revenue })),
      topRestaurants: topRestaurants.map(item => ({ name: item._id, orders: item.orders, revenue: item.revenue })),
      topDrivers: topDrivers.map(item => ({ name: item._id, orders: item.orders, revenue: item.revenue })),
      revenueByStatus: revenueByStatus.map(item => ({ status: item._id || 'unknown', revenue: item.revenue, count: item.count })),
      hourlyDistribution: hourlyDistribution.map(item => ({ hour: item._id, orders: item.orders, revenue: item.revenue })),
      errors: {
        totalOrders: errorStats[0]?.totalOrders || 0,
        ordersWithErrors: errorStats[0]?.ordersWithErrors || 0,
        errorRate: errorStats[0]?.totalOrders ? ((errorStats[0]?.ordersWithErrors || 0) / errorStats[0]?.totalOrders * 100).toFixed(2) : 0,
        processedOrders: errorStats[0]?.processedOrders || 0,
        processedRate: errorStats[0]?.totalOrders ? ((errorStats[0]?.processedOrders || 0) / errorStats[0]?.totalOrders * 100).toFixed(2) : 0
      },
      delivery: { avgDeliveryTimeMinutes: deliveryStats[0]?.avgDeliveryTimeMinutes ? deliveryStats[0].avgDeliveryTimeMinutes.toFixed(1) : 0, totalDeliveries: deliveryStats[0]?.totalDeliveries || 0 },
      currencyBreakdown: currencyBreakdown.map(item => ({ currency: item._id || 'MYR', count: item.count, revenue: item.revenue }))
    };

    res.json({
      success: true,
      data: stats,
      totalOrders: stats.total.orders,
      todayOrders: stats.today.orders,
      totalRevenue: stats.total.revenue,
      currency: stats.total.currency,
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    logger.error('Error fetching order stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order statistics', message: 'Internal server error' });
  }
});

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

router.get('/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const limit = parseInt(req.query.limit) || 20;
    const safeRegex = buildSafeRegexQuery(query);

    if (Object.keys(safeRegex).length === 0) {
      return res.json({ orders: [], query, count: 0 });
    }

    const searchFilter = {
      $or: [
        { orderNumber: safeRegex },
        { customerName: safeRegex },
        { driverName: safeRegex },
        { 'orderDetails.restaurantName': safeRegex }
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

router.put('/:id', async (req, res) => {
  try {
    const allowedUpdates = ['status', 'driverName', 'deliveryInfo.actualDeliveryTime'];
    const updates = {};

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

router.get('/export/csv', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format');
      }
      filter.orderTimestamp = { $gte: startDate, $lte: endDate };
    } else if (req.query.days) {
      const days = parseInt(req.query.days);
      filter.orderTimestamp = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }

    const limit = Math.min(parseInt(req.query.limit) || 5000, 5000);
    const orders = await Order.find(filter).sort({ orderTimestamp: -1 }).limit(limit).lean();

    const csvHeaders = [
      'Order Number', 'Booking ID', 'Customer Name', 'Customer Phone', 'Customer Note',
      'Driver Name', 'Driver Phone', 'Driver Status', 'Restaurant', 'Order Type',
      'Status', 'Subtotal', 'Delivery Fee', 'Service Fee', 'Tax', 'Discount', 'Discount Code',
      'Total', 'Currency', 'Order Date', 'Delivery Time', 'Address',
      'Estimated Delivery', 'Actual Delivery', 'Fetched At', 'Has Errors'
    ];

    const csvRows = orders.map(order => [
      order.orderNumber || '', order.bookingId || '',
      sanitizeCsvField(order.customerName || ''),
      order.customerPhone || '', sanitizeCsvField(order.customerNote || ''),
      sanitizeCsvField(order.driverName || ''),
      order.driverPhone || '', order.driverStatus || '',
      sanitizeCsvField(order.orderDetails?.restaurantName || ''),
      order.orderDetails?.orderType || '',
      order.status || '', order.pricing?.subtotal || 0, order.pricing?.deliveryFee || 0,
      order.pricing?.serviceFee || 0, order.pricing?.tax || 0, order.pricing?.discount || 0,
      order.pricing?.discountCode || '', order.pricing?.total || 0,
      order.pricing?.currency || 'MYR', order.orderTimestamp ? new Date(order.orderTimestamp).toISOString() : '',
      order.deliveryTime || '', sanitizeCsvField(order.deliveryInfo?.address || ''),
      order.deliveryInfo?.estimatedDeliveryTime ? new Date(order.deliveryInfo.estimatedDeliveryTime).toISOString() : '',
      order.deliveryInfo?.actualDeliveryTime ? new Date(order.deliveryInfo.actualDeliveryTime).toISOString() : '',
      order.fetchedAt ? new Date(order.fetchedAt).toISOString() : '',
      order.hasErrors ? 'Yes' : 'No'
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field).join(','))
    ].join('\n');

    const filename = `grab-orders-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

    logger.export(`CSV export generated: ${orders.length} orders`);

  } catch (error) {
    logger.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV', message: 'Internal server error' });
  }
});

router.get('/export/json', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format');
      }
      filter.orderTimestamp = { $gte: startDate, $lte: endDate };
    } else if (req.query.days) {
      const days = parseInt(req.query.days);
      filter.orderTimestamp = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }

    const limit = Math.min(parseInt(req.query.limit) || 5000, 5000);
    const orders = await Order.find(filter).sort({ orderTimestamp: -1 }).limit(limit).lean();

    res.json({
      success: true,
      data: orders,
      meta: { format: 'json', count: orders.length, exportedAt: new Date().toISOString() }
    });

    logger.export(`JSON export generated: ${orders.length} orders`);

  } catch (error) {
    logger.error('Error exporting JSON:', error);
    res.status(500).json({ error: 'Failed to export JSON', message: 'Internal server error' });
  }
});

module.exports = router;
