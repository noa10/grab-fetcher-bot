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
      return entry && (!query.expiresAt || entry.expiresAt > query.expiresAt.$gt) ? entry : null;
    },
    findOneAndUpdate: async (query, update) => {
      const current = entries.get(query.cacheKey);
      const entry = update.$setOnInsert
        ? current || { ...update.$setOnInsert }
        : update.$set ? { ...current, ...update.$set } : { data: update.data, expiresAt: update.expiresAt };
      if (update.$unset?.expiresAt) delete entry.expiresAt;
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
      exists: async () => null,
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

tests.push({ name: 'existing customers remain available while a refresh is running and fails', fn: async () => {
  let rejectBuild;
  const customer = {
    exists: async () => ({ _id: 'existing' }),
    buildCustomerCollection: () => new Promise((resolve, reject) => { rejectBuild = reject; })
  };
  const cache = makeCache();
  const snapshot = require('../src/api/customer-snapshot')(customer, cache);
  const refresh = snapshot.rebuildCustomers().then(() => null, error => error);
  await new Promise(resolve => setImmediate(resolve));
  let readFinished = false;
  const read = snapshot.ensureCustomerSnapshot().then(() => { readFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  const readFinishedBeforeRefresh = readFinished;
  rejectBuild(new Error('refresh failed'));
  await Promise.all([read, refresh]);
  assert.equal(readFinishedBeforeRefresh, true);
  assert.equal(cache.entries.has('marketing:customers:snapshot'), false);
}});

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} customer reads wait for a delayed rebuild`, fn: async () => {
    let rebuilds = 0;
    let queries = 0;
    let release;
    const chain = { sort() { return chain; }, skip() { return chain; }, limit() { return chain; }, lean: async () => [] };
    const customer = {
      buildCustomerCollection: () => { rebuilds++; return new Promise(resolve => { release = resolve; }); },
      exists: async () => null,
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
      assert.equal(marketingCache.entries.get('marketing:customers:snapshot').expiresAt, undefined);
      assert.equal(marketingCache.entries.get('marketing:customers:snapshot').data.state, 'completed');
      await call();
      assert.equal(rebuilds, 1, 'warm snapshot should not rebuild');
    } finally {
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS;
      else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});
}

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} customer reads use a completed marker without rebuilding after expiry`, fn: async () => {
    let builds = 0;
    const customer = {
      buildCustomerCollection: async () => { builds++; throw new Error('build failed'); },
      exists: async () => ({ _id: 'existing' }),
      find: () => chain,
      countDocuments: async () => 1
    };
    const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [{ name: 'Real customer' }] };
    const marketingCache = makeCache();
    marketingCache.entries.set('marketing:customers:snapshot', { expiresAt: new Date(0) });
    const { handler, routes } = loadRoutes(target, { order: {}, customer, marketingCache });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    try {
      let payload;
      const req = { method: 'GET', url: '/api/marketing/customers/winback', headers: { host: 'example.test' }, query: {} };
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { payload = value; return this; } };
      if (target === 'express') await routes['/customers/winback'](req, res); else await handler(req, res);
      assert.equal(builds, 0);
      assert.equal(payload.data.customers[0].name, 'Real customer');
    } finally {
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS; else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});

  tests.push({ name: `${target} retries a failed initial build instead of serving its partial rows`, fn: async () => {
    let partial = false;
    let builds = 0;
    let reads = 0;
    const customer = {
      exists: async () => partial ? { _id: 'partial' } : null,
      buildCustomerCollection: async () => { builds++; partial = true; throw new Error('partial merge'); },
      find: () => { reads++; throw new Error('partial rows must not be read'); },
      countDocuments: async () => 1
    };
    const marketingCache = makeCache();
    const { handler, routes } = loadRoutes(target, { order: {}, customer, marketingCache });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    const oldError = console.error;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    console.error = () => {};
    try {
      const req = { method: 'GET', url: '/api/marketing/customers/winback', headers: { host: 'example.test' }, query: {} };
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json() { return this; } };
      for (let i = 0; i < 2; i++) {
        if (target === 'express') await routes['/customers/winback'](req, res); else await handler(req, res);
        assert.equal(res.code, 500);
      }
      assert.equal(builds, 2);
      assert.equal(reads, 0);
      assert.equal(marketingCache.entries.get('marketing:customers:snapshot').data.state, 'initializing');
    } finally {
      console.error = oldError;
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS; else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});

  tests.push({ name: `${target} partial first build is not mistaken for existing data on another instance`, fn: async () => {
    let hasRows = false;
    let builds = 0;
    const customer = {
      exists: async () => hasRows ? { _id: 'partial' } : null,
      buildCustomerCollection: async () => {
        builds++;
        hasRows = true;
        if (builds < 3) throw new Error('partial write');
      },
      find: () => chain,
      countDocuments: async () => 1
    };
    const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [{ name: 'Real customer' }] };
    const marketingCache = makeCache();
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    const oldError = console.error;
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    console.error = () => {};
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { handler, routes } = loadRoutes(target, { order: {}, customer, marketingCache });
        let payload;
        const req = { method: 'GET', url: '/api/marketing/customers/winback', headers: { host: 'example.test' }, query: {} };
        const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { payload = value; return this; } };
        if (target === 'express') await routes['/customers/winback'](req, res); else await handler(req, res);
        if (attempt < 3) {
          assert.equal(res.code, 500);
          assert.equal(marketingCache.entries.get('marketing:customers:snapshot').data.state, 'initializing');
        } else {
          assert.equal(payload.data.customers[0].name, 'Real customer');
          assert.equal(marketingCache.entries.get('marketing:customers:snapshot').data.state, 'completed');
        }
      }
      assert.equal(builds, 3);
    } finally {
      console.error = oldError;
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS; else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});

  tests.push({ name: `${target} serves pre-existing customers immediately and reports an empty first build failure`, fn: async () => {
    for (const existed of [true, false]) {
      let builds = 0;
      const customer = {
        exists: async () => existed ? { _id: 'old' } : null,
        buildCustomerCollection: async () => { builds++; throw new Error('build failed'); },
        find: () => chain,
        countDocuments: async () => 1
      };
      const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [{ name: 'Real customer' }] };
      const marketingCache = makeCache();
      const { handler, routes } = loadRoutes(target, { order: {}, customer, marketingCache });
      const previous = process.env.ENABLE_MARKETING_ANALYTICS;
      process.env.ENABLE_MARKETING_ANALYTICS = 'true';
      const oldError = console.error; console.error = () => {};
      try {
        let payload;
        const req = { method: 'GET', url: '/api/marketing/customers/winback', headers: { host: 'example.test' }, query: {} };
        const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { payload = value; return this; } };
        if (target === 'express') await routes['/customers/winback'](req, res); else await handler(req, res);
        if (existed) {
          assert.equal(payload.data.customers[0].name, 'Real customer');
          assert.equal(marketingCache.entries.has('marketing:customers:snapshot'), false);
        } else {
          assert.equal(res.code, 500);
          assert.equal(marketingCache.entries.get('marketing:customers:snapshot').data.state, 'initializing');
        }
      } finally {
        console.error = oldError;
        if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS; else process.env.ENABLE_MARKETING_ANALYTICS = previous;
      }
    }
  }});
}

