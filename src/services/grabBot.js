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
    this.sessionTimeout = 30 * 60 * 1000;
  }

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
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ],
        defaultViewport: { width: 1366, height: 768 }
      };

      if (process.env.NODE_ENV === 'production') {
        const chromium = require('@sparticuz/chromium');
        browserOptions.executablePath = await chromium.executablePath();
        browserOptions.args = [...browserOptions.args, ...chromium.args];
      }

      this.browser = await puppeteer.launch(browserOptions);
      this.page = await this.browser.newPage();

      if (process.env.USER_AGENT_ROTATION === 'true') {
        const userAgent = getRandomUserAgent();
        await this.page.setUserAgent(userAgent);
        logger.puppeteer(`Set user agent: ${userAgent}`);
      }

      await this.page.setViewport({ width: 1366, height: 768 });

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

      logger.puppeteer('Navigating to Grab Merchant Portal...');
      const loginUrl = 'https://weblogin.grab.com/merchant/login?service_id=MEXUSERS&redirect=https%3A%2F%2Fmerchant.grab.com%2Fportal';
      await this.page.goto(loginUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      if (process.env.RANDOM_DELAYS === 'true') {
        const delay = randomDelay(
          parseInt(process.env.MIN_DELAY_MS) || 1000,
          parseInt(process.env.MAX_DELAY_MS) || 3000
        );
        await sleep(delay);
      }

      logger.puppeteer('Entering username...');
      const usernameSelectorStr = 'input#Username, input[name="username"], input[name="email"], input[type="email"], input[id*="email"], input[id*="username"], input[placeholder*="username"], input[placeholder*="Username"]';
      await this.page.waitForSelector(usernameSelectorStr, { timeout: 15000 });

      const usernameInput = await this.page.$(usernameSelectorStr);
      if (!usernameInput) {
        throw new Error('Could not find username input field');
      }

      await usernameInput.click();
      await sleep(500);
      await usernameInput.type(username, { delay: 100 });
      await sleep(randomDelay(500, 1000));

      logger.puppeteer('Clicking Continue button (step 1)...');
      await this.clickButtonByText('Continue');

      logger.puppeteer('Waiting for password challenge page...');
      try {
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      } catch (navError) {
        logger.puppeteer('Navigation timeout, checking current page...');
      }

      await sleep(randomDelay(1000, 2000));

      logger.puppeteer('Entering password...');
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[placeholder="Password"]',
        'input[id*="password"]'
      ];

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await this.page.$(selector);
          if (passwordInput) break;
        } catch (e) {}
      }

      if (!passwordInput) {
        passwordInput = await this.page.evaluateHandle(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          return inputs.find(input =>
            input.type === 'password' ||
            input.placeholder?.toLowerCase().includes('password') ||
            input.name?.toLowerCase().includes('password')
          ) || null;
        });
      }

      if (!passwordInput) {
        throw new Error('Could not find password input field');
      }

      await passwordInput.click();
      await sleep(300);
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
      await sleep(200);
      await this.page.keyboard.type(password, { delay: 80 });
      await sleep(500);

      const passwordLength = await this.page.evaluate(() => {
        const input = document.querySelector('input[type="password"]') ||
                      document.querySelector('input[name="password"]') ||
                      document.querySelector('input[placeholder="Password"]');
        return input ? input.value.length : 0;
      });

      logger.puppeteer(`Password entered: ${passwordLength} characters (expected: ${password.length})`);
      await sleep(randomDelay(1000, 2000));

      logger.puppeteer('Clicking Continue button (step 2)...');
      await this.clickButtonByText('Continue');

      logger.puppeteer('Waiting for login to complete...');
      try {
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      } catch (navError) {
        logger.puppeteer('Navigation timeout, checking if logged in...');
      }

      const currentUrl = this.page.url();
      logger.puppeteer('Current URL after login:', currentUrl);

      if (currentUrl.includes('login') || currentUrl.includes('challenge')) {
        logger.puppeteer('Still on login/challenge page - checking for errors...');
        const hasError = await this.page.evaluate(() => {
          const errorElements = document.querySelectorAll('[class*="error"], [class*="alert"], [class*="invalid"], [class*="message"]');
          for (const el of errorElements) {
            const text = el.textContent.toLowerCase().trim();
            if (text.includes('invalid') || text.includes('incorrect') || text.includes('wrong') || text.includes('error')) {
              return true;
            }
          }
          return false;
        });

        if (hasError) {
          throw new Error('Login failed - invalid credentials or authentication error');
        }
        throw new Error('Login failed - still on login page (check credentials)');
      }

      this.isLoggedIn = true;
      this.lastActivity = Date.now();
      logger.puppeteer('Login successful');

      await this.closePopups();

      return true;
    } catch (error) {
      logger.error('Login failed:', error);
      if (this.page) {
        try {
          await this.page.screenshot({ path: 'screenshots/login_error.png' });
          logger.puppeteer('Saved login error screenshot to screenshots/login_error.png');
        } catch (e) {
          logger.error('Failed to take error screenshot:', e);
        }
      }
      this.isLoggedIn = false;
      throw error;
    }
  }

  isPageValid() {
    try {
      if (!this.page || this.page.isClosed()) return false;
      this.page.url();
      return true;
    } catch (e) {
      return false;
    }
  }

  async closePopups() {
    try {
      logger.puppeteer('Checking for and closing popups...');
      await sleep(2000);

      let maxAttempts = 5;
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts++;

        const closed = await this.page.evaluate(() => {
          const closeSelectors = [
            '.dui-modal-close',
            '.dui-modal .dui-modal-close-btn',
            'button[aria-label="Close"]',
            'button[aria-label="close"]',
            '.dui-drawer .dui-drawer-close',
            '[class*="modal"] [class*="close"]',
            '[class*="popup"] [class*="close"]',
            '.dui-modal-footer button'
          ];

          for (const selector of closeSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
              btn.click();
              return true;
            }
          }

          const modal = document.querySelector('.dui-modal-mask, .dui-modal-wrap, [class*="modal-mask"]');
          if (modal && modal.offsetParent !== null) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              modal.click();
              return true;
            }
          }

          const modals = document.querySelectorAll('.dui-modal, .dui-drawer, [class*="modal"], [class*="drawer"]');
          for (const m of modals) {
            if (m.offsetParent !== null) {
              const closeBtn = m.querySelector('button, [class*="close"], [class*="Close"]');
              if (closeBtn) {
                closeBtn.click();
                return true;
              }
            }
          }

          return false;
        });

        if (!closed) break;
        await sleep(1000);
      }

      logger.puppeteer(`Popup closing complete after ${attempts} attempts`);
      return true;
    } catch (error) {
      logger.puppeteer('Error closing popups:', error.message);
      return false;
    }
  }

  async clickButtonByText(text) {
    try {
      const button = await this.page.$(`button::-p-text(${text})`);
      if (button) {
        await button.click();
        return true;
      }

      await this.page.evaluate((btnText) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const targetBtn = buttons.find(btn =>
          btn.textContent.toLowerCase().trim().includes(btnText.toLowerCase())
        );
        if (targetBtn) {
          targetBtn.click();
          return true;
        }
        return false;
      }, text);

      return true;
    } catch (error) {
      logger.error(`Failed to click button "${text}":`, error);
      throw error;
    }
  }

  async navigateToOrders() {
    try {
      logger.puppeteer('Navigating to orders section...');

      if (!this.isLoggedIn) {
        await this.login();
      }

      await this.closePopups();

      const currentUrl = this.page.url();
      logger.puppeteer('Current URL:', currentUrl);

      if (currentUrl.includes('/order')) {
        logger.puppeteer('Already on orders page');
        this.lastActivity = Date.now();
        return true;
      }

      await sleep(3000);

      let ordersLink = null;
      let usedSelector = '';

      try {
        ordersLink = await this.page.$('[data-testid="orderButton"]');
        if (ordersLink) {
          usedSelector = '[data-testid="orderButton"]';
          logger.puppeteer(`Found orders link with selector: ${usedSelector}`);
        }
      } catch (e) {}

      if (!ordersLink) {
        try {
          ordersLink = await this.page.evaluateHandle(() => {
            const menuItems = Array.from(document.querySelectorAll('.sidebar-menu__item'));
            return menuItems.find(item => {
              const text = item.textContent?.trim().toLowerCase() || '';
              return text.includes('orders');
            }) || null;
          });
          if (ordersLink && ordersLink.asElement) {
            usedSelector = '.sidebar-menu__item (text match)';
            logger.puppeteer(`Found orders link with selector: ${usedSelector}`);
          }
        } catch (e) {}
      }

      if (!ordersLink) {
        ordersLink = await this.page.evaluateHandle(() => {
          const titleSpans = Array.from(document.querySelectorAll('.sidebar-menu-item-title'));
          for (const span of titleSpans) {
            const text = span.textContent?.trim().toLowerCase() || '';
            if (text === 'orders') {
              let parent = span;
              while (parent && parent.tagName !== 'LI' && parent.parentElement) {
                parent = parent.parentElement;
              }
              return parent;
            }
          }
          return null;
        });
        if (ordersLink && ordersLink.asElement) {
          usedSelector = 'sidebar-menu-item-title text match';
          logger.puppeteer(`Found orders link with selector: ${usedSelector}`);
        }
      }

      if (ordersLink && ordersLink.asElement) {
        logger.puppeteer(`Clicking orders link (found via: ${usedSelector})...`);
        await ordersLink.asElement().scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1000);
        await ordersLink.asElement().click();

        logger.puppeteer('Waiting for URL to change to orders page...');
        let maxWait = 30000;
        let waited = 0;
        const checkInterval = 1000;

        while (waited < maxWait) {
          await sleep(checkInterval);
          waited += checkInterval;

          const url = this.page.url();
          if (url.includes('/order')) {
            logger.puppeteer('Successfully navigated to orders page via click');
            break;
          }

          const hasOrderTable = await this.page.evaluate(() => {
            return !!document.querySelector('.dui-table-container, .dui-table-body');
          });
          if (hasOrderTable) {
            logger.puppeteer('Order table found on page');
            break;
          }
        }

        const urlAfterClick = this.page.url();
        if (!urlAfterClick.includes('/order')) {
          logger.puppeteer('Click navigation did not work, trying direct URL...');
          try {
            await this.page.goto('https://merchant.grab.com/order', {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            logger.puppeteer('Direct URL navigation to orders completed');
          } catch (e) {
            logger.puppeteer('Direct navigation timed out');
          }
        }

        logger.puppeteer('Waiting for orders page to render...');
        await sleep(5000);

        const pageContent = await this.page.evaluate(() => {
          return {
            url: window.location.href,
            hasSidebar: !!document.querySelector('.sidebar-menu'),
            hasTable: !!document.querySelector('.dui-table-container, .dui-table-body'),
            hasTabs: !!document.querySelector('.dui-tabs')
          };
        });
        logger.puppeteer('Page content check:', JSON.stringify(pageContent));

        try {
          await this.page.waitForSelector('.sidebar-menu, .dui-table-container', { timeout: 20000 });
          logger.puppeteer('Orders page elements detected');
        } catch (e) {
          logger.puppeteer('Orders page elements not found, taking screenshot...');
          await this.page.screenshot({ path: 'screenshots/debug-orders-page-load.png', fullPage: true });
          logger.puppeteer('Debug screenshot saved');
        }

        this.lastActivity = Date.now();
        logger.puppeteer('Successfully navigated to orders section');
        logger.puppeteer('Current URL:', this.page.url());
        return true;
      } else {
        const pageTitle = await this.page.title();
        const sidebarContent = await this.page.evaluate(() => {
          const sidebar = document.querySelector('.sidebar-menu, .menu-items-container, nav');
          return sidebar ? sidebar.textContent.trim().substring(0, 500) : 'No sidebar found';
        });
        logger.puppeteer('Page title:', pageTitle);
        logger.puppeteer('Sidebar content:', sidebarContent);
        await this.page.screenshot({ path: 'screenshots/debug-orders-nav.png', fullPage: true });
        logger.puppeteer('Debug screenshot saved to screenshots/debug-orders-nav.png');
        throw new Error('Could not find orders navigation link');
      }
    } catch (error) {
      logger.error('Failed to navigate to orders:', error);
      throw error;
    }
  }

  async navigateToHistoryTab() {
    try {
      logger.puppeteer('Navigating to History tab...');

      if (!this.isPageValid()) {
        throw new Error('Page is not valid, cannot navigate to History tab');
      }

      await sleep(3000);

      const historyTabClicked = await this.page.evaluate(() => {
        const allTabs = document.querySelectorAll('[role="tab"], .dui-tabs-tab-btn, [data-node-key]');
        for (const tab of allTabs) {
          const text = tab.textContent?.trim();
          const nodeKey = tab.getAttribute('data-node-key');
          if ((text === 'History' && tab.childElementCount === 0) || nodeKey === 'history') {
            tab.click();
            return { clicked: true, strategy: text === 'History' ? 'text match' : 'data-node-key' };
          }
        }

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (text === 'History' && el.childElementCount === 0) {
            el.click();
            return { clicked: true, strategy: 'direct text match' };
          }
        }

        return { clicked: false, strategy: 'none' };
      });

      logger.puppeteer('History tab click result:', JSON.stringify(historyTabClicked));

      if (historyTabClicked.clicked) {
        logger.puppeteer(`History tab clicked (strategy: ${historyTabClicked.strategy})`);

        try {
          await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
        } catch (e) {
        }

        await sleep(3000);

        if (!this.isPageValid()) {
          throw new Error('Page became invalid after History tab navigation');
        }

        this.lastActivity = Date.now();
        logger.puppeteer('Successfully navigated to History tab');
        return true;
      } else {
        logger.puppeteer('History tab not found, continuing anyway');
        this.lastActivity = Date.now();
        return true;
      }
    } catch (error) {
      logger.error('Failed to navigate to History tab:', error);
      throw error;
    }
  }

  async isSessionValid() {
    try {
      if (!this.page || !this.isLoggedIn) {
        return false;
      }

      if (this.lastActivity && (Date.now() - this.lastActivity) > this.sessionTimeout) {
        logger.puppeteer('Session timeout detected');
        return false;
      }

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

  async cleanup() {
    return this.close();
  }

  getPage() {
    return this.page;
  }

  getBrowser() {
    return this.browser;
  }
}

module.exports = GrabBot;
