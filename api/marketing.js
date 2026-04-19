const database = require('../src/config/database');
const Order = require('../src/models/Order');
const Customer = require('../src/models/Customer');
const MarketingCache = require('../src/models/MarketingCache');
const { sanitizeCsvField } = require('../src/utils/inputSanitizer');

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

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function withDatabase(handler) {
  try {
    await database.connect();
    return await handler();
  } finally {
    try { await database.disconnect(); } catch (_) {}
  }
}

// Route handlers
const handlers = {
  async kpis(req, res) {
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
  },

  async rfm(req, res) {
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
      const segments = result.map(item => ({ segment: item._id || 'Other', count: item.count }));
      return { segments };
    });

    res.json({ success: true, data });
  },

  async cohorts(req, res) {
    const data = await getCachedOrCompute('marketing:cohorts', async () => {
      const cohortData = await Order.aggregate([
        { $sort: { orderTimestamp: 1 } },
        {
          $group: {
            _id: {
              $ifNull: [
                { $cond: [{ $eq: ['$customerPhone', ''] }, null, '$customerPhone'] },
                { $ifNull: [
                  { $cond: [{ $eq: ['$customerName', ''] }, null, '$customerName'] },
                  { $concat: ['order:', '$orderNumber'] }
                ] }
              ]
            },
            cohortMonth: { $first: { $dateToString: { format: '%Y-%m', date: '$orderTimestamp' } } },
            orders: { $sum: 1 },
            months: { $addToSet: { $dateToString: { format: '%Y-%m', date: '$orderTimestamp' } } }
          }
        }
      ]);

      const cohortMap = {};
      for (const entry of cohortData) {
        if (!cohortMap[entry.cohortMonth]) {
          cohortMap[entry.cohortMonth] = { cohortMonth: entry.cohortMonth, totalCustomers: 0, monthlyRetention: {} };
        }
        cohortMap[entry.cohortMonth].totalCustomers += 1;
        for (const month of entry.months) {
          if (!cohortMap[entry.cohortMonth].monthlyRetention[month]) {
            cohortMap[entry.cohortMonth].monthlyRetention[month] = 0;
          }
          cohortMap[entry.cohortMonth].monthlyRetention[month] += 1;
        }
      }

      const allCohortMonths = Object.keys(cohortMap).sort().slice(-12);
      const cohorts = allCohortMonths.map(cohortMonth => {
        const cohort = cohortMap[cohortMonth];
        const retention = {};
        const cohortDate = new Date(cohortMonth + '-01');

        for (let i = 0; i < 12; i++) {
          const checkDate = new Date(cohortDate);
          checkDate.setMonth(checkDate.getMonth() + i);
          const checkMonth = checkDate.toISOString().slice(0, 7);
          const customers = cohort.monthlyRetention[checkMonth] || 0;
          retention[checkMonth] = cohort.totalCustomers > 0
            ? parseFloat(((customers / cohort.totalCustomers) * 100).toFixed(2))
            : 0;
        }

        return { cohortMonth, totalCustomers: cohort.totalCustomers, retention };
      });

      return { cohorts };
    });

    res.json({ success: true, data });
  },

  async customersWinback(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      Customer.find({ recencyDays: { $gte: 45, $lte: 90 }, monetary: { $gt: 100 } })
        .sort({ monetary: -1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments({ recencyDays: { $gte: 45, $lte: 90 }, monetary: { $gt: 100 } })
    ]);

    res.json({ success: true, data: { customers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  },

  async customersVip(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const count = await Customer.countDocuments();
    if (count < 10) {
      return res.json({ success: true, data: { customers: [], pagination: { page, limit, total: 0, pages: 0 } } });
    }

    const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
    const threshold = thresholdDoc[0]?.monetary || 0;

    const [customers, total] = await Promise.all([
      Customer.find({ frequency: { $gte: 3 }, monetary: { $gte: threshold } })
        .sort({ monetary: -1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments({ frequency: { $gte: 3 }, monetary: { $gte: threshold } })
    ]);

    res.json({ success: true, data: { customers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  },

  async exportWinbackCsv(req, res) {
    const customers = await Customer.find({ recencyDays: { $gte: 45, $lte: 90 }, monetary: { $gt: 100 } })
      .sort({ monetary: -1 }).limit(5000).lean();

    const csvHeaders = ['Customer Key', 'Name', 'Phone', 'Frequency', 'Monetary', 'Avg Order Value', 'Recency Days', 'Segment'];
    const csvRows = customers.map(c => [
      sanitizeCsvField(c.customerKey || ''), sanitizeCsvField(c.name || ''), c.phone || '',
      c.frequency || 0, c.monetary || 0, c.avgOrderValue || 0, c.recencyDays || 0, sanitizeCsvField(c.segment || '')
    ]);
    const csvContent = [csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="winback-customers-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  },

  async exportWinbackJson(req, res) {
    const customers = await Customer.find({ recencyDays: { $gte: 45, $lte: 90 }, monetary: { $gt: 100 } })
      .sort({ monetary: -1 }).limit(5000).lean();

    const data = customers.map(c => ({
      customerKey: c.customerKey, name: c.name, phone: c.phone, frequency: c.frequency,
      monetary: c.monetary, avgOrderValue: c.avgOrderValue, recencyDays: c.recencyDays,
      segment: c.segment, firstOrder: c.firstOrder, lastOrder: c.lastOrder
    }));

    res.json({ success: true, data, meta: { format: 'json', count: data.length, exportedAt: new Date().toISOString() } });
  },

  async exportVipCsv(req, res) {
    const count = await Customer.countDocuments();
    let threshold = 0;
    if (count >= 10) {
      const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
      threshold = thresholdDoc[0]?.monetary || 0;
    }

    const customers = await Customer.find({ frequency: { $gte: 3 }, monetary: { $gte: threshold } })
      .sort({ monetary: -1 }).limit(5000).lean();

    const csvHeaders = ['Customer Key', 'Name', 'Phone', 'Frequency', 'Monetary', 'Avg Order Value', 'Recency Days', 'Segment'];
    const csvRows = customers.map(c => [
      sanitizeCsvField(c.customerKey || ''), sanitizeCsvField(c.name || ''), c.phone || '',
      c.frequency || 0, c.monetary || 0, c.avgOrderValue || 0, c.recencyDays || 0, sanitizeCsvField(c.segment || '')
    ]);
    const csvContent = [csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="vip-customers-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  },

  async exportVipJson(req, res) {
    const count = await Customer.countDocuments();
    let threshold = 0;
    if (count >= 10) {
      const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
      threshold = thresholdDoc[0]?.monetary || 0;
    }

    const customers = await Customer.find({ frequency: { $gte: 3 }, monetary: { $gte: threshold } })
      .sort({ monetary: -1 }).limit(5000).lean();

    const data = customers.map(c => ({
      customerKey: c.customerKey, name: c.name, phone: c.phone, frequency: c.frequency,
      monetary: c.monetary, avgOrderValue: c.avgOrderValue, recencyDays: c.recencyDays,
      segment: c.segment, firstOrder: c.firstOrder, lastOrder: c.lastOrder
    }));

    res.json({ success: true, data, meta: { format: 'json', count: data.length, exportedAt: new Date().toISOString() } });
  }
};

function route(req) {
  const path = new URL(req.url, `https://${req.headers.host}`).pathname;
  const segments = path.replace(/^\/api\/marketing\/?/, '').split('/').filter(Boolean);

  if (segments.length === 1) {
    const map = { kpis: 'kpis', rfm: 'rfm', cohorts: 'cohorts' };
    return map[segments[0]];
  }
  if (segments[0] === 'customers' && segments[1] === 'winback') return 'customersWinback';
  if (segments[0] === 'customers' && segments[1] === 'vip') return 'customersVip';
  if (segments[0] === 'export' && segments[1] === 'winback' && segments[2] === 'csv') return 'exportWinbackCsv';
  if (segments[0] === 'export' && segments[1] === 'winback' && segments[2] === 'json') return 'exportWinbackJson';
  if (segments[0] === 'export' && segments[1] === 'vip' && segments[2] === 'csv') return 'exportVipCsv';
  if (segments[0] === 'export' && segments[1] === 'vip' && segments[2] === 'json') return 'exportVipJson';

  return null;
}

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
  if (!checkMarketingEnabled()) return res.status(503).json({ success: false, message: 'Marketing analytics is disabled' });

  const handler = route(req);
  if (!handler) return res.status(404).json({ success: false, message: 'Marketing endpoint not found' });

  try {
    await withDatabase(() => handlers[handler](req, res));
  } catch (error) {
    console.error(`Marketing API error [${handler}]:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
};
