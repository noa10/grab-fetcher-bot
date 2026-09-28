// Correct the provenance stamps.
//
// The earlier stamp script selected "non-zero total, no backfilledFrom, fetched
// before 2026-08-21" and stamped 630 rows. That was too broad: many of those
// were correctly scraped from the portal long before the backfill, so labelling
// them "backfilled" misrepresents their provenance.
//
// The only rows the backfill actually wrote are the ones it repaired from
// zero-value to non-zero, plus the POS fields it set. Those are identified by
// having the export-only fields (invoiceNo/pax) present — no wait, the first run
// predates those schema fields too.
//
// Reliable discriminator: the backfill set orderTimestamp from the export's
// MYT date+time, which lands exactly on a 5-minute boundary. Portal-scraped
// timestamps include seconds/milliseconds of crawl time. That is checked here
// and reported for review rather than assumed.
require('dotenv').config();
process.env.LOG_LEVEL = 'error';
const mongoose = require('mongoose');

(async () => {
  const APPLY = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const Order = require('../src/models/Order');

  const stamped = await Order.find({ backfilledFrom: 'merchant-sales-export' });
  console.log(`Currently stamped as backfilled: ${stamped.length}`);

  // Export timestamps are minute-resolution (date + "HH:MM"), so seconds and
  // millis are zero. Portal-scraped ones carry real crawl time.
  const onMinute = o => o.orderTimestamp
    && o.orderTimestamp.getUTCSeconds() === 0
    && o.orderTimestamp.getUTCMilliseconds() === 0;

  const trueBackfills = stamped.filter(onMinute);
  const mislabelled = stamped.filter(o => !onMinute(o));

  console.log(`  look like a real backfill (exact minute, 0s 0ms): ${trueBackfills.length}`);
  console.log(`  NOT backfilled — stamped in error (has crawl seconds): ${mislabelled.length}`);

  // Confirm against the export: a true backfill must have a matching export row.
  const fs = require('fs');
  const p = process.argv[2];
  if (p) {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const keys = new Set();
    for (const r of raw.filter(x => x['Record Type'] === 'ORDER')) {
      const date = String(r.Date || '').slice(0, 10);
      for (const m of String(r.Remarks || '').match(/GF-[A-Z0-9]+/g) || []) keys.add(`${m}|${date}`);
    }
    const confirmed = trueBackfills.filter(o => keys.has(`${o.orderNumber}|${o.orderDate.toISOString().slice(0, 10)}`));
    const unconfirmed = trueBackfills.filter(o => !keys.has(`${o.orderNumber}|${o.orderDate.toISOString().slice(0, 10)}`));
    console.log(`\n  confirmed present in the export : ${confirmed.length}`);
    console.log(`  NOT in the export               : ${unconfirmed.length}`);
  }

  if (mislabelled.length) {
    console.log(`\nClearing the false stamp on ${mislabelled.length} rows (they were scraped, not backfilled).`);
    if (APPLY) {
      for (const o of mislabelled) { o.backfilledFrom = undefined; o.backfilledAt = undefined; await o.save(); }
      console.log('Cleared.');
    }
  } else if (!APPLY) {
    console.log('\nDry run — pass --apply to clear the false stamps.');
  }
  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
