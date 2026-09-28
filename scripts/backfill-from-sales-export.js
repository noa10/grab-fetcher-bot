/**
 * Backfill zero-value order rows from a merchant POS sales export.
 *
 * The bot's pre-2026-09 state sync created rows with no items and a zero total
 * whenever a history row's date could not be resolved. Those rows have no
 * recoverable data in Mongo — but the merchant's own sales export does contain
 * the real line items, pricing and timestamp for every order, keyed by
 * (order number, date).
 *
 * This script fills in pricing, items and modifiers for existing rows only. It
 * never inserts new orders and never deletes anything.
 *
 * Usage:
 *   node scripts/backfill-from-sales-export.js <export.json> [--apply]
 *
 * Default is a dry run: it reports what it would change and writes nothing.
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'error';

const fs = require('fs');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Usage: node scripts/backfill-from-sales-export.js <export.json> [--apply]');
  process.exit(1);
}

/** Pull every GF-xxxx order number out of an ORDER row's Remarks text. */
function orderNumbersFrom(remarks) {
  return [...new Set((String(remarks || '').match(/GF-[A-Z0-9]+/g) || []))];
}

/**
 * "2x Set Krapow Daging | 33.2 | Pedas 🌶️, 135g - Default, ..."
 *   -> { name, quantity, price, total, modifiers[] }
 *
 * The second field is the LINE TOTAL, not the unit price. Verified against the
 * export: for every order, sum(line total) == "Total Gross Sales". Dividing it
 * by the quantity gives the unit price, which is what the Order schema stores
 * (the live scraper extracts per-unit prices, so the two must agree).
 */
function parseItem(raw) {
  const parts = String(raw || '').split('|').map(s => s.trim());
  const qtyMatch = parts[0] && parts[0].match(/^(\d+)\s*x\s*(.+)$/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const name = (qtyMatch ? qtyMatch[2] : parts[0] || 'Item').trim();
  const lineTotal = parseFloat(parts[1]) || 0;
  const price = +(lineTotal / quantity).toFixed(2);

  // The third field is a comma-separated modifier list. Name the value when the
  // text looks like "Label:Value", otherwise treat it as a standalone modifier.
  const modifiers = String(parts[2] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const kv = s.match(/^([^:]+):\s*(.+)$/);
      return kv ? { name: kv[1].trim(), value: kv[2].trim() } : { name: 'note', value: s };
    });

  return { name, quantity, price, total: +(quantity * price).toFixed(2), modifiers };
}

