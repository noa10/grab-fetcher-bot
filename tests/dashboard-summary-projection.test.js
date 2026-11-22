const assert = require('assert');
const Order = require('../src/models/Order');
const database = require('../src/config/database');
const auth = require('../src/api/routes/auth');
const serverlessAuth = require('../src/api/serverless-auth');

const sample = {
  _id: 'order-1', orderNumber: 'A1', customerName: 'Customer', driverName: 'Driver',
  status: 'completed', pricing: { total: 42, currency: 'MYR', subtotal: 40 },
  orderTimestamp: new Date('2026-01-01T00:00:00Z'),
  orderDetails: { orderType: 'pickup', restaurantName: 'Restaurant', items: [{ notes: 'x'.repeat(4000) }] },
  deliveryTime: '12:00', hasErrors: true, fetchedAt: new Date('2026-01-02T00:00:00Z'),
  customerPhone: 'private', customerNote: 'x'.repeat(4000)
};

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(location) { this.location = location; return this; },
    setHeader(name, value) { this[name] = value; }
  };
}

async function checkSummary(deployment, dashboardView = false, boundary = null) {
  const original = { find: Order.find, aggregate: Order.aggregate, connect: database.connect,
    ensureDefaultAdmin: auth.ensureDefaultAdmin, secret: process.env.SESSION_SECRET };
  const dotenv = require('dotenv');
  const originalConfig = dotenv.config;
  let projection;
  let aggregationCount = 0;
  const pipelines = [];
  const RealDate = global.Date;
  const oldTZ = process.env.TZ;
  try {
    process.env.SESSION_SECRET = 'local-test-secret';
    dotenv.config = () => ({});
    database.connect = async () => {};
    auth.ensureDefaultAdmin = async () => {};
    // Load Mongoose schemas before replacing Date, and bind the mocked auth hook.
    global.Date = RealDate;
    delete require.cache[require.resolve('../src/api/server')];
    const ApiServer = require('../src/api/server');
    if (boundary) {
      process.env.TZ = boundary.tz;
      global.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [boundary.now])); }
        static now() { return new RealDate(boundary.now).getTime(); }
      };
    }
    Order.aggregate = async pipeline => { aggregationCount++; pipelines.push(pipeline); return []; };
    Order.find = () => ({
      sort(value) { assert.deepStrictEqual(value, { orderTimestamp: -1 }); return this; },
      limit(value) { assert.strictEqual(value, dashboardView ? 1 : 50); return this; },
      select(value) { projection = value; return this; },
      lean() {
        const selected = { _id: sample._id };
        if (!projection) return Promise.resolve([sample]);
        for (const field of projection.split(/\s+/)) {
          const parts = field.split('.');
          let source = sample;
          let target = selected;
          for (let i = 0; i < parts.length; i++) {
            if (source == null || !Object.hasOwn(source, parts[i])) break;
            if (i === parts.length - 1) target[parts[i]] = source[parts[i]];
            else { source = source[parts[i]]; target = target[parts[i]] ||= {}; }
          }
        }
        return Promise.resolve([selected]);
      }
    });

    const res = response();
    if (deployment === 'express') {
      const server = new ApiServer();
      await server.init();
      const route = server.app.router.stack.find(layer => layer.route?.path === '/api/dashboard/summary').route;
      let continued = false;
      const denied = response();
      route.stack[0].handle({ originalUrl: '/api/dashboard/summary', headers: {} }, denied, () => { continued = true; });
      assert.strictEqual(denied.statusCode, 401);
      assert.strictEqual(continued, false);
      route.stack[0].handle({ session: { userId: 'local', passwordChangedAt: 'set' }, headers: {} }, response(), () => { continued = true; });
      assert.strictEqual(continued, true);
      await route.stack[1].handle({ query: dashboardView ? { view: 'dashboard' } : {} }, res);
    } else {
      const handler = require('../api/dashboard/summary');
      const denied = response();
      await handler({ method: 'GET', url: '/api/dashboard/summary', headers: {} }, denied);
      assert.strictEqual(denied.statusCode, 401);
      const token = serverlessAuth.issueSession(response(), { _id: 'local', username: 'local' });
      await handler({ method: 'GET', query: dashboardView ? { view: 'dashboard' } : {}, headers: { cookie: `gf_session=${token}` } }, res);
    }
    assert.strictEqual(res.statusCode, 200);
    if (boundary) {
      const day = pipelines[1][0].$match.orderTimestamp;
      assert.strictEqual(day.$gte.toISOString(), boundary.day);
      assert.strictEqual(day.$lt.toISOString(), boundary.next);
      assert.strictEqual(pipelines[2][0].$match.orderTimestamp.$gte.toISOString(), boundary.week);
      assert.strictEqual(pipelines[3][0].$match.orderTimestamp.$gte.toISOString(), boundary.month);
    }
    assert.ok(projection, 'summary should request only fields used in its response');
    assert.strictEqual(aggregationCount, dashboardView ? 7 : 11);
    if (dashboardView) {
      for (const key of ['recentOrders', 'orderTypeBreakdown', 'topRestaurants', 'topDrivers', 'hourlyDistribution']) {
        assert.strictEqual(Object.hasOwn(res.body.data, key), false);
      }
      assert.deepStrictEqual(res.body.data.errors, { totalOrders: 0, ordersWithErrors: 0, processedOrders: 0 });
      assert.deepStrictEqual(res.body.data.statusBreakdown, []);
      assert.deepStrictEqual(res.body.data.recentActivity, []);
    } else assert.deepStrictEqual(res.body.data.recentOrders, [{
      _id: 'order-1', orderNumber: 'A1', customerName: 'Customer', driverName: 'Driver',
      status: 'completed', total: 42, currency: 'MYR', orderTimestamp: sample.orderTimestamp,
      orderType: 'pickup', restaurantName: 'Restaurant', deliveryTime: '12:00', hasErrors: true
    }]);
    assert.strictEqual(res.body.data.lastFetchedAt, sample.fetchedAt);
    assert.strictEqual(projection.includes('customerPhone'), false);
    assert.strictEqual(projection.includes('items'), false);
  } finally {
    global.Date = RealDate;
    if (oldTZ === undefined) delete process.env.TZ;
    else process.env.TZ = oldTZ;
    Order.find = original.find;
    Order.aggregate = original.aggregate;
    database.connect = original.connect;
    auth.ensureDefaultAdmin = original.ensureDefaultAdmin;
    dotenv.config = originalConfig;
    if (original.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original.secret;
  }
}

