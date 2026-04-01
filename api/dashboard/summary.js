// Vercel serverless function for dashboard summary data
const database = require('../../../src/config/database');
const Order = require('../../../src/models/Order');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await database.connect();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Batch queries sequentially to avoid overwhelming serverless connections
    let totalStats, todayStats, weekStats, monthStats;
    try {
      [totalStats, todayStats, weekStats, monthStats] = await Promise.all([
        Order.aggregate([{ $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$pricing.total' }, avgOrderValue: { $avg: '$pricing.total' }, maxOrderValue: { $max: '$pricing.total' }, currency: { $first: '$pricing.currency' } } }]),
        Order.aggregate([{ $match: { orderTimestamp: { $gte: today, $lt: tomorrow } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }]),
        Order.aggregate([{ $match: { orderTimestamp: { $gte: weekStart } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }]),
        Order.aggregate([{ $match: { orderTimestamp: { $gte: monthStart } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }])
      ]);
    } catch (err) {
      console.error('Stats batch failed:', err.message);
      totalStats = todayStats = weekStats = monthStats = [];
    }

    let statusBreakdown, recentActivity, recentOrderCount;
    try {
      [statusBreakdown, recentActivity, recentOrderCount] = await Promise.all([
        Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { count: -1 } }]),
        Order.aggregate([{ $match: { orderTimestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderTimestamp' } }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { _id: 1 } }]),
        Order.countDocuments()
      ]);
    } catch (err) {
      console.error('Breakdown batch failed:', err.message);
      statusBreakdown = []; recentActivity = []; recentOrderCount = 0;
    }

    // Get last fetched timestamp without loading full documents
    let lastFetchedAt = null;
    try {
      const lastOrder = await Order.findOne().sort({ fetchedAt: -1 }).select('fetchedAt').lean();
      lastFetchedAt = lastOrder?.fetchedAt || null;
    } catch (err) {
      console.error('Last order query failed:', err.message);
    }

    let orderTypeBreakdown, topRestaurants, topDrivers;
    try {
      [orderTypeBreakdown, topRestaurants, topDrivers] = await Promise.all([
        Order.aggregate([{ $group: { _id: '$orderDetails.orderType', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { count: -1 } }]),
        Order.aggregate([{ $match: { 'orderDetails.restaurantName': { $ne: '', $exists: true } } }, { $group: { _id: '$orderDetails.restaurantName', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { orders: -1 } }, { $limit: 5 }]),
        Order.aggregate([{ $match: { driverName: { $ne: 'Pending', $ne: '', $exists: true } } }, { $group: { _id: '$driverName', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { orders: -1 } }, { $limit: 5 }])
      ]);
    } catch (err) {
      console.error('Type/Top batch failed:', err.message);
      orderTypeBreakdown = []; topRestaurants = []; topDrivers = [];
    }

    let hourlyDistribution, errorStats;
    try {
      [hourlyDistribution, errorStats] = await Promise.all([
        Order.aggregate([{ $match: { orderTimestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }, { $group: { _id: { $hour: '$orderTimestamp' }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }, { $sort: { _id: 1 } }]),
        Order.aggregate([{ $group: { _id: null, totalOrders: { $sum: 1 }, ordersWithErrors: { $sum: { $cond: ['$hasErrors', 1, 0] } }, processedOrders: { $sum: { $cond: ['$isProcessed', 1, 0] } } } }])
      ]);
    } catch (err) {
      console.error('Hourly/Error batch failed:', err.message);
      hourlyDistribution = []; errorStats = [];
    }

    const response = {
      success: true,
      data: {
        summary: {
          total: { orders: totalStats[0]?.totalOrders || 0, revenue: totalStats[0]?.totalRevenue || 0, avgOrderValue: totalStats[0]?.avgOrderValue || 0, currency: totalStats[0]?.currency || 'MYR' },
          today: { orders: todayStats[0]?.orders || 0, revenue: todayStats[0]?.revenue || 0 },
          week: { orders: weekStats[0]?.orders || 0, revenue: weekStats[0]?.revenue || 0 },
          month: { orders: monthStats[0]?.orders || 0, revenue: monthStats[0]?.revenue || 0 }
        },
        statusBreakdown: statusBreakdown.map(item => ({ status: item._id || 'unknown', count: item.count, revenue: item.revenue })),
        orderTypeBreakdown: orderTypeBreakdown.map(item => ({ type: item._id || 'unknown', count: item.count, revenue: item.revenue })),
        topRestaurants: topRestaurants.map(item => ({ name: item._id, orders: item.orders, revenue: item.revenue })),
        topDrivers: topDrivers.map(item => ({ name: item._id, orders: item.orders, revenue: item.revenue })),
        recentActivity: recentActivity.map(day => ({ date: day._id, orders: day.orders, revenue: day.revenue })),
        hourlyDistribution: hourlyDistribution.map(item => ({ hour: item._id, orders: item.orders, revenue: item.revenue })),
        errors: {
          totalOrders: errorStats[0]?.totalOrders || 0,
          ordersWithErrors: errorStats[0]?.ordersWithErrors || 0,
          processedOrders: errorStats[0]?.processedOrders || 0
        },
        totalOrders: recentOrderCount || 0,
        lastFetchedAt: lastFetchedAt
      },
      meta: { generatedAt: new Date().toISOString() }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  } finally {
    try { await database.disconnect(); } catch (e) { console.error('Disconnect error:', e); }
  }
};
