# Product Requirements Document (PRD): Grab Order Fetcher Bot

## Document Information
- **Product Name**: Grab Order Fetcher Bot
- **Version**: 1.0
- **Date**: September 27, 2025
- **Author**: Grok AI (based on user specifications and research)
- **Status**: Draft
- **Revision History**:
  - 1.0: Initial draft based on requirements for a free browser automation tool using Puppeteer, Render hosting, and MongoDB Atlas storage.

## Executive Summary
The Grab Order Fetcher Bot is a free, open-source automation tool designed to log into the Grab Merchant web portal, navigate to the orders section, poll for new incoming orders, fetch specific data fields (customer name, order number, driver's name, order details, pricing, timestamp, and screenshot), store the data in a database before it expires (within 15 minutes), and provide readable/exportable outputs. This bot addresses the lack of direct API access for order fetching by using headless browser automation with Puppeteer in Node.js. It is intended for personal use on one's own merchant account, with warnings about potential violations of Grab's terms of service if detected as scraping. Deployment will utilize Render's free tier for background workers, and data storage will be handled via MongoDB Atlas. The bot is not production-grade and emphasizes responsible use to avoid account bans, such as through session rotation and non-aggressive polling.

## Goals and Objectives
### Business Goals
- Enable merchants without API access to automate order data collection from Grab's merchant portal, reducing manual effort.
- Ensure data is captured in real-time (via polling) and stored persistently before the 15-minute expiration window on the source page.
- Provide a free, accessible solution using open-source tools, deployable on no-cost platforms.
- Promote ethical use by including disclaimers on Grab's terms and anti-detection practices.

### User Objectives
- Users (Grab merchants) can fetch and store order data automatically.
- Data is readable via a simple interface (e.g., web dashboard or CLI) and exportable in formats like CSV or JSON.
- Minimize risks of detection by Grab's systems through best practices in automation.

### Success Metrics
- Successful login and data fetch in under 60 seconds per poll.
- 99% uptime on Render hosting (free tier limits apply).
- Storage of at least 100 orders per day without data loss.
- No account bans reported in initial testing (user responsibility).

## Assumptions and Dependencies
### Assumptions
- Users have valid Grab merchant credentials and access to the portal (e.g., https://merchant.grab.com/portal).
- Grab's portal structure (URLs, selectors) remains stable; changes may require script updates.
- No official API is available for direct order fetching, necessitating scraping.
- Users are aware of legal/ethical implications and use the bot responsibly on their own accounts.

### Dependencies
- Node.js runtime (v18+).
- External services: Render for hosting, MongoDB Atlas for database (free tiers sufficient for MVP).
- Libraries: Puppeteer for automation, Mongoose for MongoDB integration, Express for optional dashboard.
- Internet access for deployment and polling.

## Scope
### In Scope
- Browser automation for login, navigation, polling, data extraction, and screenshot capture.
- Polling mechanism (e.g., every 2-5 minutes) to detect new orders.
- Data storage in MongoDB Atlas with fields: customerName, orderNumber, driverName, details, pricing, timestamp, screenshotPath.
- Basic readability (e.g., query API or dashboard) and export (CSV/JSON).
- Deployment as a background worker on Render with cron scheduling.

### Out of Scope
- Real-time webhooks (no API support).
- Multi-user support or advanced authentication (e.g., 2FA handling).
- Mobile app integration.
- Advanced anti-detection (e.g., proxy rotation, fingerprinting evasion beyond basics).
- Compliance auditing or legal advice on Grab's terms.
- Scaling for high-volume merchants (free tiers have limits).

## Functional Requirements
### Core Features
1. **Authentication and Navigation**
   - Log in to Grab Merchant portal using provided credentials (username/password).
   - Navigate to orders section (e.g., from https://merchant.grab.com/portal to orders page).
   - Handle session persistence or re-login on expiration.

2. **Polling and Data Fetching**
   - Poll the orders page periodically (configurable, default 2 minutes) to check for new orders.
   - Identify new orders by comparing timestamps (fetch only those newer than last poll).
   - Extract fields: customer name, order number, driver's name (or "Pending"), order details, pricing, timestamp.
   - Capture screenshot of the order details page or section.

3. **Data Storage**
   - Store fetched data in MongoDB Atlas immediately upon detection (to beat 15-minute expiration).
   - Use schema with required fields; store screenshots as file paths or URLs (e.g., upload to free storage like Cloudinary if needed).

4. **Readability and Export**
   - Provide a simple API or dashboard (via Express) to view stored orders.
   - Support export to CSV or JSON formats.
   - Optional: CLI access for local testing.

### User Stories
- As a merchant, I want to configure my credentials securely so the bot can log in automatically.
- As a merchant, I want the bot to poll for new orders every few minutes so I capture data in real-time.
- As a merchant, I want fetched data stored in a database so I can access it later.
- As a merchant, I want to view and export orders so I can analyze or integrate with other tools.

## Non-Functional Requirements
### Performance
- Polling cycle: < 60 seconds execution time to avoid timeouts on Render.
- Handle up to 50 orders per hour without overload (free tier limits: 512MB RAM on Render).

### Security
- Store credentials as environment variables (never hardcode).
- Use HTTPS for all communications.
- Data encryption in MongoDB Atlas (enabled by default).

### Reliability
- Error handling for failed logins, page changes, or network issues (retry mechanism).
- Logging for debugging (e.g., console or file).

### Usability
- Simple setup guide for deployment.
- Configurable polling interval.

### Compliance
- Include warnings: Automation may violate Grab's terms; users must check robots.txt and agreements.

## Technical Architecture
### High-Level Design
- **Frontend/Interface**: Optional Express.js server for dashboard/export.
- **Backend/Automation**: Node.js with Puppeteer for browser control (headless mode, anti-sandbox args).
- **Database**: MongoDB Atlas with Mongoose ORM for schema and queries.
- **Hosting**: Render Background Worker with cron job for polling.
- **Flow**: Cron triggers script → Launch Puppeteer → Login/Nav → Poll/Extract → Store in DB → Optional notify/export.

### Tech Stack
| Component | Technology |
|-----------|------------|
| Automation | Puppeteer (with puppeteer-core for deployment) |
| Runtime | Node.js v18+ |
| Database | MongoDB Atlas (Mongoose) |
| Server | Express.js (optional) |
| Hosting | Render (Background Worker with cron) |
| Dependencies | dotenv, csv-writer |

### Deployment Workflow
1. Set up GitHub repo with code.
2. Configure env vars (credentials, MongoDB URI) on Render.
3. Deploy as Background Worker; add cron command (e.g., `node index.js`).
4. Handle Puppeteer setup: Install @sparticuz/chromium for browser binary.

## Risks and Mitigations
- **Risk**: Grab detects scraping and bans account. **Mitigation**: Use headless mode, randomize user-agent, poll sparingly (e.g., 5-min intervals), rotate sessions.
- **Risk**: Portal UI changes break selectors. **Mitigation**: Use robust selectors (e.g., data attributes); include monitoring.
- **Risk**: Free tier limits (e.g., Render suspends on inactivity). **Mitigation**: Use cron to keep active; upgrade if needed.
- **Risk**: Data privacy issues. **Mitigation**: Store only user's own data; comply with local laws.

## Timeline and Milestones (High-Level for Development)
- **Week 1**: Setup repo, implement core automation script.
- **Week 2**: Integrate MongoDB, add polling and export features.
- **Week 3**: Deploy to Render, test end-to-end.
- **Week 4**: Documentation, warnings, and release as open-source.

## Appendix
- **References**: Grab Merchant Help Centre. Puppeteer Docs. Render Deployment Guide.
- **Sample Code Snippet**: See previous responses for base script; extend with best practices.