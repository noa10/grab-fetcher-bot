# 🚗 Grab Order Fetcher Bot

A free, open-source automation tool designed to fetch order data from Grab Merchant portal using browser automation. This bot helps merchants without API access to automatically collect and store order information.

## ⚠️ Important Disclaimer

**This tool is for educational and personal use only.** Using automated tools to scrape websites may violate the terms of service of the target website. Users are responsible for:

- Checking Grab's Terms of Service and robots.txt
- Using the tool only on their own merchant accounts
- Complying with local laws and regulations
- Understanding the risks of potential account suspension

**Use at your own risk. The developers are not responsible for any consequences.**

## 🌟 Features

- **Automated Order Fetching**: Polls Grab Merchant portal every 2-5 minutes for new orders
- **Data Extraction**: Captures customer name, order number, driver name, pricing, and timestamps
- **Screenshot Capture**: Takes screenshots of order details for record keeping
- **Database Storage**: Stores data in MongoDB Atlas with 15-minute expiration handling
- **Export Functionality**: Export data to CSV or JSON formats
- **Web Dashboard**: Simple web interface to view orders and statistics
- **Anti-Detection**: Basic measures to avoid detection (user-agent rotation, delays)
- **Error Handling**: Comprehensive error handling and retry mechanisms
- **Free Deployment**: Designed for Render's free tier and MongoDB Atlas free tier

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Grab Portal   │◄───│  Puppeteer Bot   │───►│  MongoDB Atlas  │
│  (Data Source)  │    │  (Automation)    │    │   (Storage)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Express API     │
                       │  (Dashboard)     │
                       └──────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- MongoDB Atlas account (free tier)
- Grab Merchant account with portal access
- Git installed

### 1. Clone and Setup

```bash
git clone https://github.com/your-username/grab-order-fetcher-bot.git
cd grab-order-fetcher-bot
npm install
```

### 2. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` file with your credentials:

```env
# Grab Merchant Portal Credentials
GRAB_USERNAME=your_grab_merchant_email@example.com
GRAB_PASSWORD=your_grab_merchant_password

# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/grab-orders

# Bot Configuration (optional)
POLLING_INTERVAL_MINUTES=2
HEADLESS_MODE=true
SCREENSHOT_ENABLED=true
```

### 3. Run Locally

```bash
# Start the order fetcher
npm start

# Or start the API server (in another terminal)
npm run server
```

### 4. Access Dashboard

Open http://localhost:3000/dashboard to view the web interface.

## 📦 Deployment

### Deploy to Render (Recommended)

1. **Fork this repository** to your GitHub account

