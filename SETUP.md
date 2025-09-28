# 🚀 Setup Guide - Grab Order Fetcher Bot

This guide will walk you through setting up the Grab Order Fetcher Bot from scratch.

## 📋 Prerequisites Checklist

Before starting, ensure you have:

- [ ] **Node.js 18+** installed ([Download here](https://nodejs.org/))
- [ ] **Git** installed ([Download here](https://git-scm.com/))
- [ ] **Grab Merchant Account** with portal access
- [ ] **MongoDB Atlas Account** (free tier is sufficient)
- [ ] **Basic terminal/command line knowledge**

## 🔧 Step-by-Step Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/grab-order-fetcher-bot.git
cd grab-order-fetcher-bot
```

### Step 2: Install Dependencies

```bash
npm install
```

If you encounter Puppeteer installation issues:
```bash
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

### Step 3: Set Up MongoDB Atlas

1. **Create Account**: Go to [MongoDB Atlas](https://www.mongodb.com/atlas) and sign up
2. **Create Cluster**: 
   - Choose "Free" tier (M0 Sandbox)
   - Select a region close to you
   - Name your cluster (e.g., "grab-orders")
3. **Create Database User**:
   - Go to "Database Access"
   - Click "Add New Database User"
   - Choose "Password" authentication
   - Create username and password
   - Grant "Read and write to any database" role
4. **Configure Network Access**:
   - Go to "Network Access"
   - Click "Add IP Address"
   - Choose "Allow Access from Anywhere" (0.0.0.0/0)
5. **Get Connection String**:
   - Go to "Clusters"
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password

### Step 4: Configure Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your credentials:

```env
# Grab Merchant Portal Credentials
GRAB_USERNAME=your_grab_merchant_email@example.com
GRAB_PASSWORD=your_grab_merchant_password

# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/grab-orders?retryWrites=true&w=majority

# Bot Configuration (optional)
POLLING_INTERVAL_MINUTES=2
HEADLESS_MODE=true
SCREENSHOT_ENABLED=true
MAX_RETRIES=3
LOG_LEVEL=info
```

### Step 5: Test the Setup

```bash
npm test
```

This will run basic tests to verify:
- Environment variables are set correctly
- Database connection works
- All components are functioning

### Step 6: Run the Bot Locally

```bash
# Start the order fetcher
npm start
```

In another terminal, start the API server:
```bash
npm run server
```

### Step 7: Access the Dashboard

Open your browser and go to:
- **Dashboard**: http://localhost:3000/dashboard
- **API**: http://localhost:3000/api/orders
- **Health Check**: http://localhost:3000/health

## 🌐 Deployment to Render

### Step 1: Prepare for Deployment

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial setup"
   git push origin main
   ```

2. **Create Render Account**: Sign up at [Render](https://render.com)

### Step 2: Deploy Background Worker

1. **Create New Service**:
   - Click "New +" → "Background Worker"
   - Connect your GitHub repository
   - Choose the repository

2. **Configure Service**:
   - **Name**: `grab-order-fetcher-worker`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

3. **Set Environment Variables**:
   ```
   NODE_ENV=production
   GRAB_USERNAME=your_grab_merchant_email@example.com
   GRAB_PASSWORD=your_grab_merchant_password
   MONGODB_URI=your_mongodb_connection_string
   HEADLESS_MODE=true
   SCREENSHOT_ENABLED=true
   POLLING_INTERVAL_MINUTES=2
   ```

4. **Deploy**: Click "Create Background Worker"

### Step 3: Deploy API Server (Optional)

1. **Create Web Service**:
   - Click "New +" → "Web Service"
   - Connect same repository

2. **Configure Service**:
   - **Name**: `grab-order-fetcher-api`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run server`

3. **Set Environment Variables**:
   ```
   NODE_ENV=production
   MONGODB_URI=your_mongodb_connection_string
   PORT=10000
   ```

4. **Deploy**: Click "Create Web Service"

## 🔍 Verification

### Check if Everything is Working

1. **Monitor Logs**:
   - Go to your Render dashboard
   - Click on your background worker
   - Check the "Logs" tab for activity

2. **Check Database**:
   - Log into MongoDB Atlas
   - Go to "Collections"
   - Look for the "orders" collection
   - Verify orders are being stored

3. **Test API** (if deployed):
   - Visit your Render web service URL
   - Add `/dashboard` to see the interface
   - Check `/health` endpoint

### Expected Log Messages

You should see logs like:
```
[BOT] Grab Order Fetcher initialized successfully
[BOT] Starting polling every 2 minutes...
[PUPPETEER] Login successful
[BOT] Found 3 new orders
[ORDER] Order ORD123456 saved successfully
```

## 🐛 Troubleshooting

### Common Issues and Solutions

**1. "Login failed" Error**
- ✅ Verify your Grab credentials are correct
- ✅ Check if your account requires 2FA (not supported)
- ✅ Ensure you have access to the merchant portal

**2. "Database connection failed" Error**
- ✅ Check MongoDB URI format
- ✅ Verify database user credentials
- ✅ Ensure network access is configured (0.0.0.0/0)

**3. "No orders found" Error**
- ✅ Check if there are actually new orders in your portal
- ✅ Verify the bot is navigating to the correct page
- ✅ Check browser console for JavaScript errors

**4. Puppeteer/Chrome Issues**
- ✅ On local machine: Install Chrome browser
- ✅ On Render: The deployment handles this automatically
- ✅ Check memory limits (Render free tier: 512MB)

**5. "Target closed" or "Session closed" Errors**
- ✅ These are normal and the bot will automatically recover
- ✅ Check if polling interval is too aggressive
- ✅ Monitor memory usage

### Debug Mode

To run in debug mode locally:
```bash
LOG_LEVEL=debug HEADLESS_MODE=false npm start
```

This will:
- Show detailed logs
- Open browser window (so you can see what's happening)
- Help identify issues

### Getting Help

1. **Check Logs**: Always check the logs first
2. **Review Environment**: Verify all environment variables
3. **Test Locally**: Try running locally before deploying
4. **Create Issue**: If stuck, create a GitHub issue with:
   - Error messages
   - Environment details
   - Steps to reproduce

## 📊 Monitoring and Maintenance

### Regular Checks

- **Weekly**: Check if orders are being fetched correctly
- **Monthly**: Review error logs and statistics
- **Quarterly**: Update dependencies and security patches

### Performance Optimization

- Monitor memory usage on Render
- Adjust polling interval based on order volume
- Clean up old screenshots and exports regularly

### Security Best Practices

- Regularly rotate your Grab password
- Monitor for unusual activity
- Keep dependencies updated
- Use strong MongoDB passwords

## 🎉 You're All Set!

Your Grab Order Fetcher Bot should now be running and automatically collecting orders. The bot will:

- ✅ Poll for new orders every 2 minutes
- ✅ Extract order details and pricing
- ✅ Capture screenshots
- ✅ Store everything in MongoDB
- ✅ Provide a web dashboard for viewing data
- ✅ Handle errors and recover automatically

**Next Steps**:
- Monitor the dashboard for incoming orders
- Export data as needed (CSV/JSON)
- Customize polling intervals if needed
- Set up alerts for critical errors

**Remember**: Use responsibly and in compliance with Grab's terms of service!
