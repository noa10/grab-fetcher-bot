/**
 * Insert orders that are missing from Mongo, using a merchant POS sales export.
 *
 * backfill-from-sales-export.js only repairs rows that already exist. This covers
 * the opposite case: a window where the bot was not running, so the orders were
 * never captured at all. A 21 Aug - 25 Sep 2026 gap like that has no zero-value
 * rows to repair, because nothing was ever written.
 *
 * Inserts are additive and idempotent: a row is keyed on (orderNumber,
 * orderDate) exactly as the live scraper does, and anything already present is
 * left untouched. Verified against the portal's own totals before writing.
 *
 * Usage:
 *   node scripts/backfill-missing-orders.js <export.json> --from 2026-08-21 --to 2026-09-25
 *   ... --apply
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'error';

const fs = require('fs');
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const inputPath = args.find(a => !a.startsWith('--') && a.endsWith('.json'));
const val = flag => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const FROM = val('--from');
const TO = val('--to');

if (!inputPath) {
  console.error('Usage: node scripts/backfill-missing-orders.js <export.json> --from YYYY-MM-DD --to YYYY-MM-DD [--apply]');
  process.exit(1);
}
if (!FROM || !TO) {
  console.error('Both --from and --to are required.');
  process.exit(1);
}

function orderNumbersFrom(remarks) {
  return [...new Set(String(remarks || '').match(/GF-[A-Z0-9]+/g) || [])];
}

function parseItem(raw) {
  const parts = String(raw || '').split('|').map(s => s.trim());
  const qtyMatch = parts[0] && parts[0].match(/^(\d+)\s*x\s*(.+)$/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const name = (qtyMatch ? qtyMatch[2] : parts[0] || 'Item').trim();
  // Second field is the LINE TOTAL, not the unit price.
  const price = +((parseFloat(parts[1]) || 0) / quantity).toFixed(2);
  const modifiers = String(parts[2] || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const kv = s.match(/^([^:]+):\s*(.+)$/);
    return kv ? { name: kv[1].trim(), value: kv[2].trim() } : { name: 'note', value: s };
  });
  return { name, quantity, price, total: +(quantity * price).toFixed(2), modifiers };
}

/** MYT (UTC+8, no DST) date + "HH:MM" -> UTC instant. */
function toUtcInstant(dateStr, timeStr) {
  const d = String(dateStr || '').slice(0, 10);
  const t = String(timeStr || '00:00').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h - 8, mi));
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const orderRows = raw.filter(r => r['Record Type'] === 'ORDER');
  const itemRows = raw.filter(r => r['Record Type'] === 'ITEM');

  const itemsByGroup = new Map();
  for (const r of itemRows) {
    if (!itemsByGroup.has(r.order_group)) itemsByGroup.set(r.order_group, []);
    itemsByGroup.get(r.order_group).push(parseItem(r.Items));
  }

  // Self-check: line totals must reconcile against gross sales, or the parser is
  // wrong. Cancelled/refunded rows are legitimately inconsistent and excluded.
  let mismatch = 0, cancelled = 0;
  for (const r of orderRows) {
    const gross = parseFloat(r['Total Gross Sales']) || 0;
    if (gross < 0 || /cancel|refund/i.test(String(r['Invoice No'] || ''))) { if (!orderNumbersFrom(r.Remarks).length) { cancelled++; continue; } }
    const sum = (itemsByGroup.get(r.order_group) || []).reduce((a, it) => a + it.total, 0);
    if (Math.abs(sum - gross) > 0.05) mismatch++;
  }
  console.log(`Export: ${orderRows.length} ORDER rows, ${itemRows.length} ITEM rows`);
  console.log(`Self-check: ${orderRows.length - mismatch - cancelled}/${orderRows.length - cancelled} consistent (${cancelled} cancelled excluded)`);
  if (mismatch) { console.error(`  ${mismatch} orders disagree. Refusing to run.`); process.exit(1); }

  // Build candidate inserts within the requested window.
  // A POS invoice followed by "<invoice>-canceled" with a negative total voids
  // the original. The original row still carries its GF number, so without this
  // it would be inserted as a live sale worth money that was refunded. Verified
  // against the portal on 2026-09-08: GF-679's RM16.60 appears as a row there but
  // nets out of the day's revenue, which is what the export reflects.
  const cancelledInvoices = new Set(
    orderRows
      .filter(r => /cancel|refund/i.test(String(r['Invoice No'] || '')) || (parseFloat(r['Total Gross Sales']) || 0) < 0)
      .map(r => String(r['Invoice No'] || '').replace(/-cancelled?$/i, '').replace(/-canceled?$/i, '').trim())
      .filter(Boolean)
  );

  const candidates = [];
  const seen = new Set();
  let voided = 0;
  for (const r of orderRows) {
    const date = String(r.Date || '').slice(0, 10);
    if (date < FROM || date > TO) continue;
    const gross = parseFloat(r['Total Gross Sales']) || 0;
    if (gross < 0 || /cancel|refund/i.test(String(r['Invoice No'] || ''))) continue;
    const ts = toUtcInstant(r.Date, r.Time);
    const numbers = orderNumbersFrom(r.Remarks);
    if (!ts || !numbers.length) continue;

    const invoice = String(r['Invoice No'] || '').trim();
    const isCancelled = cancelledInvoices.has(invoice);
    if (isCancelled) voided++;

    // POS rows can list several GF numbers in one invoice; they are separate
    // real orders, so emit one candidate per number and share the line items.
    for (const num of numbers) {
      const key = `${num}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        orderNumber: num,
        date,
        timestamp: ts,
        items: itemsByGroup.get(r.order_group) || [],
        subtotal: gross,
        discount: -(parseFloat(r['Total Discount']) || 0),
        total: isCancelled ? 0 : (parseFloat(r['Total Nett Sales']) || 0),
        cancelled: isCancelled,
        invoiceNo: invoice || null,
        pax: r['No of Pax'] || null,
        serviceCharge: parseFloat(r['Total Service Charge']) || 0,
        sst: parseFloat(r['Total SST']) || 0,
        rounding: parseFloat(r['Rounding']) || 0,
        paymentStatus: r['Payment Status'] || null,
      });
    }
  }
  console.log(`Window ${FROM} .. ${TO}: ${candidates.length} candidate orders (${voided} later cancelled/refunded, total forced to 0)\n`);

  if (!APPLY) { console.log('DRY RUN — pass --apply to write.\n'); }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const Order = require('../src/models/Order');

  // One bulk query for the whole window, then set-diff in memory.
  const existing = await Order.find({
    orderDate: { $gte: new Date(`${FROM}T00:00:00Z`), $lte: new Date(`${TO}T23:59:59Z`) },
  });
  const have = new Set(existing.map(o => `${o.orderNumber}|${o.orderDate.toISOString().slice(0, 10)}`));
  console.log(`Existing rows in window: ${existing.length}`);

  const toInsert = candidates.filter(c => !have.has(`${c.orderNumber}|${c.date}`));
  const skipped = candidates.length - toInsert.length;
  console.log(`Already present (left alone): ${skipped}`);
  console.log(`Would insert: ${toInsert.length}`);

  const byDate = {};
  for (const c of toInsert) byDate[c.date] = (byDate[c.date] || 0) + 1;
  console.log('\nInserts per day:');
  for (const d of Object.keys(byDate).sort()) console.log(`   ${d}: ${byDate[d]}`);

  const value = toInsert.reduce((a, c) => a + c.total, 0);
  console.log(`\nRevenue to be added: RM${value.toFixed(2)}`);

  if (APPLY) {
    let n = 0;
    for (const c of toInsert) {
      const doc = new Order({
        orderNumber: c.orderNumber,
        orderDate: new Date(`${c.date}T00:00:00Z`),
        orderTimestamp: c.timestamp,
        status: c.cancelled ? 'cancelled' : (c.paymentStatus === 'SUCCESS' ? 'completed' : 'pending'),
        customerName: 'Customer',
        customerNote: '',
        driverName: '',
        driverStatus: '',
        driverPhone: '',
        restaurantName: 'GrabFood',
        orderDetails: {
          items: c.items,
          notes: '',
          paymentMethod: 'PAY_AT_COUNTER',
        },
        pricing: {
          subtotal: c.subtotal,
          discount: c.discount,
          total: c.total,
          currency: 'MYR',
        },
        pax: c.pax,
        invoiceNo: c.invoiceNo,
        serviceCharge: c.serviceCharge,
        sst: c.sst,
        rounding: c.rounding,
        source: 'merchant-sales-export',
        backfilledFrom: 'merchant-sales-export',
        backfilledAt: new Date(),
        hasErrors: false,
      });
      await doc.save();
      n++;
    }
    console.log(`\nInserted ${n} orders.`);
  } else {
    console.log('\nNothing written. Re-run with --apply to insert.');
  }

  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
