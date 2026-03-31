// Vercel serverless function for exporting orders
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

    // Parse query parameters
    const format = req.query.format || 'json';
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000); // Max 5000 for export
    
    // Build filter
    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.startDate && req.query.endDate) {
      filter.orderTimestamp = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    } else if (req.query.days) {
      const days = parseInt(req.query.days);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      filter.orderTimestamp = { $gte: cutoffDate };
    }

    // Get orders
    const orders = await Order.find(filter)
      .sort({ orderTimestamp: -1 })
      .limit(limit)
      .lean();

    if (format === 'csv') {
      // Generate CSV
      const csvHeaders = [
        'Order Number',
        'Customer Name',
        'Driver Name',
        'Restaurant',
        'Order Type',
        'Status',
        'Subtotal',
        'Delivery Fee',
        'Total',
        'Currency',
        'Order Date',
        'Address',
        'Has Errors'
      ];

      const csvRows = orders.map(order => [
        order.orderNumber || '',
        order.customerName || '',
        order.driverName || '',
        order.orderDetails?.restaurantName || '',
        order.orderDetails?.orderType || '',
        order.status || '',
        order.pricing?.subtotal || 0,
        order.pricing?.deliveryFee || 0,
        order.pricing?.total || 0,
        order.pricing?.currency || 'SGD',
        order.orderTimestamp ? new Date(order.orderTimestamp).toISOString() : '',
        order.deliveryInfo?.address || '',
        order.hasErrors ? 'Yes' : 'No'
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => 
          row.map(field => 
            typeof field === 'string' && field.includes(',') 
              ? `"${field.replace(/"/g, '""')}"` 
              : field
          ).join(',')
        )
      ].join('\n');

      const filename = `grab-orders-${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csvContent);

    } else {
      // Return JSON
      const response = {
        success: true,
        data: orders,
        meta: {
          format: 'json',
          count: orders.length,
          exportedAt: new Date().toISOString(),
          deployment: 'vercel-serverless'
        }
      };

      res.status(200).json(response);
    }

  } catch (error) {
    console.error('Error exporting orders:', error);
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
