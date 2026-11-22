const assert = require('assert');
const Feedback = require('../src/models/Feedback');
const database = require('../src/config/database');
const auth = require('../src/api/serverless-auth');
const { listReviews } = require('../src/api/reviews-query');

async function runCase(includeSummary) {
  const original = { find: Feedback.find, countDocuments: Feedback.countDocuments, aggregate: Feedback.aggregate };
  const calls = { aggregate: 0, skip: null, limit: null };
  try {
    Feedback.find = () => ({
      sort() { return this; }, skip(value) { calls.skip = value; return this; },
      limit(value) { calls.limit = value; return this; }, select() { return this; },
      lean: async () => [{ reviewID: 'r1' }]
    });
    Feedback.countDocuments = async () => 21;
    Feedback.aggregate = async () => { calls.aggregate++; return [{
      totals: [{ total: 21, average: 4.26, withPhotos: 3 }],
      distribution: [{ _id: 5, count: 10 }, { _id: 1, count: 1 }],
      unreplied: [{ count: 4 }]
    }]; };
    const query = { page: '2', limit: '10', days: '30',
      ...(includeSummary ? {} : { includeSummary: '0' }) };
    const result = await listReviews(query);
    assert.deepStrictEqual(result.data, [{ reviewID: 'r1' }]);
    assert.deepStrictEqual(result.pagination, { currentPage: 2, totalPages: 3, totalCount: 21,
      limit: 10, hasNextPage: true, hasPrevPage: true });
    assert.strictEqual(calls.skip, 10);
    assert.strictEqual(calls.limit, 10);
    assert.strictEqual(calls.aggregate, includeSummary ? 1 : 0);
    if (includeSummary) {
      assert.deepStrictEqual(result.summary, { total: 21, average: 4.3, unreplied: 4, withPhotos: 3,
        distribution: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 10 } });
    } else {
      assert.strictEqual(Object.hasOwn(result, 'summary'), false);
    }
  } finally {
    Feedback.find = original.find;
    Feedback.countDocuments = original.countDocuments;
    Feedback.aggregate = original.aggregate;
  }
}

async function runEntryPoint(deployment) {
  const original = { find: Feedback.find, countDocuments: Feedback.countDocuments, aggregate: Feedback.aggregate,
    connect: database.connect, secret: process.env.SESSION_SECRET };
  const calls = { aggregate: 0 };
  try {
    process.env.SESSION_SECRET = 'local-test-secret';
    database.connect = async () => {};
    Feedback.find = () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; },
      select() { return this; }, lean: async () => [] });
    Feedback.countDocuments = async () => 0;
    Feedback.aggregate = async () => { calls.aggregate++; return []; };
    const query = { includeSummary: '0' };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }, setHeader() {} };
    if (deployment === 'express') {
      const router = require('../src/api/routes/feedback');
      await router.stack.find(layer => layer.route?.path === '/').route.stack[0].handle({ query }, res);
    } else {
      const handler = require('../api/feedback');
      const denied = { statusCode: 200, status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }, setHeader() {} };
      await handler({ method: 'GET', url: '/api/feedback', headers: {}, query }, denied);
      assert.strictEqual(denied.statusCode, 401);
      const token = auth.issueSession({ setHeader() {} }, { _id: 'local', username: 'local' });
      await handler({ method: 'GET', headers: { cookie: `gf_session=${token}` }, query }, res);
    }
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(Object.hasOwn(res.body, 'summary'), false);
    assert.strictEqual(calls.aggregate, 0);
  } finally {
    Feedback.find = original.find;
    Feedback.countDocuments = original.countDocuments;
    Feedback.aggregate = original.aggregate;
    database.connect = original.connect;
    if (original.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original.secret;
  }
}

module.exports = { name: 'reviews summary opt-out', tests: [
  { name: 'default keeps the summary and its aggregation', fn: () => runCase(true) },
  { name: 'includeSummary=0 keeps pagination but skips the summary query', fn: () => runCase(false) },
  { name: 'Express route forwards includeSummary=0 and omits summary', fn: () => runEntryPoint('express') },
  { name: 'serverless route forwards includeSummary=0 and omits summary', fn: () => runEntryPoint('serverless') }
] };