for (const target of ['express', 'serverless']) {
  tests.push({ name: `${target} KPI month window starts at MYT midnight on the 1st`, fn: async () => {
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
      exists: async () => null,
      aggregate: async () => [],
      countDocuments: async () => 1
    };
    const { handler, routes } = loadRoutes(target, { order, customer, marketingCache: makeCache() });
    const previous = process.env.ENABLE_MARKETING_ANALYTICS;
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-11-30T17:00:00Z'])); }
      static now() { return new RealDate('2026-11-30T17:00:00Z').getTime(); }
    };
    process.env.ENABLE_MARKETING_ANALYTICS = 'true';
    try {
      const request = { method: 'GET', url: '/api/marketing/kpis', headers: { host: 'example.test' }, query: {} };
      const response = { setHeader() {}, json(value) { return value; }, status() { return this; } };
      if (target === 'express') await routes['/kpis'](request, response);
      else await handler(request, response);
      assert.equal(captured.length, 2);
      for (const start of captured) assert.equal(start.toISOString(), '2026-11-30T16:00:00.000Z');
    } finally {
      global.Date = RealDate;
      if (previous === undefined) delete process.env.ENABLE_MARKETING_ANALYTICS;
      else process.env.ENABLE_MARKETING_ANALYTICS = previous;
    }
  }});
}

module.exports = { name: 'marketing', tests };
