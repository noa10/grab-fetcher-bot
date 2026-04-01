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
- **Export Functionality**: Export data to CSV or JSON formats with filter support
- **Premium Dashboard**: Modern web interface with real-time stats, charts, and order management
- **Authentication**: Secure login with session management, remember me, and password reset
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

Open http://localhost:3000/login to sign in, then access the dashboard at http://localhost:3000/dashboard.

**Default credentials:** `admin` / `admin123` (change via `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables)

> When you're ready to automate the fetcher, continue with the [Deployment](#-deployment) steps to configure GitHub Actions and Vercel.

## 🔐 Authentication

The dashboard is protected with session-based authentication.

### Default Admin Account

On first startup, a default admin account is created automatically:
- **Username:** `admin` (or value of `ADMIN_USERNAME`)
- **Password:** `admin123` (or value of `ADMIN_PASSWORD`)

> **Important:** Change the default credentials immediately in production.

### Features

- **Login page** with username/password authentication
- **Remember me** toggle (extends session to 30 days vs default 24 hours)
- **Forgot password** flow with on-screen reset code (15-minute expiry)
- **Session management** via secure HTTP-only cookies
- **API protection** — all `/api/*` endpoints require authentication (except `/health`)

### Setting Custom Admin Credentials

Add to your `.env` file:

```env
ADMIN_USERNAME=your_username
ADMIN_PASSWORD=your_secure_password
SESSION_SECRET=your_random_secret_key_change_this_in_production
```

## 🖥️ Dashboard v2

The dashboard has been completely redesigned with a modern UI/UX.

### Views

- **Dashboard** — Real-time statistics, activity charts, and status breakdown
- **All Orders** — Full order management with filters, pagination, and export
- **Health Check** — System status with database, memory, and uptime monitoring

### Key Features

| Feature | Description |
|---------|-------------|
| Malaysia Time (MYT) | All dates display in GMT+8 timezone |
| Collapsible Sidebar | Toggle between full and icon-only modes |
| Sticky Navigation | Sidebar stays visible while scrolling |
| Dark/Light Theme | Toggle with preference persistence |
| Real-time Stats | Cards fetch live data from MongoDB |
| Filtered Export | CSV/JSON export respects active filters |
| Today's Orders Default | All Orders view defaults to current date |
| Auto-refresh | Data refreshes every 60 seconds |

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
   - `ADMIN_USERNAME` — your dashboard admin username
   - `ADMIN_PASSWORD` — your dashboard admin password
   - `SESSION_SECRET` — a random string for session encryption
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

## 📊 API Endpoints

### Authentication API

- `GET /login` — Login page
- `POST /api/auth/login` — Authenticate (body: `{ username, password, rememberMe }`)
- `POST /api/auth/logout` — End session
- `POST /api/auth/forgot-password` — Generate password reset code (body: `{ username }`)
- `POST /api/auth/reset-password` — Reset password (body: `{ username, token, newPassword }`)
- `GET /api/auth/me` — Get current user info

### Orders API (requires authentication)

- `GET /api/orders` — Get all orders with pagination and filtering
- `GET /api/orders/recent` — Get recent orders (last 24h)
- `GET /api/orders/stats` — Get order statistics
- `GET /api/orders/:id` — Get specific order
- `GET /api/orders/search/:query` — Search orders
- `GET /api/orders/export/csv` — Export filtered orders as CSV
- `GET /api/orders/export/json` — Export filtered orders as JSON

### Dashboard API (requires authentication)

- `GET /api/dashboard/summary` — Get dashboard statistics, charts data, and status breakdown

### System API (public)

- `GET /health` — Health check (returns HTML UI or JSON based on Accept header)
- `GET /dashboard` — Web dashboard (requires authentication)

### Filtering Orders

The `/api/orders` endpoint supports these query parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `page` | Page number | `?page=1` |
| `limit` | Results per page (max 100) | `?limit=20` |
| `search` | Search across multiple fields | `?search=order123` |
| `status` | Filter by status | `?status=completed` |
| `orderType` | Filter by type | `?orderType=delivery` |
| `startDate` | Filter from date | `?startDate=2026-04-01` |
| `endDate` | Filter to date | `?endDate=2026-04-02` |
| `sortBy` | Sort field | `?sortBy=orderTimestamp` |
| `sortOrder` | Sort direction | `?sortOrder=desc` |

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAB_USERNAME` | Grab merchant email | Required |
| `GRAB_PASSWORD` | Grab merchant password | Required |
| `MONGODB_URI` | MongoDB connection string | Required |
| `ADMIN_USERNAME` | Dashboard admin username | `admin` |
| `ADMIN_PASSWORD` | Dashboard admin password | `admin123` |
| `SESSION_SECRET` | Session encryption key | `grab-fetcher-secret-change-in-production` |
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
├── api/                        # Vercel serverless functions
│   ├── dashboard.js
│   ├── dashboard/summary.js
│   ├── health.js
│   └── orders/
├── src/
│   ├── index.js              # Main entry point
│   ├── config/
│   │   └── database.js       # Database configuration
│   ├── models/
│   │   ├── Order.js          # Order data model
│   │   ├── User.js           # User authentication model
│   │   └── PasswordReset.js  # Password reset tokens
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
│       ├── dashboard-template.js  # Dashboard HTML template
│       ├── login-template.js      # Login page HTML template
│       ├── health-template.js     # Health check HTML template
│       └── routes/
│           ├── orders.js     # Order API routes
│           └── auth.js       # Authentication routes & middleware
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

## 📄 Changelog

### v1.0.0 (2026-04-02) — Initial Release

Complete dashboard overhaul with authentication and modern UI/UX.

#### Authentication & Security
- Session-based login with `express-session` and `bcryptjs`
- Remember me toggle (30-day sessions)
- Forgot password flow with on-screen reset codes
- Protected API endpoints — all `/api/*` routes require authentication
- Default admin account (`admin`/`admin123`, configurable via env vars)

#### Dashboard UI/UX
- Redesigned single-page application with view switching
- **Dashboard view**: Real-time stats, activity charts, status breakdown (no order table)
- **All Orders view**: Full order management with working filter bar, pagination, and export
- **Health Check view**: Proper status page with cards instead of raw JSON
- Malaysia Time (MYT GMT+8) displayed on all views
- Collapsible sidebar (full ↔ icon-only) with sticky positioning
- Dark/light theme toggle with persistence
- Auto-refresh every 60 seconds

#### Data & API
- Dashboard stats cards fetch real-time data from MongoDB
- All Orders defaults to today's orders (MYT timezone)
- "Show All Orders" button to view historical data
- Export CSV/JSON buttons moved to All Orders page, respects active filters
- Last fetch indicator shows actual MYT time with relative ago text

#### New Dependencies
- `express-session` — Session management
- `bcryptjs` — Password hashing
- `cookie-parser` — Cookie handling

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