2. **Create MongoDB Atlas database**:
   - Sign up at [MongoDB Atlas](https://www.mongodb.com/atlas)
   - Create a free cluster
   - Get connection string

3. **Deploy to Render**:
   - Sign up at [Render](https://render.com)
   - Create new "Background Worker"
   - Connect your GitHub repository
   - Set environment variables:
     ```
     GRAB_USERNAME=your_email@example.com
     GRAB_PASSWORD=your_password
     MONGODB_URI=your_mongodb_connection_string
     NODE_ENV=production
     HEADLESS_MODE=true
     ```
   - Deploy!

4. **Optional: Deploy API Dashboard**:
   - Create new "Web Service" on Render
   - Use same repository
   - Set start command: `npm run server`
   - Set same environment variables

### Deploy with Docker

```bash
# Build image
docker build -t grab-order-fetcher .

# Run container
docker run -d --name grab-bot \
  -e GRAB_USERNAME='your_email@example.com' \
  -e GRAB_PASSWORD='your_password' \
  -e MONGODB_URI='your_mongodb_uri' \
  grab-order-fetcher
```

### Using Deployment Script

```bash
# Make script executable
chmod +x deploy.sh

# Run deployment wizard
./deploy.sh

# Or deploy directly
./deploy.sh render
```

## 📊 API Endpoints

### Orders API

- `GET /api/orders` - Get all orders with pagination
- `GET /api/orders/recent` - Get recent orders (last 24h)
- `GET /api/orders/stats` - Get order statistics
- `GET /api/orders/:id` - Get specific order
- `GET /api/orders/search/:query` - Search orders
- `GET /api/orders/export/csv` - Export as CSV
- `GET /api/orders/export/json` - Export as JSON

### System API

- `GET /health` - Health check
- `GET /dashboard` - Web dashboard

### Example API Usage

```bash
# Get recent orders
curl http://localhost:3000/api/orders/recent

# Get statistics
curl http://localhost:3000/api/orders/stats

# Export CSV
curl http://localhost:3000/api/orders/export/csv > orders.csv
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAB_USERNAME` | Grab merchant email | Required |
| `GRAB_PASSWORD` | Grab merchant password | Required |
| `MONGODB_URI` | MongoDB connection string | Required |
| `POLLING_INTERVAL_MINUTES` | Polling frequency | 2 |
| `HEADLESS_MODE` | Run browser in headless mode | true |
| `SCREENSHOT_ENABLED` | Enable screenshot capture | true |
| `MAX_RETRIES` | Max retry attempts | 3 |
| `LOG_LEVEL` | Logging level | info |
| `PORT` | API server port | 3000 |

### Advanced Configuration

```env
# Anti-Detection Settings
USER_AGENT_ROTATION=true
RANDOM_DELAYS=true
MIN_DELAY_MS=1000
MAX_DELAY_MS=3000

# Screenshot Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## 🔧 Development

### Project Structure

```
grab-order-fetcher-bot/
├── src/
│   ├── index.js              # Main entry point
│   ├── config/
│   │   └── database.js       # Database configuration
│   ├── models/
│   │   └── Order.js          # Order data model
│   ├── services/
│   │   ├── grabBot.js        # Puppeteer automation
│   │   ├── orderExtractor.js # Data extraction logic
│   │   ├── screenshotService.js # Screenshot handling
│   │   └── exportService.js  # Export functionality
│   ├── utils/
│   │   ├── logger.js         # Logging utilities
│   │   ├── helpers.js        # Helper functions
│   │   └── errorHandler.js   # Error handling
│   └── api/
│       ├── server.js         # Express server
│       └── routes/
│           └── orders.js     # API routes
├── screenshots/              # Screenshot storage
├── exports/                  # Export files
├── logs/                     # Log files
├── package.json
├── .env.example
├── Dockerfile
├── render.yaml
└── README.md
```

### Running Tests

```bash
# Run tests (when implemented)
npm test

# Run with development logging
NODE_ENV=development npm start
```

### Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit pull request

## 🐛 Troubleshooting

### Common Issues

**1. Login Failed**
- Check credentials in `.env` file
- Verify Grab merchant account access
- Check for 2FA requirements

**2. No Orders Found**
- Verify you're on the correct orders page
- Check if there are actually new orders
- Review browser console for errors

**3. Database Connection Failed**
- Verify MongoDB URI format
- Check network connectivity
- Ensure database user has proper permissions

**4. Puppeteer Errors**
- Install Chrome dependencies: `apt-get install -y chromium-browser`
- Check memory limits on hosting platform
- Verify headless mode settings

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# Run with visible browser (local only)
HEADLESS_MODE=false npm start
```

### Logs

Check logs in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

## 📈 Monitoring

### Health Checks

```bash
# Check system health
curl http://localhost:3000/health

# Check order statistics
curl http://localhost:3000/api/orders/stats
```

### Performance Metrics

- Polling cycle time: < 60 seconds
- Memory usage: < 512MB (Render free tier)
- Storage: MongoDB Atlas free tier (512MB)

## 🔒 Security

- Credentials stored as environment variables
- HTTPS for all communications
- Data encryption in MongoDB Atlas
- No hardcoded secrets in code
- Basic anti-detection measures

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Support

- Create an issue for bugs or feature requests
- Check existing issues before creating new ones
- Provide detailed information for troubleshooting

## 🙏 Acknowledgments

- Built with [Puppeteer](https://pptr.dev/) for browser automation
- Uses [MongoDB Atlas](https://www.mongodb.com/atlas) for data storage
- Deployed on [Render](https://render.com) free tier
- Inspired by the need for accessible order management tools

---

**Remember**: Use responsibly and in compliance with all applicable terms of service and laws.
