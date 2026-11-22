const assert = require('assert');
const vm = require('vm');
const getDashboardHTML = require('../src/api/dashboard-template');

function dashboard() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const listeners = {};
      elements.set(id, {
        value: '', textContent: '', innerHTML: '', title: '', dataset: {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: () => {} },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        click: () => { if (listeners.click) listeners.click(); },
        appendChild: () => {}, querySelectorAll: () => []
      });
    }
    return elements.get(id);
  }
  const requests = [];
  const document = {
    getElementById: element, querySelector: element, querySelectorAll: () => [],
    createElement: () => element('created'), addEventListener: () => {},
    documentElement: { getAttribute: () => 'light' }
  };
  const context = vm.createContext({
    document, window: { location: { href: '' } }, history: { replaceState: () => {} },
    URLSearchParams, AbortController, console: { error: () => {} }, setTimeout: () => {},
    fetch: (url, options = {}) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  });
  const script = getDashboardHTML().match(/<script>([\s\S]*)<\/script>/i)[1];
  vm.runInContext(script + '\nthis.ui = { state, reviewState, fetchSummary, fetchOrders, fetchReviews, applyFilters, applyReviewFilters, switchView };', context);
  return { ...context.ui, element, requests };
}

function respond(request, body, status = 200) {
  request.resolve({ status, json: async () => body });
}
function orders(name) {
  return { success: true, data: name ? [{ _id: name, orderNumber: name }] : [], pagination: { currentPage: 1, totalPages: 1, totalCount: name ? 1 : 0, limit: 20 } };
}
function reviews(name, average = 0) {
  return { success: true, data: name ? [{ customerName: name, createdAt: '2026-01-01T00:00:00Z' }] : [], summary: { total: name ? 1 : 0, average, withPhotos: 0, unreplied: 0, distribution: {} }, pagination: { currentPage: 1, totalPages: 1, totalCount: 0 } };
}

