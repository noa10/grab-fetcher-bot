require('dotenv').config();

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const logger = require('../utils/logger');
const database = require('../config/database');
const Order = require('../models/Order');
const ordersRouter = require('./routes/orders');
const { router: authRouter, requireAuth, ensureDefaultAdmin } = require('./routes/auth');
const getDashboardHTML = require('./dashboard-template');

const validateSessionSecret = () => {
  const secret = process.env.SESSION_SECRET;
  const defaultSecret = 'grab-fetcher-secret-change-in-production';
  if (!secret || secret === defaultSecret) {
    throw new Error(
      'SESSION_SECRET must be set to a strong, unique value in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }
  return secret;
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

class ApiServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.server = null;
  }

  async init() {
    try {
      logger.api('Initializing API server...');

      await database.connect();
      await ensureDefaultAdmin();

      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
          }
        },
        hsts: { maxAge: 31536000, includeSubDomains: true },
      }));

      this.app.use(express.json());
      this.app.use(express.urlencoded({ extended: true }));

      this.app.use(session({
        secret: validateSessionSecret(),
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000
        }
      }));

      this.app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Credentials', 'true');
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
        } else {
          next();
        }
      });

      this.app.use((req, res, next) => {
        logger.api(`${req.method} ${req.path}`, {
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        next();
      });

      this.app.use('/screenshots', requireAuth, express.static(path.join(process.cwd(), 'screenshots')));
      this.app.use('/exports', requireAuth, express.static(path.join(process.cwd(), 'exports')));

      this.app.get('/health', async (req, res) => {
        try {
          const dbHealth = await database.healthCheck();
          const acceptsHtml = req.accepts('html');
          
          if (acceptsHtml) {
            const getHealthHTML = require('./health-template');
            return res.send(getHealthHTML());
          }

          const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0'
          };
          res.json(health);
        } catch (error) {
          logger.error('Health check failed:', error);
          const acceptsHtml = req.accepts('html');
          if (acceptsHtml) {
            const getHealthHTML = require('./health-template');
            return res.send(getHealthHTML({ error: 'Health check failed' }));
          }
          res.status(500).json({
            status: 'error',
            message: 'Health check failed'
          });
        }
      });

      this.app.use('/api/auth', authRouter);

      this.app.use('/api/orders', requireAuth, ordersRouter);

      this.app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
        try {
          const malaysiaTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
          const todayMYT = new Date(malaysiaTime);
          todayMYT.setHours(0, 0, 0, 0);
          const tomorrowMYT = new Date(todayMYT);
          tomorrowMYT.setDate(todayMYT.getDate() + 1);
          const weekStartMYT = new Date(todayMYT);
          weekStartMYT.setDate(todayMYT.getDate() - todayMYT.getDay());
          const monthStartMYT = new Date(todayMYT.getFullYear(), todayMYT.getMonth(), 1);

          const [
            totalStats, todayStats, weekStats, monthStats,
            statusBreakdown, recentOrders, recentActivity,
            orderTypeBreakdown, topRestaurants, topDrivers,
            hourlyDistribution, errorStats
          ] = await Promise.all([
            Order.aggregate([
              { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$pricing.total' }, avgOrderValue: { $avg: '$pricing.total' }, maxOrderValue: { $max: '$pricing.total' }, currency: { $first: '$pricing.currency' } } }
            ]),
            Order.aggregate([
              { $match: { orderTimestamp: { $gte: todayMYT, $lt: tomorrowMYT } } },
              { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
            ]),
            Order.aggregate([
              { $match: { orderTimestamp: { $gte: weekStartMYT } } },
              { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } }
            ]),
            Order.aggregate([
              { $match: { orderTimestamp: { $gte: monthStartMYT } } },
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

          res.json({
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
          });
        } catch (error) {
          logger.error('Error fetching dashboard summary:', error);
          res.status(500).json({ success: false, error: 'Internal server error', message: 'Internal server error' });
        }
      });

      this.app.get('/', (req, res) => {
        res.json({
          name: 'Grab Order Fetcher Bot API',
          version: '1.0.0',
          description: 'API for accessing fetched Grab orders',
          endpoints: {
            health: '/health',
            login: '/login',
            dashboard: '/dashboard'
          }
        });
      });

      this.app.get('/login', (req, res) => {
        if (req.session && req.session.userId) {
          return res.redirect('/dashboard');
        }
        const getLoginHTML = require('./login-template');
        res.send(getLoginHTML());
      });

      this.app.get('/dashboard', requireAuth, (req, res) => {
        res.send(this.getDashboardHTML());
      });

      this.app.use((error, req, res, next) => {
        logger.error('API error:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
      });

      this.app.use((req, res) => {
        res.status(404).json({
          error: 'Not found',
          message: `Route ${req.method} ${req.path} not found`
        });
      });

      logger.api('API server initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize API server:', error);
      throw error;
    }
  }

  async start() {
    try {
      await this.init();

      this.server = this.app.listen(this.port, () => {
        logger.api(`Server running on port ${this.port}`);
        logger.api(`Dashboard: http://localhost:${this.port}/dashboard`);
        logger.api(`API: http://localhost:${this.port}/api/orders`);
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop() {
    try {
      if (this.server) {
        this.server.close();
        logger.api('Server stopped');
      }
      await database.disconnect();
    } catch (error) {
      logger.error('Error stopping server:', error);
    }
  }

  getDashboardHTML() {
    return getDashboardHTML();
  }
}

module.exports = ApiServer;

if (require.main === module) {
  const server = new ApiServer();
  
  server.start().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    logger.api('Received SIGINT, shutting down server...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.api('Received SIGTERM, shutting down server...');
    await server.stop();
    process.exit(0);
  });
}
