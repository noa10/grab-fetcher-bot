const assert = require('node:assert/strict');
const tests = [];
const vm = require('node:vm');
const Module = require('node:module');
const getDashboardHTML = require('../src/api/dashboard-template');

function loadWithMocks(filename, mocks) {
  const original = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      return original.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve(filename)];
    return require(filename);
  } finally {
    Module._load = original;
  }
}

function makeCache() {
  const entries = new Map();
  return {
    entries,
    findOne: async query => {
      const entry = entries.get(query.cacheKey);
      return entry && entry.expiresAt > query.expiresAt.$gt ? entry : null;
    },
    findOneAndUpdate: async (query, update) => {
      const entry = { data: update.data, expiresAt: update.expiresAt };
      entries.set(query.cacheKey, entry);
      return entry;
    }
  };
}

function loadRoutes(target, models) {
  const routes = {};
  const router = { use() {}, get(path, ...handlers) { routes[path] = handlers.at(-1); } };
  const mocks = target === 'express' ? {
    express: { Router: () => router }, 'express-rate-limit': () => () => {},
    '../../models/Order': models.order, '../../models/Customer': models.customer,
    '../../models/MarketingCache': models.marketingCache,
    '../../utils/inputSanitizer': {}, '../../utils/logger': { error() {} },
  } : {
    '../src/config/database': { connect: async () => {}, disconnect: async () => {} },
    '../src/models/Order': models.order, '../src/models/Customer': models.customer,
    '../src/models/MarketingCache': models.marketingCache,
    '../src/utils/inputSanitizer': {}, '../src/api/serverless-auth': { requireAuth: () => true },
  };
  const handler = loadWithMocks(target === 'express' ? '../src/api/routes/marketing' : '../api/marketing', mocks);
  return { handler, routes };
}

