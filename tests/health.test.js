// Exercise both health handlers and the generated browser script with local doubles.
const assert = require('assert');
const Module = require('module');
const vm = require('vm');

let dbHealth = { status: 'connected', message: 'Database connection is healthy' };
let healthError = null;
const database = {
  connect: async () => {},
  healthCheck: async () => {
    if (healthError) throw healthError;
    return dbHealth;
  }
};
const logger = { api() {}, error() {}, warn() {}, info() {} };

function loadWithMocks(file) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'dotenv') return { config() {} };
    if (request === '../config/database' || request === '../src/config/database') return database;
    if (request === '../utils/logger') return logger;
    if (request === './routes/auth') {
      return { router: require('express').Router(), requireAuth() {}, ensureDefaultAdmin: async () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve(file);
    delete require.cache[resolved];
    const result = require(file);
    delete require.cache[resolved];
    return result;
  } finally {
    Module._load = originalLoad;
  }
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; }
  };
}

function assertMetrics(body) {
  assert.strictEqual(body.status, 'ok');
  assert.deepStrictEqual(body.database, dbHealth);
  assert.strictEqual(typeof body.uptime, 'number');
  assert.ok(body.uptime >= 0);
  assert.deepStrictEqual(Object.keys(body.memory).sort(), ['external', 'heapTotal', 'heapUsed', 'rss']);
  for (const field of ['rss', 'heapTotal', 'heapUsed', 'external']) {
    assert.strictEqual(typeof body.memory[field], 'number', field);
    assert.ok(body.memory[field] >= 0, field);
  }
}