/** Combine the MYT date + time from the export into a real UTC instant. */
function toUtcInstant(dateStr, timeStr) {
  const d = String(dateStr || '').slice(0, 10);
  const t = String(timeStr || '00:00').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  // MYT is UTC+8 with no DST, so subtract a fixed 8 hours.
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h - 8, mi));
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const orderRows = raw.filter(r => r.get === undefined && r['Record Type'] === 'ORDER');
  const itemRows = raw.filter(r => r['Record Type'] === 'ITEM');

  if (!orderRows.length) {
    console.error('No ORDER rows found. Is this a merchant sales export?');
    process.exit(1);
  }

  // Index items by order_group, which is unique per ORDER row in this export.
  const itemsByGroup = new Map();
  for (const r of itemRows) {
    const g = r.order_group;
    if (!itemsByGroup.has(g)) itemsByGroup.set(g, []);
    itemsByGroup.get(g).push(parseItem(r.Items));
  }

  // Index by "orderNumber|date" — the same compound identity the bot uses.
  const index = new Map();
  let skippedNoNumber = 0;
  for (const r of orderRows) {
    const date = String(r.Date || '').slice(0, 10);
    const ts = toUtcInstant(r.Date, r.Time);
    if (!ts) { skippedNoNumber++; continue; }
    const items = itemsByGroup.get(r.order_group) || [];
    const gross = parseFloat(r['Total Gross Sales']) || 0;
    const discount = parseFloat(r['Total Discount']) || 0;
    const net = parseFloat(r['Total Nett Sales']) || 0;
    const numbers = orderNumbersFrom(r.Remarks);
    // Cancelled/refunded rows carry a negative total and usually no order
    // number. They are not real revenue, so never index them.
    if (gross < 0 || /cancel|refund/i.test(String(r['Invoice No'] || ''))) continue;
    for (const num of numbers) {
      index.set(`${num}|${date}`, {
        orderNumber: num,
        date,
        timestamp: ts,
        items,
        pricing: {
          subtotal: gross,
          discount: -discount,
          total: net,
          currency: 'MYR',
        },
        invoiceNo: r['Invoice No'] || null,
        pax: r['No of Pax'] || null,
        serviceCharge: parseFloat(r['Total Service Charge']) || 0,
        sst: parseFloat(r['Total SST']) || 0,
        rounding: parseFloat(r['Rounding']) || 0,
      });
    }
  }
  // Self-check before touching anything. The line-total/unit-price mistake this
  // script once made doubled every total, and the export agreed with itself, so
  // nothing downstream would have complained. Assert the invariant explicitly.
  //
  // Cancelled/refunded orders are legitimately inconsistent: they carry a
  // negative gross, no line items and no GF order number, so they can never
  // match a row in Mongo and are excluded.
  let sumMismatch = 0;
  let cancelled = 0;
  for (const r of orderRows) {
    const gross = parseFloat(r['Total Gross Sales']) || 0;
    const numbers = orderNumbersFrom(r.Remarks);
    if (gross < 0 || /cancel|refund/i.test(String(r['Invoice No'] || ''))) {
      if (!numbers.length) { cancelled++; continue; }
    }
    const list = itemsByGroup.get(r.order_group) || [];
    const sum = list.reduce((a, it) => a + it.total, 0);
    if (Math.abs(sum - gross) > 0.05) sumMismatch++;
  }
  console.log(`\nSelf-check: item totals vs gross sales — ${orderRows.length - sumMismatch - cancelled}/${orderRows.length - cancelled} orders consistent (${cancelled} cancelled/refunded, excluded)`);
  if (sumMismatch > 0) {
    console.error(`  ${sumMismatch} orders disagree. Refusing to run — the item parser is wrong.`);
    process.exit(1);
  }

  console.log(`Export: ${orderRows.length} ORDER rows, ${itemRows.length} ITEM rows`);
  console.log(`Index built: ${index.size} orderNumber|date keys` + (skippedNoNumber ? ` (${skippedNoNumber} rows skipped for a bad date)` : ''));
  if (!APPLY) console.log('\nDRY RUN — pass --apply to write.\n');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const Order = require('../src/models/Order');

  const zeros = await Order.find({ 'pricing.total': 0 });
  console.log(`Zero-value rows in Mongo: ${zeros.length}`);

  let matched = 0, unmatched = 0, updated = 0, itemTotal = 0;
  const unmatchedList = [];

  for (const o of zeros) {
    const date = o.orderDate.toISOString().slice(0, 10);
    const hit = index.get(`${o.orderNumber}|${date}`);
    if (!hit) { unmatched++; unmatchedList.push(`${o.orderNumber}|${date}`); continue; }
    matched++;
    itemTotal += hit.items.length;
    if (APPLY) {
      o.pricing = hit.pricing;
      o.orderDetails = { items: hit.items, notes: '', paymentMethod: 'PAY_AT_COUNTER' };
      o.orderTimestamp = hit.timestamp;
      o.pax = hit.pax;
      o.invoiceNo = hit.invoiceNo;
      o.customerName = o.customerName === 'Customer' ? 'Customer' : o.customerName;
      o.backfilledFrom = 'merchant-sales-export';
      o.backfilledAt = new Date();
      await o.save();
      updated++;
    }
  }

  console.log(`\nMatched in export : ${matched}`);
  console.log(`No export match   : ${unmatched}`);
  console.log(`Items recoverable : ${itemTotal}`);
  if (APPLY) console.log(`Rows updated      : ${updated}`);
  else console.log(`\nWould update ${matched} rows. Nothing was written.`);

  if (unmatched) {
    console.log(`\nUnmatched (${unmatched}) — no data in this export:`);
    const byDate = {};
    for (const k of unmatchedList) { const d = k.split('|')[1]; byDate[d] = (byDate[d] || 0) + 1; }
    for (const d of Object.keys(byDate).sort()) console.log(`   ${d}: ${byDate[d]}`);
  }

  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
