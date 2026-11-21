const assert = require('assert');
const Order = require('../src/models/Order');
const database = require('../src/config/database');
const auth = require('../src/api/serverless-auth');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader() {} };
}

async function runCase(deployment, dashboardView) {
  const original = { find: Order.find, countDocuments: Order.countDocuments, distinct: Order.distinct,
    aggregate: Order.aggregate, connect: database.connect, disconnect: database.disconnect,
    secret: process.env.SESSION_SECRET };
  const calls = { distinct: [], aggregate: 0 };
  try {
    process.env.SESSION_SECRET = 'local-test-secret';
    database.connect = async () => {};
    database.disconnect = async () => {};
    Order.find = filter => {
      calls.filter = filter;
      return { sort(sort) { calls.sort = sort; return this; }, skip(skip) { calls.skip = skip; return this; },
        limit(limit) { calls.limit = limit; return this; }, lean: async () => [{ orderNumber: 'A1' }] };
    };
    Order.countDocuments = async filter => { assert.deepStrictEqual(filter, calls.filter); return 21; };
    Order.distinct = async field => { calls.distinct.push(field); return field === 'status' ? ['completed'] : ['pickup']; };
    Order.aggregate = async () => { calls.aggregate++; return [{ _id: 'Name' }]; };
    const query = { page: '2', limit: '10', status: 'completed', orderType: 'pickup',
      startDate: '2026-01-01', endDate: '2026-01-03', hasErrors: 'false', sortBy: 'total', sortOrder: 'asc',
      ...(dashboardView ? { view: 'dashboard' } : {}) };
    const res = response();
    if (deployment === 'express') {
      const router = require('../src/api/routes/orders');
      const route = router.stack.find(layer => layer.route?.path === '/').route;
      await route.stack[0].handle({ query }, res);
    } else {
      const handler = require('../api/orders/index');
      const denied = response();
      await handler({ method: 'GET', url: '/api/orders', headers: {}, query }, denied);
      assert.strictEqual(denied.statusCode, 401);
      const token = auth.issueSession(response(), { _id: 'local', username: 'local' });
      await handler({ method: 'GET', headers: { cookie: `gf_session=${token}` }, query }, res);
    }
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls.filter, { status: 'completed', 'orderDetails.orderType': 'pickup',
      orderTimestamp: { $gte: new Date('2025-12-31T16:00:00.000Z'), $lte: new Date('2026-01-03T15:59:59.999Z') }, hasErrors: false });
    assert.deepStrictEqual(calls.sort, { 'pricing.total': 1 });
    assert.strictEqual(calls.skip, 10);
    assert.strictEqual(calls.limit, 10);
    assert.deepStrictEqual(res.body.data, [{ orderNumber: 'A1' }]);
    assert.deepStrictEqual(res.body.pagination, { currentPage: 2, totalPages: 3, totalCount: 21,
      limit: 10, hasNextPage: true, hasPrevPage: true });
    assert.deepStrictEqual(res.body.filters, dashboardView ? { statuses: ['completed'] } : {
      statuses: ['completed'], orderTypes: ['pickup'], restaurants: ['Name'], drivers: ['Name'] });
    assert.deepStrictEqual(calls.distinct, dashboardView ? ['status'] : ['status', 'orderDetails.orderType']);
    assert.strictEqual(calls.aggregate, dashboardView ? 0 : 2);
  } finally {
    Object.assign(Order, { find: original.find, countDocuments: original.countDocuments, distinct: original.distinct, aggregate: original.aggregate });
    database.connect = original.connect;
    database.disconnect = original.disconnect;
    if (original.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original.secret;
  }
}

module.exports = { name: 'orders dashboard view', tests: [
  { name: 'Express default orders keeps filters', fn: () => runCase('express', false) },
  { name: 'Express dashboard orders keeps filtering but skips unused filter options', fn: () => runCase('express', true) },
  { name: 'serverless default orders keeps filters', fn: () => runCase('serverless', false) },
  { name: 'serverless dashboard orders keeps filtering but skips unused filter options', fn: () => runCase('serverless', true) }
] };
