// Vercel serverless function for order statistics
const database = require('../../src/config/database');
const Order = require('../../src/models/Order');

module.exports = async (req, res) => {
  // Set CORS headers
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
    // Connect to database
    await database.connect();

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Get this week's date range
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    
    // Get this month's date range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Run aggregation queries
    const [
      totalStats,
      todayStats,
      weekStats,
      monthStats,
      statusBreakdown,
      recentActivity,
      orderTypeBreakdown,
      topRestaurants,
      topDrivers,
      revenueByStatus,
      hourlyDistribution,
      errorStats,
      deliveryStats,
      currencyBreakdown
    ] = await Promise.all([
      // Total statistics
      Order.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$pricing.total' },
            avgOrderValue: { $avg: '$pricing.total' },
            maxOrderValue: { $max: '$pricing.total' },
            minOrderValue: { $min: '$pricing.total' },
            currency: { $first: '$pricing.currency' }
          }
        }
      ]),

      // Today's statistics
      Order.aggregate([
        {
          $match: {
            orderTimestamp: { $gte: today, $lt: tomorrow }
          }
        },
        {
          $group: {
            _id: null,
            todayOrders: { $sum: 1 },
            todayRevenue: { $sum: '$pricing.total' },
            todayAvgOrderValue: { $avg: '$pricing.total' }
          }
        }
      ]),

      // This week's statistics
      Order.aggregate([
        {
          $match: {
            orderTimestamp: { $gte: weekStart }
          }
        },
        {
          $group: {
            _id: null,
            weekOrders: { $sum: 1 },
            weekRevenue: { $sum: '$pricing.total' },
            weekAvgOrderValue: { $avg: '$pricing.total' }
          }
        }
      ]),

      // This month's statistics
      Order.aggregate([
        {
          $match: {
            orderTimestamp: { $gte: monthStart }
          }
        },
        {
          $group: {
            _id: null,
            monthOrders: { $sum: 1 },
            monthRevenue: { $sum: '$pricing.total' },
            monthAvgOrderValue: { $avg: '$pricing.total' }
          }
        }
      ]),

      // Status breakdown
      Order.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Recent activity (last 7 days by day)
      Order.aggregate([
        {
          $match: {
            orderTimestamp: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$orderTimestamp'
              }
            },
            orders: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]),

      // Order type breakdown
      Order.aggregate([
        {
          $group: {
            _id: '$orderDetails.orderType',
            count: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Top restaurants by orders
      Order.aggregate([
        {
          $match: {
            'orderDetails.restaurantName': { $ne: '', $exists: true }
          }
        },
        {
          $group: {
            _id: '$orderDetails.restaurantName',
            orders: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        { $sort: { orders: -1 } },
        { $limit: 10 }
      ]),

      // Top drivers by orders
      Order.aggregate([
        {
          $match: {
            driverName: { $ne: 'Pending', $ne: '', $exists: true }
          }
        },
        {
          $group: {
            _id: '$driverName',
            orders: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        { $sort: { orders: -1 } },
        { $limit: 10 }
      ]),

      // Revenue by status
      Order.aggregate([
        {
          $group: {
            _id: '$status',
            revenue: { $sum: '$pricing.total' },
            count: { $sum: 1 }
          }
        },
        { $sort: { revenue: -1 } }
      ]),

      // Hourly distribution (last 7 days)
      Order.aggregate([
        {
          $match: {
            orderTimestamp: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: { $hour: '$orderTimestamp' },
            orders: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Error statistics
      Order.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            ordersWithErrors: {
              $sum: { $cond: ['$hasErrors', 1, 0] }
            },
            processedOrders: {
              $sum: { $cond: ['$isProcessed', 1, 0] }
            }
          }
        }
      ]),

      // Delivery statistics
      Order.aggregate([
        {
          $match: {
            'deliveryInfo.estimatedDeliveryTime': { $exists: true },
            'deliveryInfo.actualDeliveryTime': { $exists: true }
          }
        },
        {
          $group: {
            _id: null,
            avgDeliveryTimeMinutes: {
              $avg: {
                $divide: [
                  { $subtract: ['$deliveryInfo.actualDeliveryTime', '$deliveryInfo.estimatedDeliveryTime'] },
                  60000
                ]
              }
            },
            totalDeliveries: { $sum: 1 }
          }
        }
      ]),

      // Currency breakdown
      Order.aggregate([
        {
          $group: {
            _id: '$pricing.currency',
            count: { $sum: 1 },
            revenue: { $sum: '$pricing.total' }
          }
        }
      ])
    ]);

    // Format the response
    const stats = {
      total: {
        orders: totalStats[0]?.totalOrders || 0,
        revenue: totalStats[0]?.totalRevenue || 0,
        avgOrderValue: totalStats[0]?.avgOrderValue || 0,
        maxOrderValue: totalStats[0]?.maxOrderValue || 0,
        minOrderValue: totalStats[0]?.minOrderValue || 0,
        currency: totalStats[0]?.currency || 'MYR'
      },
      today: {
        orders: todayStats[0]?.todayOrders || 0,
        revenue: todayStats[0]?.todayRevenue || 0,
        avgOrderValue: todayStats[0]?.todayAvgOrderValue || 0
      },
      week: {
        orders: weekStats[0]?.weekOrders || 0,
        revenue: weekStats[0]?.weekRevenue || 0,
        avgOrderValue: weekStats[0]?.weekAvgOrderValue || 0
      },
      month: {
        orders: monthStats[0]?.monthOrders || 0,
        revenue: monthStats[0]?.monthRevenue || 0,
        avgOrderValue: monthStats[0]?.monthAvgOrderValue || 0
      },
      statusBreakdown: statusBreakdown.map(item => ({
        status: item._id || 'unknown',
        count: item.count,
        revenue: item.revenue
      })),
      recentActivity: recentActivity.map(day => ({
        date: day._id,
        orders: day.orders,
        revenue: day.revenue
      })),
      orderTypeBreakdown: orderTypeBreakdown.map(item => ({
        type: item._id || 'unknown',
        count: item.count,
        revenue: item.revenue
      })),
      topRestaurants: topRestaurants.map(item => ({
        name: item._id,
        orders: item.orders,
        revenue: item.revenue
      })),
      topDrivers: topDrivers.map(item => ({
        name: item._id,
        orders: item.orders,
        revenue: item.revenue
      })),
      revenueByStatus: revenueByStatus.map(item => ({
        status: item._id || 'unknown',
        revenue: item.revenue,
        count: item.count
      })),
      hourlyDistribution: hourlyDistribution.map(item => ({
        hour: item._id,
        orders: item.orders,
        revenue: item.revenue
      })),
      errors: {
        totalOrders: errorStats[0]?.totalOrders || 0,
        ordersWithErrors: errorStats[0]?.ordersWithErrors || 0,
        errorRate: errorStats[0]?.totalOrders ? 
          ((errorStats[0]?.ordersWithErrors || 0) / errorStats[0]?.totalOrders * 100).toFixed(2) : 0,
        processedOrders: errorStats[0]?.processedOrders || 0,
        processedRate: errorStats[0]?.totalOrders ? 
          ((errorStats[0]?.processedOrders || 0) / errorStats[0]?.totalOrders * 100).toFixed(2) : 0
      },
      delivery: {
        avgDeliveryTimeMinutes: deliveryStats[0]?.avgDeliveryTimeMinutes ? 
          deliveryStats[0].avgDeliveryTimeMinutes.toFixed(1) : 0,
        totalDeliveries: deliveryStats[0]?.totalDeliveries || 0
      },
      currencyBreakdown: currencyBreakdown.map(item => ({
        currency: item._id || 'MYR',
        count: item.count,
        revenue: item.revenue
      }))
    };

    const response = {
      success: true,
      data: stats,
      // Flatten some commonly used fields for backward compatibility
      totalOrders: stats.total.orders,
      todayOrders: stats.today.orders,
      totalRevenue: stats.total.revenue,
      currency: stats.total.currency,
      meta: {
        generatedAt: new Date().toISOString(),
        deployment: 'vercel-serverless'
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error generating statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  } finally {
    // Disconnect from database to avoid connection leaks
    try {
      await database.disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting from database:', disconnectError);
    }
  }
};
