process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'error';

const assert = require('assert');
const mongoose = require('mongoose');

const name = 'Order model';

// This suite inserts and deletes documents, so it must never inherit a real
// MONGODB_URI. Only an explicit TEST_MONGODB_URI is honoured. For read-only
// inspection of production data use scripts like inspect-stored.js instead.
const MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/grab_fetcher_test';

let Order;
let connected = false;

// Exposed to the harness: when MongoDB is unreachable the whole suite is
// reported as skipped rather than failing every test.
async function available() {
  if (connected) return true;
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    Order = require('../src/models/Order');
    await Order.syncIndexes();
    connected = true;
    return true;
  } catch (e) {
    return false;
  }
}

const minimal = (overrides = {}) => ({
  orderNumber: 'M-1',
  orderDate: new Date('2026-09-27T00:00:00Z'),
  customerName: 'Test',
  orderTimestamp: new Date('2026-09-27T01:15:00Z'),
  orderDetails: { items: [] },
  pricing: { subtotal: 1, total: 1 },
  status: 'completed',
  ...overrides,
});

const tests = [
  {
    name: 'toOrderDate normalises to midnight UTC',
    fn: async () => {
      await available();
      const d = Order.toOrderDate(new Date('2026-09-27T13:45:12.345Z'));
      assert.strictEqual(d.toISOString(), '2026-09-27T00:00:00.000Z');
    },
  },
  {
    name: 'rejects a negative pricing total (min: 0 guard holds)',
    fn: async () => {
      await available();
      const bad = new Order(minimal({ orderNumber: 'NEG-1', pricing: { subtotal: 0, total: -3.5 } }));
      let threw = null;
      try { await bad.save(); } catch (e) { threw = e; }
      assert.ok(threw, 'a negative total must be rejected');
      assert.ok(/less than minimum/i.test(threw.message), threw.message);
    },
  },
  {
    name: 'rejects an unknown status value',
    fn: async () => {
      await available();
      const bad = new Order(minimal({ orderNumber: 'BAD-STATUS', status: 'teleported' }));
      let threw = null;
      try { await bad.save(); } catch (e) { threw = e; }
      assert.ok(threw, 'status is an enum and must be validated');
    },
  },
  {
    name: 'enforces the unique (orderNumber, orderDate) index',
    fn: async () => {
      await available();
      await Order.deleteMany({ orderNumber: 'UNIQ-1' });
      const date = new Date('2026-09-27T00:00:00Z');
      await new Order(minimal({ orderNumber: 'UNIQ-1', orderDate: date })).save();
      let threw = null;
      try {
        await new Order(minimal({ orderNumber: 'UNIQ-1', orderDate: date })).save();
      } catch (e) { threw = e; }
      assert.ok(threw, 'a duplicate (orderNumber, orderDate) must be rejected');
    },
  },
  {
    name: 'allows the same orderNumber on a different date',
    fn: async () => {
      await available();
      await Order.deleteMany({ orderNumber: 'MULTI-1' });
      await new Order(minimal({ orderNumber: 'MULTI-1', orderDate: new Date('2026-09-27T00:00:00Z') })).save();
      await new Order(minimal({ orderNumber: 'MULTI-1', orderDate: new Date('2026-09-20T00:00:00Z') })).save();
      assert.strictEqual(await Order.countDocuments({ orderNumber: 'MULTI-1' }), 2);
    },
  },
  {
    name: 'findByOrderNumberAndDate discriminates the two dates',
    fn: async () => {
      await available();
      await Order.deleteMany({ orderNumber: 'FIND-1' });
      const t27 = new Date('2026-09-27T01:15:00Z');
      const t20 = new Date('2026-09-20T01:15:00Z');
      await new Order(minimal({ orderNumber: 'FIND-1', orderDate: Order.toOrderDate(t27), orderTimestamp: t27, customerName: 'TwentySeventh' })).save();
      await new Order(minimal({ orderNumber: 'FIND-1', orderDate: Order.toOrderDate(t20), orderTimestamp: t20, customerName: 'Twentieth' })).save();

      const found27 = await Order.findByOrderNumberAndDate('FIND-1', t27);
      const found20 = await Order.findByOrderNumberAndDate('FIND-1', t20);
      assert.strictEqual(found27.customerName, 'TwentySeventh');
      assert.strictEqual(found20.customerName, 'Twentieth');
    },
  },
  {
    name: 'toExportFormat includes the fields the CSV export needs',
    fn: async () => {
      await available();
      const o = new Order(minimal({ orderNumber: 'EXP-1' }));
      const fmt = o.toExportFormat();
      for (const key of ['orderNumber', 'customerName', 'driverName', 'status', 'total', 'currency', 'orderTimestamp']) {
        assert.ok(key in fmt, `missing export field: ${key}`);
      }
    },
  },
  {
    name: 'cleanup',
    fn: async () => {
      if (connected) { await mongoose.disconnect(); connected = false; }
    },
  },
];

module.exports = { name, tests, available };
