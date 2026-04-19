const Order = require('../../src/models/Order');
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
    const malaysiaTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
    const todayMYT = new Date(malaysiaTime);
    const monthStartMYT = new Date(todayMYT.getFullYear(), todayMYT.getMonth(), 1);

    const data = await getCachedOrCompute('marketing:kpis', async () => {
      const [kpiResult, activeCustomersResult, repeatRateResult, clvResult, segmentResult] = await Promise.all([
        Order.aggregate([
          { $match: { orderTimestamp: { $gte: monthStartMYT } } },
          { $group: { _id: null, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 }, aov: { $avg: '$pricing.total' } } }
        ]),
        Order.aggregate([
          { $match: { orderTimestamp: { $gte: monthStartMYT } } },
          { $group: { _id: { $ifNull: [{ $cond: [{ $eq: ['$customerPhone', ''] }, null, '$customerPhone'] }, ({ $ifNull: [{ $cond: [{ $eq: ['$customerName', ''] }, null, '$customerName'] }, { $concat: ['order:', '$orderNumber'] }] })] } } },
          { $group: { _id: null, activeCustomers: { $sum: 1 } } }
        ]),
        Customer.aggregate([
          { $match: { frequency: { $gte: 2 } } },
          { $group: { _id: null, count: { $sum: 1 } } }
        ]),
        Customer.aggregate([
          { $group: { _id: null, clv: { $avg: '$monetary' } } }
        ]),
        Customer.aggregate([
          { $group: { _id: '$segment', count: { $sum: 1 } } }
        ])
      ]);

      const kpi = kpiResult[0] || {};
      const activeCust = activeCustomersResult[0] || {};
      const repeatR = repeatRateResult[0] || {};
      const clvR = clvResult[0] || {};

      const totalCustomers = await Customer.countDocuments();
      const repeatRate = totalCustomers > 0 ? ((repeatR.count || 0) / totalCustomers * 100).toFixed(2) : 0;

      const segmentMap = {};
      for (const s of segmentResult) segmentMap[s._id || 'Other'] = s.count;

      return {
        totalCustomers,
        avgOrderValue: kpi.aov || 0,
        repeatRate: parseFloat(repeatRate),
        championCount: segmentMap['Champions'] || 0,
        atRiskCount: segmentMap['At-Risk'] || 0,
        lostCount: segmentMap['Lost'] || 0,
        revenue: kpi.revenue || 0,
        activeCustomers: activeCust.activeCustomers || 0,
        orders: kpi.orders || 0,
        clv: clvR.clv || 0
      };
    });

    res.json({ success: true, data });
  }).catch(error => {
    console.error('Error fetching marketing KPIs:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
