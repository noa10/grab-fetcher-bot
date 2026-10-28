/**
 * Daily heartbeat: one Telegram line proving the pipeline actually produced data.
 *
 * Systemd failure alerting only catches a non-zero exit. A run that exits 0 while
 * extracting nothing — selector drift, an empty History tab, a portal that served
 * a skeleton — looks perfectly healthy, and that is the failure mode where you find
 * out days later. This compares today against the shop's own trailing week instead.
 *
 * Runs at 14:35 UTC = 22:35 MYT, five minutes after the last trading-window poll.
 *
 * Usage:
 *   node scripts/daily-heartbeat.js            # send
 *   node scripts/daily-heartbeat.js --dry-run  # print only
 */
require('dotenv').config();

const { spawnSync } = require('child_process');
const database = require('../src/config/database');
const Order = require('../src/models/Order');
const Feedback = require('../src/models/Feedback');
const { getMalaysiaDateString, mytDayStart, mytDayEnd } = require('../src/utils/helpers');

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET = process.env.GRAB_ALERT_TARGET || 'telegram';
const HERMES = process.env.HERMES_BIN || '/home/ubuntu/.local/bin/hermes';
const POLL_UNIT = process.env.GRAB_POLL_UNIT || 'grab-fetcher.service';

/** Median of a numeric array; 0 for an empty one. */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mytTime(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function mytDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
}

function systemdProp(prop) {
  // -p and its value must be separate argv entries; `-pResult` is rejected.
  const res = spawnSync('systemctl', ['show', POLL_UNIT, '-p', prop, '--timestamp=unix', '--value'],
    { encoding: 'utf8', timeout: 5000 });
  return res.status === 0 ? res.stdout.trim() : '';
}

async function collect() {
  const today = getMalaysiaDateString();
  const todayStart = mytDayStart(today);

  // orderDate is stored as the MYT midnight instant, so one equality match is the
  // whole calendar day — the same key the scraper dedups on.
  const todayOrders = await Order.find({ orderDate: todayStart }).select('pricing.total').lean();
  const revenue = todayOrders.reduce((sum, o) => sum + (o.pricing?.total || 0), 0);

  // Trailing week, today excluded: the shop's own baseline, not a hardcoded number.
  const weekAgo = new Date(todayStart.getTime() - 7 * 86400000);
  const trailing = await Order.aggregate([
    { $match: { orderDate: { $gte: weekAgo, $lt: todayStart } } },
    { $group: { _id: '$orderDate', n: { $sum: 1 } } }
  ]);
  const daily = [];
  for (let i = 1; i <= 7; i++) {
    const day = new Date(todayStart.getTime() - i * 86400000);
    const hit = trailing.find((t) => new Date(t._id).getTime() === day.getTime());
    daily.push(hit ? hit.n : 0);
  }

  // --timestamp=unix renders as "@1793161619"; Number() alone yields NaN.
  const epoch = (prop) => Number(String(systemdProp(prop) || '').replace(/^@/, '')) || 0;
  // ExecMainExitTimestamp is EMPTY while a run is in flight, and the heartbeat
  // fires close to the last poll of the day, so read the active state as well.
  const pollState = systemdProp('ActiveState') || 'unknown';
  const lastPollEpoch = epoch('ExecMainExitTimestamp');
  const pollStartedEpoch = epoch('ExecMainStartTimestamp');
  const lastPollResult = systemdProp('Result') || 'unknown';

  const reviewTotal = await Feedback.countDocuments();
  // Grab sends reviewReplies as [null] and the model stores merchantReplies, so
  // match the same shape findUnreplied() does rather than probing raw Grab fields.
  const unreplied = await Feedback.countDocuments({
    $or: [{ merchantReplies: { $size: 0 } }, { merchantReplies: { $exists: false } }]
  });
  const newestReview = await Feedback.findOne().sort({ createdAt: -1 }).select('createdAt').lean();

  return {
    today, todayStart, count: todayOrders.length, revenue,
    median: median(daily), daily,
    pollState, lastPollEpoch, pollStartedEpoch, lastPollResult,
    reviewTotal, unreplied,
    newestReview: newestReview ? new Date(newestReview.createdAt).getTime() : 0
  };
}