const boundaries = [
  { now: '2026-11-30T15:59:59Z', day: '2026-11-29T16:00:00.000Z', next: '2026-11-30T16:00:00.000Z', week: '2026-11-28T16:00:00.000Z', month: '2026-10-31T16:00:00.000Z' },
  { now: '2026-11-30T17:00:00Z', day: '2026-11-30T16:00:00.000Z', next: '2026-12-01T16:00:00.000Z', week: '2026-11-28T16:00:00.000Z', month: '2026-11-30T16:00:00.000Z' },
  { now: '2026-03-01T00:00:00Z', day: '2026-02-28T16:00:00.000Z', next: '2026-03-01T16:00:00.000Z', week: '2026-02-28T16:00:00.000Z', month: '2026-02-28T16:00:00.000Z' }
];

module.exports = {
  name: 'dashboard summary projection',
  tests: [
    { name: 'Express preserves summary and auth with a narrow order projection', fn: () => checkSummary('express') },
    { name: 'serverless preserves summary and auth with a narrow order projection', fn: () => checkSummary('serverless') },
    { name: 'Express dashboard view skips unused queries', fn: () => checkSummary('express', true) },
    { name: 'serverless dashboard view skips unused queries', fn: () => checkSummary('serverless', true) },
    ...['express', 'serverless'].flatMap(deployment => ['UTC', 'America/New_York'].flatMap(tz => boundaries.map(boundary => ({
      name: `${deployment} MYT boundaries at ${boundary.now} on ${tz}`,
      fn: () => checkSummary(deployment, true, { ...boundary, tz })
    }))))
  ]
};
