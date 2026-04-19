// Shared utilities for marketing Vercel serverless functions
const database = require('../../src/config/database');
const Customer = require('../../src/models/Customer');
const MarketingCache = require('../../src/models/MarketingCache');

const rebuildMutex = { promise: null };

function checkMarketingEnabled() {
  return process.env.ENABLE_MARKETING_ANALYTICS === 'true';
}

async function getCachedOrCompute(cacheKey, computeFn) {
  const cached = await MarketingCache.findOne({ cacheKey, expiresAt: { $gt: new Date() } });
  if (cached) return cached.data;

  if (!rebuildMutex.promise) {
    rebuildMutex.promise = Customer.buildCustomerCollection().finally(() => { rebuildMutex.promise = null; });
  }
  await rebuildMutex.promise;

  const data = await computeFn();
  await MarketingCache.findOneAndUpdate(
    { cacheKey },
    { data, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    { upsert: true, new: true }
  );
  return data;
}

function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

function methodNotAllowed(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return true;
  }
  return false;
}

function marketingDisabled(res) {
  res.status(503).json({ success: false, message: 'Marketing analytics is disabled' });
}

async function withDatabase(handler) {
  try {
    await database.connect();
    return await handler();
  } finally {
    try { await database.disconnect(); } catch (_) {}
  }
}

module.exports = {
  checkMarketingEnabled,
  getCachedOrCompute,
  setCORS,
  handleOptions,
  methodNotAllowed,
  marketingDisabled,
  withDatabase,
  database,
  Customer,
  MarketingCache
};