tests.push({ name: 'marketing sections render as their requests complete and reject old responses', fn: async () => {
  const html = getDashboardHTML();
  const script = html.match(/<script>([\s\S]*)<\/script>/i)[1];
  const body = script.slice(script.indexOf('        let marketingRequestId = 0;'), script.indexOf('        function escapeHtml'));
  const pending = [];
  const elements = {};
  const context = {
    fetch: url => new Promise(resolve => pending.push({ url, resolve })),
    document: { getElementById: id => elements[id] ||= {} },
    renderCustomerTable() {}, console: { error() {}, log() {} },
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  const respond = (url, data) => {
    const index = pending.findIndex(request => request.url === url);
    pending.splice(index, 1)[0].resolve({ ok: true, json: async () => ({ success: true, data }) });
  };
  const finish = (requests, totalCustomers) => {
    for (const { url, resolve } of requests) {
      resolve({ ok: true, json: async () => ({ success: true, data: url.endsWith('/kpis') ? { totalCustomers } : {} }) });
    }
  };
  const older = context.fetchMarketingData();
  const olderRequests = pending.splice(0);
  const newer = context.fetchMarketingData();
  const newerRequests = pending.splice(0);
  finish(newerRequests, 20);
  await newer;
  finish(olderRequests, 99);
  await older;
  assert.equal(elements.kpiTotalCustomers.textContent, '20');

  const failing = context.fetchMarketingData();
  const failingRequests = pending.splice(0);
  failingRequests[0].resolve({ ok: false });
  finish(failingRequests.slice(1), 0);
  await failing;
  assert.match(elements.marketingKpisStatus.textContent, /out of date/);

  const abandoned = context.fetchMarketingData();
  const abandonedRequests = pending.splice(0);
  vm.runInContext('marketingRequestId++', context);
  finish(abandonedRequests, 77);
  await abandoned;
  assert.equal(elements.kpiTotalCustomers.textContent, '20');
  assert.match(html, /if \(view !== state\.currentView\) \{[\s\S]*?marketingRequestId\+\+/);
  assert.match(html, /first matching rule applies/);
  assert.match(html, /At-Risk: last order 31–90 days ago/);
  assert.match(html, /title="Last order 31–90 days ago"/);
}});

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} cohorts do not rebuild customers and still use cache`, fn: async () => {
    let rebuilds = 0;
    let aggregates = 0;
    const customer = {
      buildCustomerCollection: async () => { rebuilds++; },
      aggregate: async () => [{ _id: 'Loyal', count: 2 }],
    };
    const order = { aggregate: async () => { aggregates++; return [{ cohortMonth: '2024-01', months: ['2024-01', '2024-02'] }]; } };
    const marketingCache = makeCache();
    const { handler, routes } = loadRoutes(target, { order, customer, marketingCache });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    try {
      const request = { method: 'GET', url: '/api/marketing/cohorts', headers: { host: 'example.test' }, query: {} };
      let payload;
      const response = { setHeader() {}, json(value) { payload = value; return value; }, status() { return this; } };
      const call = () => target === 'express' ? routes['/cohorts'](request, response) : handler(request, response);
      await call();
      assert.equal(rebuilds, 0);
      assert.equal(aggregates, 1);
      assert.equal(payload.data.cohorts[0].retention['2024-02'], 100);
      assert.ok(marketingCache.entries.get('marketing:cohorts').expiresAt.getTime() > Date.now());
      await call();
      assert.equal(aggregates, 1);

      marketingCache.entries.clear();
      request.url = '/api/marketing/rfm';
      if (target === 'express') await routes['/rfm'](request, response);
      else await handler(request, response);
      assert.equal(rebuilds, 1);
      assert.equal(payload.data.segments[0].segment, 'Loyal');
    } finally {
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS;
      else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});
}

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} customer reads wait for a delayed rebuild`, fn: async () => {
    let rebuilds = 0;
    let queries = 0;
    let release;
    const chain = { sort() { return chain; }, skip() { return chain; }, limit() { return chain; }, lean: async () => [] };
    const customer = {
      buildCustomerCollection: () => { rebuilds++; return new Promise(resolve => { release = resolve; }); },
      find: () => { queries++; return chain; },
      countDocuments: async () => 0,
    };
    const marketingCache = makeCache();
    const { handler, routes } = loadRoutes(target, { order: { aggregate: async () => [] }, customer, marketingCache });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    try {
      const request = { method: 'GET', url: '/api/marketing/customers/winback', headers: { host: 'example.test' }, query: {} };
      const response = { setHeader() {}, json(value) { return value; }, status() { return this; } };
      const call = () => target === 'express' ? routes['/customers/winback'](request, response) : handler(request, response);
      const pending = call();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(queries, 0, 'read started before the rebuild finished');
      release();
      await pending;
      assert.equal(queries, 1);
      assert.ok(marketingCache.entries.has('marketing:customers:snapshot'));
      await call();
      assert.equal(rebuilds, 1, 'warm snapshot should not rebuild');
    } finally {
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS;
      else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});
}

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} KPI month window starts at MYT midnight on the 1st`, fn: async () => {
    const { getMalaysiaDateString, mytDayStart } = require('../src/utils/helpers');
    const captured = [];
    const order = {
      aggregate: async pipeline => {
        captured.push(pipeline[0].$match.orderTimestamp.$gte);
        const grouped = pipeline.find(stage => stage.$group).$group;
        return 'revenue' in grouped
          ? [{ revenue: 1, orders: 1, aov: 1 }]
          : [{ activeCustomers: 1 }];
      }
    };
    const customer = {
      buildCustomerCollection: async () => {},
      aggregate: async () => [],
      countDocuments: async () => 1
    };
    const { handler, routes } = loadRoutes(target, { order, customer, marketingCache: makeCache() });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    try {
      const request = { method: 'GET', url: '/api/marketing/kpis', headers: { host: 'example.test' }, query: {} };
      const response = { setHeader() {}, json(value) { return value; }, status() { return this; } };
      if (target === 'express') await routes['/kpis'](request, response);
      else await handler(request, response);
      const todayStr = getMalaysiaDateString();
      const expected = mytDayStart(`${todayStr.slice(0, 8)}01`);
      assert.equal(captured.length, 2);
      for (const start of captured) assert.equal(start.getTime(), expected.getTime());
    } finally {
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS;
      else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});
}

module.exports = { name: 'marketing', tests };
