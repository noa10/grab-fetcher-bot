const {
  checkMarketingEnabled,
  setCORS, handleOptions, methodNotAllowed, marketingDisabled, withDatabase,
  Customer
} = require('../../_shared');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (handleOptions(req, res)) return;
  if (methodNotAllowed(req, res)) return;

  if (!checkMarketingEnabled()) return marketingDisabled(res);

  await withDatabase(async () => {
    const customers = await Customer.find({
      recencyDays: { $gte: 45, $lte: 90 },
      monetary: { $gt: 100 }
    }).sort({ monetary: -1 }).limit(5000).lean();

    const data = customers.map(c => ({
      customerKey: c.customerKey,
      name: c.name,
      phone: c.phone,
      frequency: c.frequency,
      monetary: c.monetary,
      avgOrderValue: c.avgOrderValue,
      recencyDays: c.recencyDays,
      segment: c.segment,
      firstOrder: c.firstOrder,
      lastOrder: c.lastOrder
    }));

    res.json({
      success: true,
      data,
      meta: { format: 'json', count: data.length, exportedAt: new Date().toISOString() }
    });
  }).catch(error => {
    console.error('Error exporting winback JSON:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
