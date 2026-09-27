// Live portal smoke test. Not part of `npm test` because it needs the network and
// a Chrome binary. Run it after changing the login flow:
//
//   CHROME_BIN=/path/to/chrome node tests/smoke-live-login.js
//
// It only ever logs in with a deliberately non-existent username, so it is safe.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.HEADLESS_MODE = 'true';
process.env.RANDOM_DELAYS = 'false';
if (process.env.CHROME_BIN) {
  process.env.PUPPETEER_EXECUTABLE_PATH = process.env.CHROME_BIN;
}

// Intentionally bogus: the assertion is that the scraper reports the real reason.
process.env.GRAB_USERNAME = process.env.SMOKE_USERNAME || 'smoke_test_nonexistent_merchant_zzz';
process.env.GRAB_PASSWORD = process.env.SMOKE_PASSWORD || 'definitely-not-the-password';

const GrabBot = require('../src/services/grabBot');

const LOGIN_URL = 'https://weblogin.grab.com/merchant/login?service_id=MEXUSERS&redirect=https%3A%2F%2Fmerchant.grab.com%2Fportal';

(async () => {
  const bot = new GrabBot();
  const t0 = Date.now();

  try {
    await bot.initBrowser();

    // Confirm the step-1 selectors the bot depends on still exist upstream.
    await bot.page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await bot.page.waitForSelector('input#Username', { timeout: 20000 });
    const continueBtn = await bot.page.$('button::-p-text(Continue)');
    console.log('  username input found  : yes');
    console.log('  Continue button found :', !!continueBtn);
    if (!continueBtn) {
      console.log('  FAIL: the Continue selector drifted upstream');
      await bot.close();
      process.exit(1);
    }

    // Now run the real login and check the failure is attributed correctly.
    const t1 = Date.now();
    try {
      await bot.login();
      console.log('  FAIL: login succeeded with a bogus username');
      await bot.close();
      process.exit(1);
    } catch (e) {
      const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
      console.log(`  login rejected in ${elapsed}s`);
      console.log(`  message: ${e.message}`);

      // The SPA fix should keep this well under the old fixed 15s nav timeout
      // plus the 15s password wait that a bad username used to trigger.
      if (elapsed > 40) {
        console.log('  FAIL: login took too long, the SPA wait is not short-circuiting');
        await bot.close();
        process.exit(1);
      }

      if (!/username does not exist/i.test(e.message)) {
        console.log('  FAIL: expected the error to name the unknown username');
        await bot.close();
        process.exit(1);
      }
      console.log('  PASS: error names the real cause and the SPA wait is short-circuited');
    }
  } finally {
    await bot.close();
  }

  console.log(`\nLive smoke test done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch(e => {
  console.error('SMOKE CRASH:', e.message);
  process.exit(1);
});
