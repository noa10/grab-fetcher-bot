// Read-only inspection of stored orders. Safe against production: it only
// find()s, never writes, and never drops a database.
//
//   node scripts/inspect-orders.js            # uses .env MONGODB_URI
//   LIMIT=20 node scripts/inspect-orders.js   # show more rows
//
// Deliberately separate from tests/: the test suites may DROP a database, so
// they must never be pointed at a real cluster.
require('dotenv').config();
process.env.LOG_LEVEL = 'error';

const mongoose = require('mongoose');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Host      : ${mongoose.connection.host}`);
  console.log(`Database  : ${mongoose.connection.name}`);

  const Order = require('../src/models/Order');
  const limit = parseInt(process.env.LIMIT) || 10;
  const total = await Order.countDocuments();
  console.log(`Orders    : ${total}\n`);

  const rows = await Order.find({}).sort({ fetchedAt: -1 }).limit(limit);
  for (const o of rows) {
    const items = o.orderDetails.items || [];
    console.log(`--- ${o.orderNumber}`);
    console.log(`    orderTimestamp : ${o.orderTimestamp.toISOString()}`);
    console.log(`    MYT wall clock : ${o.orderTimestamp.toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}`);
    console.log(`    orderDate      : ${o.orderDate.toISOString().slice(0, 10)}`);
    console.log(`    status         : ${o.status}  driver: ${o.driverName} (${o.driverStatus})`);
    console.log(`    customer       : ${o.customerName}${o.customerPhone ? '  ' + o.customerPhone : ''}`);
    console.log(`    note           : ${o.customerNote || '-'}`);
    console.log(`    pricing        : subtotal=${o.pricing.subtotal} discount=${o.pricing.discount} total=${o.pricing.total} ${o.pricing.currency}`);
    console.log(`    items          : ${items.length}`);
    for (const it of items) {
      const mods = (it.modifiers || []).map(m => `${m.name}:${m.value}`).join(' | ');
      console.log(`        - ${it.name} x${it.quantity} @${it.price} = ${it.total}${mods ? `\n            mods: ${mods}` : ''}`);
    }
    console.log(`    fetched        : ${o.fetchedAt.toISOString()}`);
    console.log('');
  }

  // Health signals worth watching.
  const stubs = await Order.countDocuments({ 'pricing.total': 0, customerName: 'Customer' });
  const mods = await Order.countDocuments({ 'orderDetails.items.modifiers.0': { $exists: true } });
  const errors = await Order.countDocuments({ hasErrors: true });
  console.log(`zero-value "Customer" stub rows : ${stubs}`);
  console.log(`rows with item modifiers        : ${mods}`);
  console.log(`rows flagged hasErrors         : ${errors}`);

  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