function compose(d) {
  const warnings = [];
  const lines = [];

  const today = d.todayStart.getTime();
  lines.push(`📊 *Mad Krapow — ${mytDate(today)}*`);
  lines.push(`Orders: *${d.count}* · RM${d.revenue.toFixed(2)}`);
  lines.push(`7-day median: ${d.median}`);

  // Comparing a part-day to a full-day median cries wolf, so the count check only
  // applies once the trading window has closed. A manual run at lunchtime reports
  // the numbers without judging them.
  const [mytHour, mytMin] = new Date()
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
    .split(':').map(Number);
  const dayComplete = mytHour * 60 + mytMin >= 22 * 60 + 30;

  // A zero day only matters if the shop normally has volume; a genuinely quiet
  // Monday should not page anyone.
  if (dayComplete && d.count === 0 && d.median >= 3) {
    warnings.push(`no orders captured today while the trailing median is ${d.median}`);
  } else if (dayComplete && d.median >= 3 && d.count < d.median * 0.4) {
    warnings.push(`only ${d.count} order(s) vs a trailing median of ${d.median}`);
  }

  const pollBusy = d.pollState === 'active' || d.pollState === 'activating';
  if (pollBusy && d.pollStartedEpoch) {
    const runningMin = Math.round((Date.now() - d.pollStartedEpoch * 1000) / 60000);
    lines.push(`Last poll: in progress since ${mytTime(d.pollStartedEpoch * 1000)} MYT`);
    if (runningMin > 15) warnings.push(`a poll has been running for ${runningMin} min`);
  } else if (d.lastPollEpoch) {
    const ageMin = Math.round((Date.now() - d.lastPollEpoch * 1000) / 60000);
    lines.push(`Last poll: ${mytTime(d.lastPollEpoch * 1000)} MYT (${d.lastPollResult})`);
    if (d.lastPollResult !== 'success') warnings.push(`last poll result is ${d.lastPollResult}`);
    else if (ageMin > 90) warnings.push(`last successful poll was ${ageMin} min ago`);
  } else {
    lines.push('Last poll: unknown');
    warnings.push('could not read the last poll time from systemd');
  }

  const newest = d.newestReview
    ? new Date(d.newestReview).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short' })
    : 'none';
  lines.push(`Reviews: ${d.reviewTotal} total · ${d.unreplied} awaiting reply · newest ${newest}`);

  // The feedback job runs daily; a newest review older than a month means it
  // stopped writing even if it kept exiting 0. A quiet shop can legitimately go
  // two or three weeks between reviews, so a tighter threshold would cry wolf.
  if (d.newestReview && Date.now() - d.newestReview > 30 * 86400000) {
    warnings.push(`no new review stored for ${Math.round((Date.now() - d.newestReview) / 86400000)} days`);
  }

  if (!dayComplete) {
    lines.push('_Day still in progress — the order-count check runs after 22:30 MYT._');
  }

  lines.push('');
  if (warnings.length) {
    lines.push(`⚠️ ${warnings.join('; ')}.`);
    lines.push(`Check: \`journalctl -u ${POLL_UNIT} -n 50\``);
  } else {
    lines.push(dayComplete ? '✅ normal day' : '✅ normal so far');
  }
  return lines.join('\n');
}

async function main() {
  let report;
  try {
    await database.connect();
    report = await collect();
  } catch (e) {
    // Report the reason rather than exiting silently; a dead heartbeat that says
    // nothing is indistinguishable from a healthy one.
    const msg = `📊 Heartbeat could not read the database: ${e.message}`;
    if (DRY_RUN) { console.log(msg); process.exit(0); }
    const sent = spawnSync(HERMES, ['send', '--to', TARGET, '--quiet'], { input: msg, timeout: 60000 });
    process.exit(sent.status === 0 ? 0 : 1);
  }

  const message = compose(report);
  if (DRY_RUN) {
    console.log(message);
    await database.disconnect().catch(() => {});
    process.exit(0);
  }

  const res = spawnSync(HERMES, ['send', '--to', TARGET, '--quiet'], { input: message, timeout: 60000 });
  if (res.status !== 0) {
    console.error(`heartbeat: hermes send failed (${res.status}): ${res.stderr || ''}`);
    await database.disconnect().catch(() => {});
    process.exit(1);
  }

  console.log(message);
  await database.disconnect().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error('heartbeat failed:', e.message);
  process.exit(1);
});
