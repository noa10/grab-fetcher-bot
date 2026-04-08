#!/usr/bin/env node
/**
 * Migration: Add orderDate field to existing orders
 * Sets orderDate to the date portion (midnight UTC) of each order's orderTimestamp.
 * Required because the new compound unique index (orderNumber + orderDate) needs orderDate populated.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const database = require('../src/config/database');

async function migrate() {
  await database.connect();
  const db = mongoose.connection.db;
  const collection = db.collection('orders');

  // Count orders missing orderDate
  const missing = await collection.countDocuments({ orderDate: { $exists: false } });
  console.log(`Orders missing orderDate: ${missing}`);

  if (missing === 0) {
    console.log('No migration needed.');
    process.exit(0);
  }

  // Set orderDate from orderTimestamp for all orders missing it
  const result = await collection.updateMany(
    { orderDate: { $exists: false } },
    [
      {
        $set: {
          orderDate: {
            $dateFromParts: {
              year: { $year: '$orderTimestamp' },
              month: { $month: '$orderTimestamp' },
              day: { $dayOfMonth: '$orderTimestamp' },
              hour: 0, minute: 0, second: 0, millisecond: 0,
              timezone: 'UTC'
            }
          }
        }
      }
    ]
  );

  console.log(`Migration complete: ${result.modifiedCount} orders updated.`);

  // Verify
  const stillMissing = await collection.countDocuments({ orderDate: { $exists: false } });
  console.log(`Orders still missing orderDate: ${stillMissing}`);

  // Show sample
  const sample = await collection.find({}, { projection: { orderNumber: 1, orderDate: 1, orderTimestamp: 1 } }).sort({ createdAt: -1 }).limit(3).toArray();
  console.log('Sample orders after migration:');
  sample.forEach(o => console.log(`  ${o.orderNumber}: orderDate=${o.orderDate}, orderTimestamp=${o.orderTimestamp}`));

  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
