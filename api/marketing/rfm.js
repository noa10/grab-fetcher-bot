const {
  checkMarketingEnabled, getCachedOrCompute,
  setCORS, handleOptions, methodNotAllowed, marketingDisabled, withDatabase,
  Customer
} = require('./_shared');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (handleOptions(req, res)) return;
  if (methodNotAllowed(req, res)) return;

  if (!checkMarketingEnabled()) return marketingDisabled(res);

  await withDatabase(async () => {
    const details = req.query.details === 'true';
    const cacheKey = details ? 'marketing:rfm:details' : 'marketing:rfm';

    const data = await getCachedOrCompute(cacheKey, async () => {
      if (details) {
        const customers = await Customer.find().lean();
        const segments = {};
        for (const customer of customers) {
          const seg = customer.segment || 'Other';
          if (!segments[seg]) segments[seg] = [];
          segments[seg].push(customer);
        }
        return { segments };
      }

      const result = await Customer.aggregate([
        { $group: { _id: '$segment', count: { $sum: 1 } } }
      ]);

      const segments = result.map(item => ({
        segment: item._id || 'Other',
        count: item.count
      }));

      return { segments };
    });

    res.json({ success: true, data });
  }).catch(error => {
    console.error('Error fetching RFM data:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
