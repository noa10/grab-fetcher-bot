/**
 * Recover orders from Grab's History tab for days the bot was down.
 *
 * Different from backfill-missing-orders.js (which needs a POS export) and from
 * backfill-from-sales-export.js (which only repairs rows already present): this
 * one drives the portal's own date picker, so it needs no external file.
 *
 * The History tab shows one MYT day at a time and the portal keeps 30 days, so
 * anything inside that window is recoverable. Writes are additive and idempotent
 * — they go through the same GitHubActionsRunner.processOrder the live poll uses,
 * keyed on (orderNumber, orderDate) — so a re-run is safe.
 *
 * Usage:
 *   node scripts/backfill-portal-days.js --from 2026-10-22 --to 2026-10-27
 *   node scripts/backfill-portal-days.js --from 2026-10-22 --to 2026-10-27 --apply
 *
 * Default is a dry run: it scrapes and reports, writes nothing.
 */
require('dotenv').config();
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const database = require('../src/config/database');
const GrabBot = require('../src/services/grabBot');
const OrderExtractor = require('../src/services/orderExtractor');
const ScreenshotService = require('../src/services/screenshotService');
const GitHubActionsRunner = require('../src/github-actions-runner');
const logger = require('../src/utils/logger');
const { sleep } = require('../src/utils/helpers');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const val = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const FROM = val('--from');
const TO = val('--to');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
if (!FROM || !TO || !ISO.test(FROM) || !ISO.test(TO) || FROM > TO) {
  console.error('Usage: node scripts/backfill-portal-days.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]');
  process.exit(1);
}

