// Vercel serverless function for orders API
const database = require('../../src/config/database');
const Order = require('../../src/models/Order');

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

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.date) {
      const date = new Date(req.query.date);
      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);
      filter.orderTimestamp = {
        $gte: date,
        $lt: nextDay
      };
    }

    if (req.query.startDate || req.query.endDate) {
      const dateFilter = {};
      if (req.query.startDate) {
        dateFilter.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = endDate;
      }
      filter.orderTimestamp = { ...filter.orderTimestamp, ...dateFilter };
    }

    if (req.query.orderType) {
      filter['orderDetails.orderType'] = req.query.orderType;
    }

    if (req.query.restaurant) {
      filter['orderDetails.restaurantName'] = { $regex: req.query.restaurant, $options: 'i' };
    }

    if (req.query.driver) {
      filter.driverName = { $regex: req.query.driver, $options: 'i' };
    }

    if (req.query.customer) {
      filter.customerName = { $regex: req.query.customer, $options: 'i' };
    }

    if (req.query.hasErrors !== undefined) {
      filter.hasErrors = req.query.hasErrors === 'true';
    }

    if (req.query.isProcessed !== undefined) {
      filter.isProcessed = req.query.isProcessed === 'true';
    }

    if (req.query.search) {
      filter.$or = [
        { orderNumber: { $regex: req.query.search, $options: 'i' } },
        { customerName: { $regex: req.query.search, $options: 'i' } },
        { driverName: { $regex: req.query.search, $options: 'i' } },
        { 'orderDetails.restaurantName': { $regex: req.query.search, $options: 'i' } },
        { bookingId: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const sortField = req.query.sortBy || 'orderTimestamp';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sortOptions = {};
    
    if (sortField === 'total') {
      sortOptions['pricing.total'] = sortOrder;
    } else if (sortField === 'customer') {
      sortOptions.customerName = sortOrder;
    } else if (sortField === 'driver') {
      sortOptions.driverName = sortOrder;
    } else if (sortField === 'status') {
      sortOptions.status = sortOrder;
      sortOptions.orderTimestamp = -1;
    } else {
      sortOptions.orderTimestamp = sortOrder;
    }

    const [orders, totalCount, filterOptions] = await Promise.all([
      Order.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
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

    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      success: true,
      data: orders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
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
      meta: {
        timestamp: new Date().toISOString(),
        deployment: 'vercel-serverless'
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  } finally {
    try {
      await database.disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting from database:', disconnectError);
    }
  }
};