module.exports = {
  name: 'dashboard UI request races',
  tests: [
    { name: 'orders apply newer filters while loading and ignore stale successes and errors', fn: async () => {
      const ui = dashboard();
      ui.state.currentView = 'orders';
      const first = ui.fetchOrders();
      ui.element('searchInput').value = 'new';
      ui.element('statusFilter').value = 'completed';
      ui.applyFilters();
      assert.strictEqual(ui.requests.length, 2);
      const query = new URL(ui.requests[1].url, 'https://example.test').searchParams;
      assert.strictEqual(query.get('view'), 'dashboard');
      assert.strictEqual(query.get('search'), 'new');
      assert.strictEqual(query.get('status'), 'completed');
      respond(ui.requests[0], orders('old'));
      await first;
      assert.ok(ui.element('refreshBtn').classList.contains('loading'));
      assert.ok(!ui.element('ordersTableBody').innerHTML.includes('old'));
      respond(ui.requests[1], orders('new'));
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(ui.element('ordersTableBody').innerHTML.includes('new'));
      assert.ok(!ui.element('refreshBtn').classList.contains('loading'));
      const stale = ui.fetchOrders();
      const latest = ui.fetchOrders();
      ui.requests[2].reject(new Error('stale error'));
      await stale;
      assert.ok(!ui.element('toast').classList.contains('show'));
      respond(ui.requests[3], orders(null));
      await latest;
      assert.strictEqual(ui.element('tableCount').textContent, '0 orders');
    } },
    { name: 'reviews apply filters and keep newer data when older requests fail', fn: async () => {
      const ui = dashboard();
      ui.state.currentView = 'reviews';
      const first = ui.fetchReviews();
      ui.element('reviewRating').value = '5';
      ui.element('reviewReplied').value = 'false';
      ui.element('reviewSearch').value = 'cake';
      ui.applyReviewFilters();
      assert.strictEqual(ui.requests.length, 2);
      const query = new URL(ui.requests[1].url, 'https://example.test').searchParams;
      assert.strictEqual(query.get('rating'), '5');
      assert.strictEqual(query.get('replied'), 'false');
      assert.strictEqual(query.get('search'), 'cake');
      respond(ui.requests[1], reviews('new'));
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(ui.requests[0].options.signal.aborted, true);
      ui.requests[0].reject(new Error('stale'));
      await first;
      assert.ok(ui.element('reviewList').innerHTML.includes('new'));
      assert.ok(ui.element('reviewSummary').innerHTML.includes('0.0'));
      assert.strictEqual(ui.reviewState.loading, false);
      const missing = ui.fetchReviews();
      respond(ui.requests[2], reviews(null, undefined));
      await missing;
      assert.ok(ui.element('reviewList').innerHTML.includes('No reviews'));
    } },
    { name: 'review page navigation omits the summary and keeps the last rendered panel', fn: async () => {
      const ui = dashboard();
      ui.state.currentView = 'reviews';
      const first = ui.fetchReviews();
      respond(ui.requests[0], {
        success: true,
        data: [{ customerName: 'page1', createdAt: '2026-01-01T00:00:00Z' }],
        summary: { total: 2, average: 4.5, withPhotos: 1, unreplied: 0, distribution: { 5: 1 } },
        pagination: { currentPage: 1, totalPages: 2, totalCount: 2, hasNextPage: true, hasPrevPage: false }
      });
      await first;
      const panel = ui.element('reviewSummary').innerHTML;
      assert.ok(panel.includes('4.5'));

      ui.element('reviewNext').click();
      assert.strictEqual(ui.requests.length, 2);
      const pageQuery = new URL(ui.requests[1].url, 'https://example.test').searchParams;
      assert.strictEqual(pageQuery.get('page'), '2');
      assert.strictEqual(pageQuery.get('includeSummary'), '0');

      respond(ui.requests[1], {
        success: true,
        data: [{ customerName: 'page2', createdAt: '2026-01-02T00:00:00Z' }],
        pagination: { currentPage: 2, totalPages: 2, totalCount: 2, hasNextPage: false, hasPrevPage: true }
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(ui.element('reviewSummary').innerHTML, panel);
      assert.strictEqual(ui.element('lastUpdate').textContent, '2 reviews stored');
      assert.ok(ui.element('reviewList').innerHTML.includes('page2'));

      const filtered = ui.fetchReviews();
      const filterQuery = new URL(ui.requests[2].url, 'https://example.test').searchParams;
      assert.strictEqual(filterQuery.get('includeSummary'), null);
      respond(ui.requests[2], {
        success: true, data: [],
        summary: { total: 0, average: null, withPhotos: 0, unreplied: 0, distribution: {} },
        pagination: { currentPage: 1, totalPages: 1, totalCount: 0, hasNextPage: false, hasPrevPage: false }
      });
      await filtered;
      assert.ok(ui.element('reviewSummary').innerHTML.includes('>-<'));
    } },
    { name: 'zero and missing values render without breaking the review panel', fn: async () => {
      const ui = dashboard();
      ui.state.currentView = 'reviews';
      const request = ui.fetchReviews();
      respond(ui.requests[0], { success: true, data: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0 }, summary: { total: 0, average: null, withPhotos: 0, unreplied: 0 } });
      await request;
      const panel = ui.element('reviewSummary').innerHTML;
      assert.ok(panel.includes('>0<'));
      assert.ok(panel.includes('>-<'));
      assert.ok(!panel.includes('NaN'));
      assert.ok(!panel.includes('null'));
      assert.ok(ui.element('reviewList').innerHTML.includes('No reviews'));
    } },
    { name: 'orders filters are not mutated by a stale response', fn: async () => {
      const ui = dashboard();
      ui.state.currentView = 'orders';
      ui.state.filters.search = 'wanted';
      const first = ui.fetchOrders();
      ui.state.filters.search = 'latest';
      const second = ui.fetchOrders();
      respond(ui.requests[0], orders('old'));
      await first;
      assert.ok(!ui.element('ordersTableBody').innerHTML.includes('old'));
      respond(ui.requests[1], orders('latest'));
      await second;
      assert.strictEqual(ui.state.filters.search, 'latest');
      assert.ok(ui.element('ordersTableBody').innerHTML.includes('latest'));
    } },
    { name: 'navigation invalidates old responses and summary requests use dashboard projection', fn: async () => {
      const ui = dashboard();
      const first = ui.fetchSummary();
      assert.strictEqual(new URL(ui.requests[0].url, 'https://example.test').searchParams.get('view'), 'dashboard');
      ui.switchView('reviews');
      respond(ui.requests[0], {}, 401);
      await first;
      assert.strictEqual(ui.element('lastUpdate').textContent, '');
      assert.strictEqual(ui.element('reviewList').innerHTML.includes('Loading'), true);
      assert.strictEqual(ui.state.currentView, 'reviews');
      assert.strictEqual(ui.requests.length, 2);
      respond(ui.requests[1], reviews(null, null));
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(ui.element('lastUpdate').textContent, '0 reviews stored');
      const review = ui.fetchReviews();
      ui.switchView('orders');
      respond(ui.requests[2], reviews('old'));
      await review;
      assert.strictEqual(ui.element('lastUpdate').textContent, '0 reviews stored');
    } }
  ]
};
