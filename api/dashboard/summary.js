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

    const [
      totalStats,
      todayStats,
      weekStats,
      monthStats,
      statusBreakdown,
      recentOrders,
      recentActivity,
      orderTypeBreakdown,
      topRestaurants,
      topDrivers,
      hourlyDistribution,
      errorStats
    ] = await Promise.all([
      Order.aggregate([
        { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$pricing.total' }, avgOrderValue: { $avg: '$pricing.total' }, maxOrderValue: { $max: '$pricing.total' }, currency: { $first: '$pricing.currency' } } }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: weekStart } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: monthStart } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
      ]),
      Order.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { count: -1 } }
      ]),
      Order.find().sort({ orderTimestamp: -1 }).limit(50).lean(),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderTimestamp' } }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
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
        { $limit: 5 }
      ]),
      Order.aggregate([
        { $match: { driverName: { $ne: 'Pending', $ne: '', $exists: true } } },
        { $group: { _id: '$driverName', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { orders: -1 } },
        { $limit: 5 }
      ]),
      Order.aggregate([
        { $match: { orderTimestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $hour: '$orderTimestamp' }, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
        { $sort: { _id: 1 } }
      ]),
      Order.aggregate([
        { $group: { _id: null, totalOrders: { $sum: 1 }, ordersWithErrors: { $sum: { $cond: ['$hasErrors', 1, 0] } }, processedOrders: { $sum: { $cond: ['$isProcessed', 1, 0] } } } }
      ])
    ]);

    const lastOrder = recentOrders.length > 0 ? recentOrders[0] : null;

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
        recentOrders: recentOrders.map(order => ({
          _id: order._id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          driverName: order.driverName,
          status: order.status,
          total: order.pricing?.total || 0,
          currency: order.pricing?.currency || 'MYR',
          orderTimestamp: order.orderTimestamp,
          orderType: order.orderDetails?.orderType || 'delivery',
          restaurantName: order.orderDetails?.restaurantName || '',
          deliveryTime: order.deliveryTime || '',
          hasErrors: order.hasErrors || false
        })),
        lastFetchedAt: lastOrder?.fetchedAt || null
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
