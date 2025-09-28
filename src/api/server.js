require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const database = require('../config/database');
const ordersRouter = require('./routes/orders');

class ApiServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.server = null;
  }

  /**
   * Initialize the Express server
   */
  async init() {
    try {
      logger.api('Initializing API server...');

      // Connect to database
      await database.connect();

      // Middleware
      this.app.use(express.json());
      this.app.use(express.urlencoded({ extended: true }));

      // CORS middleware
      this.app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
        } else {
          next();
        }
      });

      // Request logging middleware
      this.app.use((req, res, next) => {
        logger.api(`${req.method} ${req.path}`, {
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        next();
      });

      // Static files (for screenshots)
      this.app.use('/screenshots', express.static(path.join(process.cwd(), 'screenshots')));
      this.app.use('/exports', express.static(path.join(process.cwd(), 'exports')));

      // API routes
      this.app.use('/api/orders', ordersRouter);

      // Health check endpoint
      this.app.get('/health', async (req, res) => {
        try {
          const dbHealth = await database.healthCheck();
          const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: dbHealth,
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0'
          };
          res.json(health);
        } catch (error) {
          logger.error('Health check failed:', error);
          res.status(500).json({
            status: 'error',
            message: error.message
          });
        }
      });

      // Root endpoint with basic info
      this.app.get('/', (req, res) => {
        res.json({
          name: 'Grab Order Fetcher Bot API',
          version: '1.0.0',
          description: 'API for accessing fetched Grab orders',
          endpoints: {
            health: '/health',
            orders: '/api/orders',
            recent: '/api/orders/recent',
            stats: '/api/orders/stats',
            export: '/api/orders/export'
          },
          documentation: 'https://github.com/your-username/grab-order-fetcher-bot'
        });
      });

      // Basic dashboard HTML
      this.app.get('/dashboard', (req, res) => {
        res.send(this.getDashboardHTML());
      });

      // Error handling middleware
      this.app.use((error, req, res, next) => {
        logger.error('API error:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
      });

      // 404 handler
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

  /**
   * Start the server
   */
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

  /**
   * Stop the server
   */
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

  /**
   * Get basic dashboard HTML
   */
  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grab Order Fetcher Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #00b14f; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 2em; font-weight: bold; color: #00b14f; }
        .stat-label { color: #666; margin-top: 5px; }
        .orders-table { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: bold; }
        .btn { background: #00b14f; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; margin: 5px; }
        .btn:hover { background: #009640; }
        .loading { text-align: center; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚗 Grab Order Fetcher Dashboard</h1>
            <p>Monitor your automated order fetching system</p>
        </div>

        <div class="stats" id="stats">
            <div class="loading">Loading statistics...</div>
        </div>

        <div class="orders-table">
            <h2 style="padding: 20px; margin: 0; background: #f8f9fa;">Recent Orders</h2>
            <div id="orders">
                <div class="loading">Loading orders...</div>
            </div>
        </div>

        <div style="margin-top: 20px; text-align: center;">
            <a href="/api/orders/export/csv" class="btn">📊 Export CSV</a>
            <a href="/api/orders/export/json" class="btn">📄 Export JSON</a>
            <a href="/health" class="btn">🔍 Health Check</a>
        </div>
    </div>

    <script>
        // Load statistics
        fetch('/api/orders/stats')
            .then(response => response.json())
            .then(data => {
                document.getElementById('stats').innerHTML = \`
                    <div class="stat-card">
                        <div class="stat-value">\${data.totalOrders || 0}</div>
                        <div class="stat-label">Total Orders (7 days)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${data.currency || 'SGD'} \${(data.totalRevenue || 0).toFixed(2)}</div>
                        <div class="stat-label">Total Revenue (7 days)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${data.currency || 'SGD'} \${(data.avgOrderValue || 0).toFixed(2)}</div>
                        <div class="stat-label">Average Order Value</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">\${new Date().toLocaleDateString()}</div>
                        <div class="stat-label">Last Updated</div>
                    </div>
                \`;
            })
            .catch(error => {
                document.getElementById('stats').innerHTML = '<div class="stat-card">Error loading statistics</div>';
            });

        // Load recent orders
        fetch('/api/orders/recent?limit=10')
            .then(response => response.json())
            .then(data => {
                if (data.orders && data.orders.length > 0) {
                    const tableHTML = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>Order #</th>
                                    <th>Customer</th>
                                    <th>Driver</th>
                                    <th>Total</th>
                                    <th>Status</th>
                                    <th>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                \${data.orders.map(order => \`
                                    <tr>
                                        <td>\${order.orderNumber}</td>
                                        <td>\${order.customerName}</td>
                                        <td>\${order.driverName}</td>
                                        <td>\${order.pricing.currency} \${order.pricing.total.toFixed(2)}</td>
                                        <td>\${order.status}</td>
                                        <td>\${new Date(order.orderTimestamp).toLocaleString()}</td>
                                    </tr>
                                \`).join('')}
                            </tbody>
                        </table>
                    \`;
                    document.getElementById('orders').innerHTML = tableHTML;
                } else {
                    document.getElementById('orders').innerHTML = '<div class="loading">No orders found</div>';
                }
            })
            .catch(error => {
                document.getElementById('orders').innerHTML = '<div class="loading">Error loading orders</div>';
            });

        // Auto-refresh every 30 seconds
        setInterval(() => {
            location.reload();
        }, 30000);
    </script>
</body>
</html>
    `;
  }
}

// Export for use in other modules
module.exports = ApiServer;

// Run if this file is executed directly
if (require.main === module) {
  const server = new ApiServer();
  
  server.start().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
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