/** Every YYYY-MM-DD from FROM to TO inclusive (no tz math — pure calendar walk). */
function eachDay(from, to) {
  const days = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = cur; t <= end; t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * What the History view currently shows: the picker's own date text and the
 * visible history rows.
 *
 * `[data-testid="datePicker"]` is an <input>, so the selected day lives in
 * `.value` — its innerText is always empty. The page also renders the live
 * "current orders" table and an empty placeholder table, so rows must be read
 * from `.history-table-list` and must carry 5+ cells, exactly like the extractor.
 */
function readHistoryState(page) {
  return page.evaluate(() => {
    const dp = document.querySelector('[data-testid="datePicker"]');
    const rows = Array.from(document.querySelectorAll('.history-table-list .dui-table-body tbody tr'))
      .filter(r => r.querySelectorAll('.dui-table-cell').length >= 5)
      .map(r => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 80));
    return { value: dp ? dp.value : '', rows };
  });
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Open the History date picker and pick `dateStr` (YYYY-MM-DD).
 *
 * React reverts a programmatic input value, and clicking an out-of-range cell
 * silently does nothing, so this walks the month header back with trusted clicks
 * and then clicks the target day cell. Returns true only when the picker's own
 * value names the requested day and the table has reloaded for it.
 */
async function selectDate(page, dateStr, beforeSig) {
  const [y, m, d] = dateStr.split('-').map(Number);

  await page.click('[data-testid="datePicker"]');
  await sleep(1200);

  for (let guard = 0; guard < 36; guard++) {
    const header = await page.evaluate(() => {
      const el = document.querySelector('.dui-picker-header, [class*="picker-header"]');
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
    });
    // Renders as "Oct2026" (month and year in separate spans), so a space is optional.
    const hm = header.match(/([A-Za-z]{3,9})\s*(\d{4})/);
    if (!hm) break;

    const key = hm[1].toLowerCase();
    const hmonth = MONTHS.indexOf(key) >= 0 ? MONTHS.indexOf(key) : MONTHS_SHORT.indexOf(key.slice(0, 3));
    const hy = Number(hm[2]);
    if (hmonth < 0) break;
    if (hy === y && hmonth === m - 1) break;

    const delta = (hy - y) * 12 + (hmonth - (m - 1));
    const btn = delta > 0
      ? (delta >= 12 ? '.dui-picker-header-super-prev-btn' : '.dui-picker-header-prev-btn')
      : '.dui-picker-header-next-btn';
    const el = await page.$(btn);
    if (!el) break;
    await el.click();
    await sleep(450);
  }

  const clicked = await page.evaluate((target) => {
    const cells = Array.from(document.querySelectorAll('td.dui-picker-cell'));
    for (const cell of cells) {
      const title = cell.getAttribute('title') || '';
      const inner = cell.querySelector('.dui-picker-cell-inner');
      const text = (inner ? inner.textContent : cell.textContent).trim();
      const matches = title.startsWith(target) || (title === '' && text === String(Number(target.slice(8))));
      if (matches && !cell.className.includes('disabled')) {
        (inner || cell).click();
        return { ok: true, title, text };
      }
    }
    return { ok: false, sample: cells.slice(0, 5).map(c => c.getAttribute('title')) };
  }, dateStr);

  if (!clicked.ok) {
    logger.error(`Could not find a selectable cell for ${dateStr}: ${JSON.stringify(clicked.sample)}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  // The value the picker must end up showing, e.g. "26 Oct 2026".
  const expect = `${d} ${MONTHS_SHORT[m - 1].replace(/^./, (c) => c.toUpperCase())} ${y}`;

  for (let i = 0; i < 24; i++) {
    await sleep(1000);
    const s = await readHistoryState(page);
    const sig = s.rows.join('~');
    const valueOk = s.value.includes(expect);
    const reloaded = beforeSig === undefined || sig !== beforeSig;
    if (valueOk && reloaded) {
      logger.info(`[DATE] ${dateStr} — picker "${s.value}", history rows=${s.rows.length}`);
      return true;
    }
    if (valueOk && i >= 6) {
      // Table already matched this day (e.g. re-picking the same date).
      logger.info(`[DATE] ${dateStr} — picker "${s.value}", history rows=${s.rows.length} (table unchanged)`);
      return true;
    }
  }

  const finalState = await readHistoryState(page);
  logger.error(`[DATE] ${dateStr} did not settle — picker "${finalState.value}", rows=${finalState.rows.length}`);
  return false;
}

/** Wait until the history table stops changing, then report its rows. */
async function settleRows(page) {
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const s = await readHistoryState(page);
    const sig = s.rows.join('~');
    if (sig === prev) return s.rows;
    prev = sig;
    await sleep(1200);
  }
  return (await readHistoryState(page)).rows;
}

async function main() {
  const days = eachDay(FROM, TO);
  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — ${days.length} day(s): ${FROM} → ${TO}\n`);

  const bot = new GrabBot();
  const runner = new GitHubActionsRunner();
  runner.bot = bot;

  await database.connect();
  await bot.initBrowser();
  await bot.login();
  await bot.navigateToOrders();
  await bot.navigateToHistoryTab();

  const page = bot.getPage();
  await page.waitForSelector('.history-table-list, .dui-table-body', { timeout: 20000 });
  await page.screenshot({ path: 'screenshots/backfill-start.png' }).catch(() => {});

  const results = [];

  for (const day of days) {
    logger.info(`\n===== ${day} =====`);
    let rows = 0;
    try {
      const before = await readHistoryState(page);
      const beforeSig = before.rows.join('~');
      const picked = await selectDate(page, day, beforeSig);
      if (!picked) {
        results.push({ day, picked: false, scraped: 0, saved: 0 });
        continue;
      }
      const settled = await settleRows(page);
      rows = settled.length;

      // Fresh extractor per day: lastPollTime=null makes filterNewOrders keep
      // everything on the visible tab, which is exactly this one MYT day.
      const extractor = new OrderExtractor(page);
      runner.extractor = extractor;
      const orders = await extractor.extractOrders();
      logger.info(`[DAY ${day}] table rows=${rows}, extracted=${orders.length}`);

      // Every row must belong to the day we picked; a mismatch means the tab did
      // not actually reload and the scrape would be filed under the wrong date.
      const mytDay = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
      const offDay = orders.filter(o => mytDay(o.orderTimestamp) !== day);
      if (offDay.length) {
        throw new Error(`${offDay.length}/${orders.length} extracted orders are not on ${day} — refusing to write (table did not reload)`);
      }

      let saved = 0;
      if (APPLY) {
        for (const order of orders) {
          const wrote = await runner.processOrder(order);
          if (wrote) saved++;
        }
      }
      results.push({ day, picked: true, rows, scraped: orders.length, saved });
    } catch (e) {
      logger.error(`[DAY ${day}] failed: ${e.message}`);
      results.push({ day, picked: true, rows, scraped: 0, saved: 0, error: e.message });
    }
  }

  console.log('\n===== SUMMARY =====');
  console.log('day         rows  scraped  saved');
  for (const r of results) {
    console.log(`${r.day}  ${String(r.rows ?? 0).padStart(4)}  ${String(r.scraped).padStart(7)}  ${String(r.saved).padStart(5)}${r.error ? '  ERROR: ' + r.error : ''}`);
  }
  const tot = results.reduce((a, r) => a + r.scraped, 0);
  console.log(`total scraped: ${tot}${APPLY ? `, saved: ${results.reduce((a, r) => a + r.saved, 0)}` : ' (dry run — nothing written)'}`);

  await bot.cleanup();
  await database.disconnect().catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  logger.error('Backfill failed:', e);
  process.exit(1);
});
