// Repair orderDate rows that were filed under the UTC day instead of the MYT day.
// orderTimestamp is always correct, so the fix is to re-derive orderDate from it.
// Guards against colliding with a row that already holds the correct key.
require('dotenv').config();
process.env.LOG_LEVEL = 'error';
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const Order = require('../src/models/Order');

  const mytDay = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

  const all = await Order.find({});
  const bad = [];
  for (const o of all) {
    if (mytDay(o.orderDate) !== mytDay(o.orderTimestamp)) {
      bad.push({ o, stored: mytDay(o.orderDate), correct: mytDay(o.orderTimestamp) });
    }
  }

  console.log(`Rows with a UTC-day orderDate: ${bad.length}\n`);

  let repaired = 0, skipped = 0;
  for (const { o, stored, correct } of bad) {
    const target = Order.toOrderDate(o.orderTimestamp);
    // Would the corrected key collide with an existing row?
    const clash = await Order.findOne({
      orderNumber: o.orderNumber,
      orderDate: target,
      _id: { $ne: o._id },
    });
    console.log(`${o.orderNumber}: stored ${stored} -> ${correct}  (${o.orderTimestamp.toISOString()})`);
    if (clash) {
      console.log(`   COLLIDES with an existing ${o.orderNumber} on ${correct} — leaving alone, needs a human look`);
      skipped++;
      continue;
    }
    if (APPLY) {
      o.orderDate = target;
      await o.save();
      repaired++;
    }
  }

  console.log(APPLY ? `\nRepaired ${repaired}, skipped ${skipped} for collision.`
                    : `\nWould repair ${bad.length - skipped}, skipped ${skipped} for collision. Pass --apply.`);

  if (APPLY) {
    let remaining = 0;
    for (const o of await Order.find({})) {
      if (mytDay(o.orderDate) !== mytDay(o.orderTimestamp)) remaining++;
    }
    console.log(`Rows still misfiled: ${remaining}`);
  }
  await mongoose.disconnect();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
