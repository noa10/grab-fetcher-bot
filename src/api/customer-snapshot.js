// Customer aggregation uses $merge in place. The marker records a completed
// initial build, but cannot make reads atomic or coordinate writers across hosts.
module.exports = function createCustomerSnapshot(Customer, MarketingCache) {
  const key = { cacheKey: 'marketing:customers:snapshot' };
  let rebuilding;
  let ensuring;

  async function rebuildCustomers() {
    if (!rebuilding) {
      rebuilding = (async () => {
        const marker = await MarketingCache.findOne(key);
        if (!marker && !await Customer.exists({})) {
          // Leave a durable record if a first build fails after partial writes.
          await MarketingCache.findOneAndUpdate(key, {
            $setOnInsert: { data: { state: 'initializing' } }
          }, { upsert: true });
        }
        await Customer.buildCustomerCollection();
        await MarketingCache.findOneAndUpdate(key, {
          $set: { data: { state: 'completed', completedAt: new Date() } },
          $unset: { expiresAt: 1 }
        }, { upsert: true });
      })().finally(() => { rebuilding = null; });
    }
    return rebuilding;
  }

  async function ensureCustomerSnapshot() {
    if (!ensuring) {
      ensuring = (async () => {
        const marker = await MarketingCache.findOne(key);
        if (marker && marker.data?.state !== 'initializing') return;
        if (!marker && await Customer.exists({})) {
          // Existing installations previously served these rows directly.
          // Recheck in case an initial build began while checking for rows.
          const latest = await MarketingCache.findOne(key);
          if (!latest || latest.data?.state !== 'initializing') return;
        }
        await rebuildCustomers();
      })().finally(() => { ensuring = null; });
    }
    return ensuring;
  }

  return { rebuildCustomers, ensureCustomerSnapshot };
};
