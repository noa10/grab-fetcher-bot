// Repair the handful of backfilled rows whose subtotal was stored as the NET
// figure instead of gross, so item totals do not reconcile against subtotal.
//
// Root cause: those rows were written correctly on the first --apply pass, then
// a second pass re-read them and re-applied the export. The export reports
// "Total Nett Sales" for the subtotal on rows carrying a promo, so the second
// pass overwrote subtotal with the net value and zeroed the discount.
//
// The fix is idempotent: derive subtotal from the stored item totals when they
// disagree, and restore the discount from the export.
require('dotenv').config();
process.env.LOG_LEVEL = 'error';
const fs = require('fs');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const p = '/home/ubuntu/.hermes/cache/documents/doc_ddb373a816b2_merchant_order_details_v2_2026-09-28T05_38_26.179044Z.json';

(async () => {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const orders = raw.filter(r => r['Record Type'] === 'ORDER');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const Order = require('../src/models/Order');

  const all = await Order.find({ backfilledFrom: 'merchant-sales-export' });
  const broken = [];
  for (const o of all) {
    const items = o.orderDetails.items || [];
    if (!items.length) continue;
    const sum = items.reduce((a, i) => a + (i.total || 0), 0);
    if (Math.abs(sum - o.pricing.subtotal) > 0.05) broken.push({ o, sum });
  }

  console.log(`Backfilled rows where item-sum != subtotal: ${broken.length}`);
  for (const { o, sum } of broken) {
    const date = o.orderDate.toISOString().slice(0, 10);
    const exp = orders.find(r => String(r.Remarks || '').includes(o.orderNumber) && String(r.Date).slice(0, 10) === date);
    const disc = exp ? (parseFloat(exp['Total Discount']) || 0) : 0;
    const net = exp ? (parseFloat(exp['Total Nett Sales']) || 0) : o.pricing.total;
    console.log(`  ${o.orderNumber}|${date}  itemSum=${sum.toFixed(2)} subtotal=${o.pricing.subtotal} disc=${o.pricing.discount} -> subtotal=${sum.toFixed(2)} disc=${-disc} total=${net}`);
    if (APPLY) {
      o.pricing.subtotal = +sum.toFixed(2);
      o.pricing.discount = -disc;
      o.pricing.total = net;
      await o.save();
    }
  }
  console.log(APPLY ? `\nRepaired ${broken.length} rows.` : '\nDry run — pass --apply to repair.');

  // Re-verify.
  const after = await Order.find({ backfilledFrom: 'merchant-sales-export' });
  let stillBad = 0;
  for (const o of after) {
    const items = o.orderDetails.items || [];
    if (!items.length) continue;
    const sum = items.reduce((a, i) => a + (i.total || 0), 0);
    if (Math.abs(sum - o.pricing.subtotal) > 0.05) stillBad++;
  }
  console.log(`After repair, item-sum != subtotal: ${stillBad}`);
  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
