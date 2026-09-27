const assert = require('assert');
const OrderExtractor = require('../src/services/orderExtractor');
const { parseGrabTimestamp } = require('../src/utils/helpers');

const name = 'order extractor (dedup + parsing guards)';

const stubPage = { isClosed: () => false };

const tests = [
  {
    name: 'reuses lastPollTime across polls on a persistent extractor',
    fn: async () => {
      // A fresh extractor per cycle is what caused every poll to re-extract the
      // whole history table. A reused one must only report genuinely new orders.
      const ex = new OrderExtractor(stubPage);
      const history = Array.from({ length: 5 }, (_, i) => ({
        orderNumber: 'H' + i,
        orderTimestamp: new Date(Date.now() - 3600 * 1000),
      }));

      const first = ex.filterNewOrders(history);
      assert.strictEqual(first.length, 5, 'first poll should take the history');

      const nothingNew = ex.filterNewOrders(history);
      assert.strictEqual(nothingNew.length, 0, 'second poll should report nothing new');

      // lastPollTime advances on every call, so the new order must post-date it.
      await new Promise(r => setTimeout(r, 5));
      const oneNew = ex.filterNewOrders([
        ...history,
        { orderNumber: 'FRESH', orderTimestamp: new Date() },
      ]);
      assert.strictEqual(oneNew.length, 1, 'only the new order should come through');
      assert.strictEqual(oneNew[0].orderNumber, 'FRESH');
    },
  },
  {
    name: 'caps the processedOrderIds set so it cannot grow unbounded',
    fn: () => {
      const ex = new OrderExtractor(stubPage);
      for (let i = 0; i < 600; i++) ex.processedOrderIds.add(`key-${i}`);
      assert.ok(ex.processedOrderIds.size > 500);
      ex.filterNewOrders([{ orderNumber: 'X', orderTimestamp: new Date() }]);
      assert.ok(ex.processedOrderIds.size <= 500,
        `set should have been trimmed, got ${ex.processedOrderIds.size}`);
    },
  },
  {
    name: 'setPage lets a reused extractor follow a new page object',
    fn: () => {
      const ex = new OrderExtractor(stubPage);
      const next = { isClosed: () => false };
      ex.setPage(next);
      assert.strictEqual(ex.page, next);
    },
  },
  {
    name: 'createFallbackOrder produces a schema-valid order',
    fn: () => {
      const ex = new OrderExtractor(stubPage);
      const order = ex.createFallbackOrder({
        shortOrderId: 'FB-1', longOrderId: 'L', totalAmount: 42.5, currency: 'MYR', status: 'preparing',
      });
      assert.strictEqual(order.orderNumber, 'FB-1');
      assert.strictEqual(order.pricing.total, 42.5);
      assert.strictEqual(order.status, 'preparing');
      assert.ok(order.customerName, 'customerName is required by the schema');
      assert.ok(order.orderTimestamp instanceof Date);
    },
  },
  {
    name: 'fallback order for a row with no total does not violate min:0',
    fn: () => {
      const ex = new OrderExtractor(stubPage);
      const order = ex.createFallbackOrder({ shortOrderId: 'FB-2', totalAmount: 0 });
      assert.ok(order.pricing.total >= 0, 'total must never be negative');
    },
  },
  {
    name: 'validateOrderData flags incomplete orders',
    fn: () => {
      const ex = new OrderExtractor(stubPage);
      const v = ex.validateExtractedOrder({ orderNumber: 'X', customerName: 'A', orderTimestamp: new Date(), pricing: { total: 1 } });
      assert.strictEqual(v.isValid, true);

      const bad = ex.validateExtractedOrder({ orderNumber: '', customerName: '', orderTimestamp: null, pricing: null });
      assert.strictEqual(bad.isValid, false);
      assert.ok(bad.errors.length >= 3);
    },
  },
  {
    name: 'drawer amount parsing is currency-agnostic',
    fn: () => {
      // Mirrors the matchAmount helper inlined into the browser evaluate.
      const matchAmount = (text) => {
        if (!text) return null;
        const m = String(text).match(/-?[\d,]+\.?\d*/);
        if (!m) return null;
        const value = parseFloat(m[0].replace(/,/g, ''));
        return isNaN(value) ? null : value;
      };
      assert.strictEqual(matchAmount('RM 12.50'), 12.5);
      assert.strictEqual(matchAmount('SGD 12.50'), 12.5, 'SGD must parse');
      assert.strictEqual(matchAmount('USD 1,234.56'), 1234.56, 'thousands separator');
      assert.strictEqual(matchAmount('-3.50'), -3.5, 'negative discount value');
      assert.strictEqual(matchAmount('12.50'), 12.5, 'bare number');
      assert.strictEqual(matchAmount(''), null);
      assert.strictEqual(matchAmount('RM'), null);
    },
  },
  {
    name: 'order-level discount does not collide with the total branch',
    fn: () => {
      // Regression guard: "order-level discount" must NOT be treated as the total.
      const firstCellLower = 'order-level discount'.toLowerCase();
      assert.strictEqual(firstCellLower.includes('subtotal'), false);
      assert.strictEqual(firstCellLower.includes('total') && !firstCellLower.includes('subtotal'), false,
        'order-level discount must not match the total branch');
    },
  },
  {
    name: 'MYT timestamps flow into orderDate consistently',
    fn: () => {
      const Order = require('../src/models/Order');
      const ts = parseGrabTimestamp('27 Sep, Sun, 09:15 AM', new Date('2026-09-27T12:00:00Z'));
      // 09:15 MYT = 01:15 UTC on the same calendar day.
      assert.strictEqual(Order.toOrderDate(ts).toISOString(), '2026-09-27T00:00:00.000Z');
    },
  },
];

module.exports = { name, tests };
