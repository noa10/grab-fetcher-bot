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
- **Free Deployment**: Runs on GitHub Actions schedules and Vercel serverless functions within free tiers

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Grab Portal   │◄───│ GitHub Actions   │───►│  MongoDB Atlas  │
│  (Data Source)  │    │ (Fetch Workflow) │    │   (Storage)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │     Vercel       │
                       │  (API + UI)      │
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

> When you're ready to automate the fetcher, continue with the [Deployment](#-deployment) steps to configure GitHub Actions and Vercel.

## 📦 Deployment

### Step 1: Configure GitHub Actions Secrets

1. **Fork this repository** to your GitHub account.
2. **Add repository secrets** at `Settings → Secrets and variables → Actions`:
   ```
   GRAB_USERNAME=your_grab_merchant_email@example.com
   GRAB_PASSWORD=your_grab_merchant_password
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/grab-orders
   ```
3. Keep credentials out of commits; only store them as secrets.

### Step 2: Deploy API and Dashboard to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → import your GitHub repository.
2. Use the **Other** framework preset and leave build/output commands empty.
3. Under **Environment Variables**, add:
   - `MONGODB_URI` — same MongoDB connection string used in GitHub Actions
   - `NODE_ENV` — set to `production`
4. Deploy the project. Vercel will automatically redeploy on every push to the connected branch.

> The dashboard is served by Vercel serverless functions that read from the same MongoDB Atlas instance where GitHub Actions writes fetched orders.

### Step 3: Enable Scheduled Fetching

1. Push the workflow files (under `.github/workflows/`) to your repository.
2. GitHub Actions will execute the "Fetch Grab Orders" workflow every two minutes.
3. Monitor runs in the **Actions** tab and inspect logs for troubleshooting.

> ⏱️ Adjust the polling cadence by editing the cron schedule in `.github/workflows/fetch-orders.yml`.

### Optional: Run Locally

```bash
# Start the order fetcher
npm start

# Start the API server (in another terminal)
npm run server
```

## 📋 CLI Quick Reference

```bash
# Show statistics
npm run orders:stats

# Show today's orders
npm run orders:today

# Export to CSV
npm run orders:export

# Start API server
npm run server
```

### API Endpoints (when server is running)

```bash
# Get all orders (paginated)
curl "http://localhost:3000/api/orders?page=1&limit=20"

# Get recent orders
curl http://localhost:3000/api/orders/recent

# Get statistics
curl http://localhost:3000/api/orders/stats

# Export CSV
curl http://localhost:3000/api/orders/export/csv > orders.csv
```

## 📋 CLI Quick Reference

```bash
# Show statistics
npm run orders:stats

# Show today's orders
npm run orders:today

# Export to CSV
npm run orders:export

# Start API server
npm run server
```

### API Endpoints (when server is running)

```bash
# Get all orders (paginated)
curl "http://localhost:3000/api/orders?page=1&limit=20"

# Get recent orders
curl http://localhost:3000/api/orders/recent

# Get statistics
curl http://localhost:3000/api/orders/stats

# Export CSV
curl http://localhost:3000/api/orders/export/csv > orders.csv
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
├── .github/
│   └── workflows/
│       └── fetch-orders.yml   # Scheduled GitHub Actions workflow
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
├── vercel.json               # Vercel project configuration
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

### GitHub Actions Issues

- **Workflow not running**: Confirm GitHub Actions are enabled for the repository.
- **Login failures**: Re-enter `GRAB_USERNAME` and `GRAB_PASSWORD` secrets and ensure no 2FA prompts block execution.
- **Database connection errors**: Validate the `MONGODB_URI` secret format, including query parameters.

### Vercel Issues

- **API endpoints returning 500**: Check Vercel function logs to confirm environment variables are present.
- **Dashboard not loading**: Ensure all API routes were deployed and that the project is linked to the correct GitHub branch.

### General Issues

- **No orders found**: Verify new orders exist in the Grab portal and review the GitHub Actions logs for scraping errors.
- **Running locally**: Double-check `.env` values and ensure Chromium dependencies are installed if headless mode fails.
- **Puppeteer errors**: Adjust `HEADLESS_MODE`, increase delays, and confirm sufficient memory when running inside Docker.

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

### GitHub Actions Workflow

- Check the **Actions** tab for the "Fetch Grab Orders" workflow runs.
- Expand each run to inspect browser automation logs and download uploaded artifacts.
- Configure GitHub notifications to receive alerts on failed executions.

### Vercel Deployment

- Review function logs and request analytics in the Vercel dashboard.
- Trigger redeploys or rollbacks from Vercel if issues are detected.

### API Health Checks

```bash
# Check system health
curl http://localhost:3000/health

# Check order statistics
curl http://localhost:3000/api/orders/stats
```

### Performance Metrics

- Polling cycle time: ~1 minute GitHub Actions job
- GitHub Actions usage: ~720 minutes/month at 2-minute cadence (within free tier)
- Vercel function invocations: Light API usage within Hobby plan limits
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
- Automated with [GitHub Actions](https://github.com/features/actions) and hosted on [Vercel](https://vercel.com)
- Inspired by the need for accessible order management tools

---

**Remember**: Use responsibly and in compliance with all applicable terms of service and laws.
