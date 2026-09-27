// State-sync and dedup tests. These exercise the real GrabOrderFetcher /
// GitHubActionsRunner methods against a live MongoDB when one is reachable.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'error';

const assert = require('assert');
const mongoose = require('mongoose');

const name = 'state sync (no fabricated orders)';

// Deliberately NOT falling back to process.env.MONGODB_URI: this suite calls
// dropDatabase(), so pointing it at a developer's real Atlas cluster would wipe
// production data. Always require TEST_MONGODB_URI, or use a local scratch db.
const MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/grab_fetcher_test';

let Order;
let Fetcher;

// Exposed to the harness: returns false when MongoDB is unreachable so the whole
// suite reports as skipped instead of failing every test.
async function available() {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    Order = require('../src/models/Order');
    Fetcher = require('../src/index');
    await mongoose.connection.db.dropDatabase();
    await Order.syncIndexes();
    return true;
  } catch (e) {
    try { await mongoose.disconnect(); } catch (e2) {}
    return false;
  }
}

async function disconnect() {
  await mongoose.disconnect();
}

const baseOrder = (overrides = {}) => ({
  orderNumber: 'ORD-1',
  longOrderId: 'LONG-1',
  customerName: 'Siti',
  driverName: 'Ali',
  driverStatus: 'Arriving',
  status: 'delivered',
  orderTimestamp: new Date('2026-09-27T01:15:00Z'), // = 09:15 MYT
  orderDetails: { restaurantName: 'Grab Order', orderType: 'delivery', items: [], specialInstructions: '' },
  pricing: { subtotal: 12, total: 12, currency: 'MYR' },
  ...overrides,
});

// A fetcher whose extractor returns fixed state updates, with no browser involved.
function fetcherWith(stateUpdates) {
  const fetcher = new Fetcher();
  const page = { marker: 'page' };
  fetcher.bot = { getPage: () => page };
  fetcher.extractor = {
    page,
    extractOrdersForStateUpdate: async () => stateUpdates,
    extractOrders: async () => [],
  };
  fetcher.screenshotService = { isScreenshotEnabled: () => false };
  return fetcher;
}

async function seed(order) {
  const doc = new Order(order);
  if (!doc.orderDate) doc.orderDate = Order.toOrderDate(doc.orderTimestamp);
  await doc.save();
  return doc;
}

// Each test uses a distinct order number: they share one database, and the
// unique (orderNumber, orderDate) index would otherwise reject a re-seed.
let seq = 0;
const uniq = () => `ORD-${Date.now()}-${++seq}`;

async function freshOrder(overrides = {}) {
  const orderNumber = uniq();
  const doc = await seed(baseOrder({ orderNumber, ...overrides }));
  return { doc, orderNumber };
}

