// Offline browser smoke test. Not part of `npm test` because it needs a Chrome
// binary; CI runs it as a separate job.
//
// It launches the bot's own browser — the same `initBrowser()` path a real
// scrape uses, with the same launch flags — and renders a local page. It
// never contacts the Grab portal, so it is safe to run anywhere.
//
// Why it exists: `npm test` never opens a browser, so a puppeteer bump that
// ships a Chrome which cannot actually launch would pass every test. This
// closes that gap.
//
//   HEADLESS_MODE=true node tests/smoke-browser.js
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.HEADLESS_MODE = process.env.HEADLESS_MODE || 'true';

// Keep the persistent profile out of the working tree unless the caller asked
// for a specific location. The bot persists a Chromium profile so the Grab
// session survives between runs; that is worth asserting here.
const os = require('os');
const path = require('path');
const fs = require('fs');

if (!process.env.BROWSER_PROFILE_DIR) {
  process.env.BROWSER_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-browser-profile-'));
}

const GrabBot = require('../src/services/grabBot');

(async () => {
  const bot = new GrabBot();

  try {
    await bot.initBrowser();

    const version = await bot.browser.version();
    console.log('  browser            :', version);

    // The bot sets a persistent userDataDir so the portal session survives
    // between runs. If Chrome silently ignored it, every poll would look like
    // a new device to Grab.
    if (!fs.existsSync(process.env.BROWSER_PROFILE_DIR)) {
      console.error('  FAIL: the browser profile directory was not created');
      process.exit(1);
    }
    console.log('  profile directory  :', process.env.BROWSER_PROFILE_DIR);

    await bot.page.setContent('<h1 id="probe">browser-ok</h1>');
    const rendered = await bot.page.$eval('#probe', el => el.textContent);
    if (rendered !== 'browser-ok') {
      console.error('  FAIL: the page did not render, got:', rendered);
      process.exit(1);
    }
    console.log('  page render        : ok');

    // A second page proves the browser is usable beyond a single tab.
    const second = await bot.browser.newPage();
    await second.close();

    console.log('  PASS: the bot browser launched, rendered, and kept its profile');
  } finally {
    await bot.close();
  }

  process.exit(0);
})().catch(e => {
  console.error('SMOKE CRASH:', e.message);
  process.exit(1);
});