module.exports = {
  name: 'health API and page',
  tests: [
    {
      name: 'serverless JSON provides database and process metrics',
      fn: async () => {
        const handler = loadWithMocks('../api/health');
        const res = response();
        await handler({ method: 'GET', headers: { accept: 'application/json' } }, res);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['Cache-Control'], 'no-store');
        assertMetrics(res.body);
      }
    },
    {
      name: 'standalone JSON provides database and process metrics',
      fn: async () => {
        const ApiServer = loadWithMocks('../src/api/server');
        const oldSecret = process.env.SESSION_SECRET;
        process.env.SESSION_SECRET = 'local-test-secret';
        try {
          const server = new ApiServer();
          await server.init();
          const route = server.app.router.stack.find(layer => layer.route && layer.route.path === '/health');
          const res = response();
          await route.route.stack[0].handle({ accepts: () => false }, res);
          assert.strictEqual(res.headers['Cache-Control'], 'no-store');
          assertMetrics(res.body);
        } finally {
          if (oldSecret === undefined) delete process.env.SESSION_SECRET;
          else process.env.SESSION_SECRET = oldSecret;
        }
      }
    },
    {
      name: 'health endpoints sanitize database errors but keep the connected message',
      fn: async () => {
        const original = dbHealth;
        dbHealth = { status: 'error', message: 'connect ECONNREFUSED 10.0.0.5:27017' };
        const oldSecret = process.env.SESSION_SECRET;
        try {
          const handler = loadWithMocks('../api/health');
          const serverless = response();
          await handler({ method: 'GET', headers: { accept: 'application/json' } }, serverless);
          assert.deepStrictEqual(serverless.body.database, {
            status: 'error', message: 'Database health check failed'
          });
          assert.strictEqual(serverless.body.status, 'error');
          assert.strictEqual(serverless.statusCode, 503);

          process.env.SESSION_SECRET = 'local-test-secret';
          const ApiServer = loadWithMocks('../src/api/server');
          const server = new ApiServer();
          await server.init();
          const route = server.app.router.stack.find(layer => layer.route && layer.route.path === '/health');
          const standalone = response();
          await route.route.stack[0].handle({ accepts: () => false }, standalone);
          assert.deepStrictEqual(standalone.body.database, {
            status: 'error', message: 'Database health check failed'
          });
          assert.strictEqual(standalone.body.status, 'error');
          assert.strictEqual(standalone.statusCode, 503);
          dbHealth = { status: 'disconnected', message: 'disconnected' };
          for (const [invoke, html] of [
            [res => handler({ method: 'GET', headers: { accept: 'application/json' } }, res), false],
            [res => handler({ method: 'GET', headers: { accept: 'text/html' } }, res), true],
            [res => route.route.stack[0].handle({ accepts: () => false }, res), false],
            [res => route.route.stack[0].handle({ accepts: () => true }, res), true]
          ]) {
            const res = response();
            await invoke(res);
            assert.strictEqual(res.statusCode, 503);
            if (html) assert.ok(res.body.includes('<html'));
            else assert.strictEqual(res.body.database.status, 'disconnected');
          }
        } finally {
          dbHealth = original;
          if (oldSecret === undefined) delete process.env.SESSION_SECRET;
          else process.env.SESSION_SECRET = oldSecret;
        }
      }
    },
    {
      name: 'health failures stay generic and the HTML error response is 500',
      fn: async () => {
        healthError = new Error('mongodb://user:pass@10.0.0.5:27017');
        const oldSecret = process.env.SESSION_SECRET;
        const originalConsoleError = console.error;
        console.error = () => {};
        try {
          const handler = loadWithMocks('../api/health');
          const serverless = response();
          await handler({ method: 'GET', headers: { accept: 'application/json' } }, serverless);
          assert.strictEqual(serverless.statusCode, 500);
          assert.strictEqual(serverless.body.message, 'Health check failed');
          assert.ok(!JSON.stringify(serverless.body).includes('10.0.0.5'));

          process.env.SESSION_SECRET = 'local-test-secret';
          const ApiServer = loadWithMocks('../src/api/server');
          const server = new ApiServer();
          await server.init();
          const route = server.app.router.stack.find(layer => layer.route && layer.route.path === '/health');
          const standalone = response();
          await route.route.stack[0].handle({ accepts: () => true }, standalone);
          assert.strictEqual(standalone.statusCode, 500);
          assert.ok(standalone.body.includes('Health check failed'));
        } finally {
          healthError = null;
          console.error = originalConsoleError;
          if (oldSecret === undefined) delete process.env.SESSION_SECRET;
          else process.env.SESSION_SECRET = oldSecret;
        }
      }
    },
    {
      name: 'server-rendered error banner is escaped and cleared after a successful refresh',
      fn: async () => {
        const getHealthHTML = require('../src/api/health-template');
        const html = getHealthHTML({ error: '<img src=x onerror=alert(1)>' });
        assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
        assert.ok(!html.includes('<img src=x'));

        const script = html.match(/<script>([\s\S]*)<\/script>/i)[1];
        const elements = new Map();
        function element(id) {
          if (!elements.has(id)) elements.set(id, {
            textContent: '-', className: '', innerHTML: '', style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            addEventListener() {}
          });
          return elements.get(id);
        }
        vm.runInNewContext(script, {
          document: { documentElement: { setAttribute() {} }, getElementById: element, querySelector: element },
          localStorage: { getItem() { return null; }, setItem() {} },
          fetch: async () => ({ json: async () => ({ status: 'ok', uptime: 1 }) }),
          setInterval() {},
          console: { error() {} }
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(element('errorBanner').style.display, 'none');
      }
    },
    {
      name: 'page fetches immediately and renders uptime and memory, including zero uptime',
      fn: async () => {
        const getHealthHTML = require('../src/api/health-template');
        const script = getHealthHTML().match(/<script>([\s\S]*)<\/script>/i)[1];
        const elements = new Map();
        function element(id) {
          if (!elements.has(id)) elements.set(id, {
            textContent: '-', className: '', innerHTML: '', style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            addEventListener() {}
          });
          return elements.get(id);
        }
        let payload = { status: 'ok', uptime: 0, version: '1.2.3', database: dbHealth,
          memory: { rss: 1048576, heapTotal: 2048, heapUsed: 512, external: 2097152 } };
        let nextResponse;
        let requests = 0;
        let interval;
        vm.runInNewContext(script, {
          document: { documentElement: { setAttribute() {} }, getElementById: element, querySelector: element },
          localStorage: { getItem() { return null; }, setItem() {} },
          fetch: async (url, options) => {
            requests++;
            assert.strictEqual(url, '/health');
            assert.strictEqual(options.headers.Accept, 'application/json');
            if (nextResponse) {
              const response = nextResponse;
              nextResponse = undefined;
              return response;
            }
            return { json: async () => payload };
          },
          setInterval(fn, delay) { interval = { fn, delay }; },
          console: { error() {} }
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(requests, 1, 'page should fetch immediately');
        assert.strictEqual(interval.delay, 30000);
        assert.strictEqual(element('uptimeValue').textContent, '0m');
        assert.strictEqual(element('memRss').textContent, '1.0 MB');
        assert.strictEqual(element('memHeapTotal').textContent, '2.0 KB');
        assert.strictEqual(element('memHeapUsed').textContent, '512 B');
        assert.strictEqual(element('memExternal').textContent, '2.0 MB');
        payload.uptime = 3661;
        await interval.fn();
        assert.strictEqual(requests, 2, 'page should refresh on the interval');
        assert.strictEqual(element('uptimeValue').textContent, '1h 1m');

        payload = { status: 'ok', uptime: Infinity, memory: { rss: 0, heapTotal: NaN, heapUsed: 'bad', external: -1 } };
        await interval.fn();
        assert.strictEqual(element('uptimeValue').textContent, '-');
        assert.strictEqual(element('memRss').textContent, '0 B');
        assert.strictEqual(element('memHeapTotal').textContent, '-');
        assert.strictEqual(element('memHeapUsed').textContent, '-');
        assert.strictEqual(element('memExternal').textContent, '-');

        let resolveOld;
        nextResponse = new Promise(resolve => { resolveOld = resolve; });
        const oldRequest = interval.fn();
        payload = { status: 'ok', uptime: 120, memory: { rss: 2048 } };
        await interval.fn();
        resolveOld({ json: async () => ({ status: 'ok', uptime: 3600, memory: { rss: 1048576 } }) });
        await oldRequest;
        assert.strictEqual(element('uptimeValue').textContent, '2m');
        assert.strictEqual(element('memRss').textContent, '2.0 KB');
        assert.strictEqual(element('memHeapTotal').textContent, '-');

        nextResponse = { ok: false, status: 503, json: async () => ({ status: 'error', database: { status: 'disconnected', message: 'Database health check failed' } }) };
        await interval.fn();
        assert.strictEqual(element('overallText').textContent, 'System Error');
        assert.strictEqual(element('dbText').textContent, 'disconnected');

        nextResponse = Promise.reject(new Error('offline'));
        await interval.fn();
        assert.strictEqual(element('uptimeValue').textContent, '-');
        assert.strictEqual(element('memRss').textContent, '-');
        assert.strictEqual(element('overallText').textContent, 'Status unavailable');
        assert.strictEqual(element('overallBadge').textContent, 'UNKNOWN');
        assert.strictEqual(element('dbText').textContent, 'Unknown');

        payload = { status: 'ok' };
        await interval.fn();
        assert.strictEqual(element('uptimeValue').textContent, '-');
        assert.strictEqual(element('memRss').textContent, '-');
        assert.strictEqual(element('dbText').textContent, 'Unknown');
      }
    }
  ]
};