const tests = [
  {
    name: 'updates a matching historical order instead of inserting a stub',
    fn: async () => {
      // The real order lives on 2026-09-27 (parsed from a 09:15 MYT timestamp).
      await seed(baseOrder());

      const fetcher = fetcherWith([{
        orderNumber: 'ORD-1',
        longOrderId: 'LONG-1',
        status: 'completed',
        driverStatus: 'Delivered',
        orderTimestamp: new Date('2026-09-27T01:15:00Z'),
      }]);

      const result = await fetcher.syncOrderStates();
      assert.strictEqual(result.updatedCount, 1, 'should update the existing order');
      assert.strictEqual(result.registeredCount, 0, 'must NOT register a new stub');

      const docs = await Order.find({ orderNumber: 'ORD-1' });
      assert.strictEqual(docs.length, 1, 'exactly one document must exist');
      assert.strictEqual(docs[0].status, 'completed');
      assert.strictEqual(docs[0].driverStatus, 'Delivered');
      assert.strictEqual(docs[0].customerName, 'Siti', 'must not overwrite real customer data');
      assert.strictEqual(docs[0].pricing.total, 12, 'must not zero out the real total');
    },
  },
  {
    name: 'updates a YESTERDAY order on its own date, not today',
    fn: async () => {
      // This is the exact bug: keyed on toOrderDate(new Date()), this row missed the
      // lookup and a zero-value stub was inserted under today's date.
      const yesterday = new Date('2026-09-26T03:00:00Z');
      await seed(baseOrder({
        orderNumber: 'ORD-YDAY',
        orderTimestamp: yesterday,
        status: 'delivered',
        driverStatus: 'Arriving',
      }));

      const fetcher = fetcherWith([{
        orderNumber: 'ORD-YDAY',
        longOrderId: 'LONG-1',
        status: 'completed',
        driverStatus: 'Delivered',
        orderTimestamp: yesterday,
      }]);

      const result = await fetcher.syncOrderStates();
      assert.strictEqual(result.updatedCount, 1, 'the existing order should be updated');
      assert.strictEqual(result.registeredCount, 0, 'no stub should be created');

      const docs = await Order.find({ orderNumber: 'ORD-YDAY' });
      assert.strictEqual(docs.length, 1, 'still exactly one document');
      assert.strictEqual(docs[0].orderDate.toISOString(), '2026-09-26T00:00:00.000Z',
        'orderDate must come from the order timestamp, not today');
      assert.strictEqual(docs[0].status, 'completed');
      assert.strictEqual(docs[0].customerName, 'Siti', 'real data must be preserved');
      assert.strictEqual(docs[0].pricing.total, 12, 'real total must be preserved');
    },
  },
  {
    name: 'skips rows with no usable timestamp rather than fabricating a stub',
    fn: async () => {
      const fetcher = fetcherWith([
        { orderNumber: 'ORD-NO-DATE', longOrderId: 'L', status: 'completed', driverStatus: 'Delivered', orderTimestamp: null },
        { orderNumber: 'ORD-BAD-DATE', longOrderId: 'L', status: 'completed', driverStatus: 'Delivered', orderTimestamp: new Date('nonsense') },
      ]);

      const result = await fetcher.syncOrderStates();
      assert.strictEqual(result.registeredCount, 0, 'must not insert anything');
      assert.strictEqual(result.updatedCount, 0);
      assert.strictEqual(result.skippedUnknownDate, 2, 'both rows should be skipped');
      const docs = await Order.find({ orderNumber: { $in: ['ORD-NO-DATE', 'ORD-BAD-DATE'] } });
      assert.strictEqual(docs.length, 0, 'no documents should exist for skipped rows');
    },
  },
  {
    name: 'registers a genuinely new order on its own date',
    fn: async () => {
      const ts = new Date('2026-09-25T03:30:00Z');
      const fetcher = fetcherWith([
        { orderNumber: 'ORD-BRAND-NEW', longOrderId: 'LONG-N', status: 'completed', driverStatus: 'Delivered', orderTimestamp: ts },
      ]);

      const result = await fetcher.syncOrderStates();
      assert.strictEqual(result.registeredCount, 1);

      const doc = await Order.findOne({ orderNumber: 'ORD-BRAND-NEW' });
      assert.ok(doc, 'the new order should be registered');
      assert.strictEqual(doc.orderDate.toISOString(), '2026-09-25T00:00:00.000Z',
        'the order must be dated from its own timestamp, not today');
      assert.strictEqual(doc.orderTimestamp.toISOString(), ts.toISOString());

      // Re-running must update, not duplicate.
      const second = await fetcher.syncOrderStates();
      assert.strictEqual(second.registeredCount, 0, 'second pass must not re-register');
      assert.strictEqual(second.updatedCount, 0, 'no changes on the second pass');
      assert.strictEqual(await Order.countDocuments({ orderNumber: 'ORD-BRAND-NEW' }), 1);
    },
  },
  {
    name: 'processOrder updates only the order on the matching date',
    fn: async () => {
      // Two documents share an order number on different dates, as Grab does.
      const { orderNumber } = await freshOrder({ orderTimestamp: new Date('2026-09-27T01:15:00Z') });
      await seed(baseOrder({
        orderNumber,
        orderTimestamp: new Date('2026-09-20T01:15:00Z'),
        status: 'completed',
        customerName: 'Old Customer',
      }));

      const fetcher = fetcherWith([]);
      // Same order number and same date as the 27 Sep order, with a changed status.
      await fetcher.processOrder(baseOrder({
        orderNumber,
        status: 'completed',
        driverStatus: 'Delivered',
        customerName: 'Siti',
      }));

      const docs = await Order.find({ orderNumber }).sort({ orderDate: 1 });
      assert.strictEqual(docs.length, 2, 'both dated orders still exist');
      assert.strictEqual(docs[0].orderDate.toISOString(), '2026-09-20T00:00:00.000Z');
      assert.strictEqual(docs[0].status, 'completed', 'the 20 Sep order must be untouched');
      assert.strictEqual(docs[0].customerName, 'Old Customer');
      assert.strictEqual(docs[1].orderDate.toISOString(), '2026-09-27T00:00:00.000Z');
      assert.strictEqual(docs[1].status, 'completed', 'the 27 Sep order is updated');
      assert.strictEqual(docs[1].driverStatus, 'Delivered');
    },
  },
  {
    name: 'an unchanged order is not rewritten',
    fn: async () => {
      const { doc, orderNumber } = await freshOrder();

      const fetcher = fetcherWith([]);
      // A re-poll producing identical values must not touch lastUpdated.
      await new Promise(r => setTimeout(r, 20));
      await fetcher.processOrder(baseOrder({ orderNumber }));

      const after = await Order.findById(doc._id);
      assert.strictEqual(after.lastUpdated.getTime(), doc.lastUpdated.getTime(),
        'lastUpdated should not change when nothing changed');
    },
  },
  {
    name: 'a changed field does get persisted',
    fn: async () => {
      const { doc, orderNumber } = await freshOrder();

      const fetcher = fetcherWith([]);
      await new Promise(r => setTimeout(r, 20));
      await fetcher.processOrder(baseOrder({ orderNumber, driverStatus: 'Arriving now' }));

      const after = await Order.findById(doc._id);
      assert.strictEqual(after.driverStatus, 'Arriving now');
      assert.ok(after.lastUpdated.getTime() > doc.lastUpdated.getTime(), 'lastUpdated should advance');
    },
  },
  {
    name: 'item discount and modifiers survive a save',
    fn: async () => {
      const { doc } = await freshOrder({
        orderDetails: {
          restaurantName: 'Grab Order',
          orderType: 'delivery',
          specialInstructions: '',
          items: [{
            name: 'Nasi Lemak',
            quantity: 2,
            price: 8,
            total: 16,
            discount: '-RM2',
            modifiers: [{ name: 'Spicy', value: 'Yes' }, { name: 'Sambal', value: 'Extra' }],
          }],
        },
      });

      const reloaded = await Order.findById(doc._id);
      const item = reloaded.orderDetails.items[0];
      assert.strictEqual(item.discount, '-RM2', 'per-item discount must persist');
      assert.ok(Array.isArray(item.modifiers), 'modifiers must persist as an array');
      assert.strictEqual(item.modifiers.length, 2);
      assert.strictEqual(item.modifiers[0].name, 'Spicy');
      assert.strictEqual(item.modifiers[1].value, 'Extra');
    },
  },
  {
    name: 'cleanup',
    fn: async () => {
      await disconnect();
    },
  },
];

module.exports = { name, tests, available };
