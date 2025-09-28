const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const { 
  sleep, 
  randomDelay, 
  getRandomUserAgent, 
  retryWithBackoff 
} = require('../utils/helpers');

class GrabBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.lastActivity = null;
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Initialize browser with anti-detection measures
   */
  async initBrowser() {
    try {
      logger.puppeteer('Initializing browser...');
      
      const browserOptions = {
        headless: process.env.HEADLESS_MODE === 'true',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ],
        defaultViewport: {
          width: 1366,
          height: 768
        }
      };

      // Use @sparticuz/chromium for serverless deployment
      if (process.env.NODE_ENV === 'production') {
        const chromium = require('@sparticuz/chromium');
        browserOptions.executablePath = await chromium.executablePath();
        browserOptions.args = [...browserOptions.args, ...chromium.args];
      }

      this.browser = await puppeteer.launch(browserOptions);
      this.page = await this.browser.newPage();

      // Set random user agent
      if (process.env.USER_AGENT_ROTATION === 'true') {
        const userAgent = getRandomUserAgent();
        await this.page.setUserAgent(userAgent);
        logger.puppeteer(`Set user agent: ${userAgent}`);
      }

      // Set viewport and other properties
      await this.page.setViewport({ width: 1366, height: 768 });
      
      // Block unnecessary resources to speed up loading
      await this.page.setRequestInterception(true);
      this.page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Handle page errors
      this.page.on('error', (error) => {
        logger.error('Page error:', error);
      });

      this.page.on('pageerror', (error) => {
        logger.error('Page script error:', error);
      });

      logger.puppeteer('Browser initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Login to Grab Merchant Portal
   */
  async login() {
    try {
      logger.puppeteer('Starting login process...');
      
      if (!this.page) {
        await this.initBrowser();
      }

      const username = process.env.GRAB_USERNAME;
      const password = process.env.GRAB_PASSWORD;

      if (!username || !password) {
        throw new Error('GRAB_USERNAME and GRAB_PASSWORD environment variables are required');
      }

      // Navigate to login page
      logger.puppeteer('Navigating to Grab Merchant Portal...');
      await this.page.goto('https://merchant.grab.com/portal', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Add random delay to appear more human-like
      if (process.env.RANDOM_DELAYS === 'true') {
        const delay = randomDelay(
          parseInt(process.env.MIN_DELAY_MS) || 1000,
          parseInt(process.env.MAX_DELAY_MS) || 3000
        );
        await sleep(delay);
      }

      // Wait for login form to be visible
      logger.puppeteer('Waiting for login form...');
      await this.page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', {
        timeout: 15000
      });

      // Fill in credentials
      logger.puppeteer('Filling in credentials...');
      
      // Find email/username field
      const emailSelector = await this.page.$('input[type="email"], input[name="email"], input[id*="email"]');
      if (emailSelector) {
        await emailSelector.click();
        await sleep(500);
        await emailSelector.type(username, { delay: 100 });
      } else {
        throw new Error('Could not find email input field');
      }

      // Find password field
      const passwordSelector = await this.page.$('input[type="password"], input[name="password"], input[id*="password"]');
      if (passwordSelector) {
        await passwordSelector.click();
        await sleep(500);
        await passwordSelector.type(password, { delay: 100 });
      } else {
        throw new Error('Could not find password input field');
      }

      // Add delay before clicking login
      await sleep(randomDelay(1000, 2000));

      // Click login button
      logger.puppeteer('Clicking login button...');
      const loginButton = await this.page.$('button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign in")');
      if (loginButton) {
        await loginButton.click();
      } else {
        // Try to find login button by text
        await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const loginBtn = buttons.find(btn => 
            btn.textContent.toLowerCase().includes('login') || 
            btn.textContent.toLowerCase().includes('sign in')
          );
          if (loginBtn) loginBtn.click();
        });
      }

      // Wait for navigation after login
      logger.puppeteer('Waiting for login to complete...');
      await this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Check if login was successful
      const currentUrl = this.page.url();
      if (currentUrl.includes('portal') && !currentUrl.includes('login')) {
        this.isLoggedIn = true;
        this.lastActivity = Date.now();
        logger.puppeteer('Login successful');
        return true;
      } else {
        throw new Error('Login failed - still on login page');
      }

    } catch (error) {
      logger.error('Login failed:', error);
      this.isLoggedIn = false;
      throw error;
    }
  }

  /**
   * Navigate to orders section
   */
  async navigateToOrders() {
    try {
      logger.puppeteer('Navigating to orders section...');
      
      if (!this.isLoggedIn) {
        await this.login();
      }

      // Look for orders/order management link
      const ordersSelectors = [
        'a[href*="order"]',
        'a[href*="Order"]',
        'nav a:contains("Orders")',
        'nav a:contains("Order Management")',
        '.menu a:contains("Orders")',
        '.sidebar a:contains("Orders")'
      ];

      let ordersLink = null;
      for (const selector of ordersSelectors) {
        try {
          ordersLink = await this.page.$(selector);
          if (ordersLink) break;
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!ordersLink) {
        // Try to find by text content
        ordersLink = await this.page.evaluateHandle(() => {
          const links = Array.from(document.querySelectorAll('a'));
          return links.find(link => 
            link.textContent.toLowerCase().includes('order') ||
            link.textContent.toLowerCase().includes('orders')
          );
        });
      }

      if (ordersLink && ordersLink.asElement) {
        await ordersLink.asElement().click();
        await this.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 15000
        });
        
        this.lastActivity = Date.now();
        logger.puppeteer('Successfully navigated to orders section');
        return true;
      } else {
        throw new Error('Could not find orders navigation link');
      }

    } catch (error) {
      logger.error('Failed to navigate to orders:', error);
      throw error;
    }
  }

  /**
   * Check if session is still valid
   */
  async isSessionValid() {
    try {
      if (!this.page || !this.isLoggedIn) {
        return false;
      }

      // Check if session has timed out
      if (this.lastActivity && (Date.now() - this.lastActivity) > this.sessionTimeout) {
        logger.puppeteer('Session timeout detected');
        return false;
      }

      // Try to access current page
      const currentUrl = this.page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        logger.puppeteer('Redirected to login page - session invalid');
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking session validity:', error);
      return false;
    }
  }

  /**
   * Refresh session by navigating to a safe page
   */
  async refreshSession() {
    try {
      if (!this.page) {
        return false;
      }

      logger.puppeteer('Refreshing session...');
      await this.page.reload({ waitUntil: 'networkidle2' });
      this.lastActivity = Date.now();
      
      return true;
    } catch (error) {
      logger.error('Failed to refresh session:', error);
      return false;
    }
  }

  /**
   * Close browser and cleanup
   */
  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        logger.puppeteer('Browser closed successfully');
      }
    } catch (error) {
      logger.error('Error closing browser:', error);
    }
  }

  /**
   * Get current page for external operations
   */
  getPage() {
    return this.page;
  }

  /**
   * Get browser instance
   */
  getBrowser() {
    return this.browser;
  }
}

module.exports = GrabBot;
