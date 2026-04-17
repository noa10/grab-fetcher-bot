const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const Order = require('../../models/Order');
const Customer = require('../../models/Customer');
const MarketingCache = require('../../models/MarketingCache');
const { sanitizeCsvField } = require('../../utils/inputSanitizer');
const logger = require('../../utils/logger');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId || req.ip,
  validate: false
});

router.use(apiLimiter);

const rebuildMutex = { promise: null };

const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many export requests. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

function checkMarketingEnabled(req, res) {
  if (process.env.ENABLE_MARKETING_ANALYTICS !== 'true') {
    return res.status(503).json({ success: false, message: 'Marketing analytics is disabled' });
  }
  return null;
}

// GET /kpis
router.get('/kpis', async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

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
  } catch (error) {
    logger.error('Error fetching marketing KPIs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /rfm
router.get('/rfm', async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

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
  } catch (error) {
    logger.error('Error fetching RFM data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /cohorts
router.get('/cohorts', async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

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
            cohortMonth: {
              $first: { $dateToString: { format: '%Y-%m', date: '$orderTimestamp' } }
            },
            orders: { $sum: 1 },
            months: {
              $addToSet: { $dateToString: { format: '%Y-%m', date: '$orderTimestamp' } }
            }
          }
        }
      ]);

      // Group by cohortMonth
      const cohortMap = {};
      for (const entry of cohortData) {
        if (!cohortMap[entry.cohortMonth]) {
          cohortMap[entry.cohortMonth] = {
            cohortMonth: entry.cohortMonth,
            totalCustomers: 0,
            monthlyRetention: {}
          };
        }
        cohortMap[entry.cohortMonth].totalCustomers += 1;

        for (const month of entry.months) {
          if (!cohortMap[entry.cohortMonth].monthlyRetention[month]) {
            cohortMap[entry.cohortMonth].monthlyRetention[month] = 0;
          }
          cohortMap[entry.cohortMonth].monthlyRetention[month] += 1;
        }
      }

      // Compute retention rates and limit to last 12 months
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

        return {
          cohortMonth,
          totalCustomers: cohort.totalCustomers,
          retention
        };
      });

      return { cohorts };
    });

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching cohort data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /customers/winback
router.get('/customers/winback', async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      Customer.find({
        recencyDays: { $gte: 45, $lte: 90 },
        monetary: { $gt: 100 }
      }).sort({ monetary: -1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments({
        recencyDays: { $gte: 45, $lte: 90 },
        monetary: { $gt: 100 }
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        customers,
        pagination: { page, limit, total, pages: totalPages }
      }
    });
  } catch (error) {
    logger.error('Error fetching winback customers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /customers/vip
router.get('/customers/vip', async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const count = await Customer.countDocuments();
    if (count < 10) {
      return res.json({
        success: true,
        data: {
          customers: [],
          pagination: { page, limit, total: 0, pages: 0 }
        }
      });
    }

    const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
    const threshold = thresholdDoc[0]?.monetary || 0;

    const [customers, total] = await Promise.all([
      Customer.find({
        frequency: { $gte: 3 },
        monetary: { $gte: threshold }
      }).sort({ monetary: -1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments({
        frequency: { $gte: 3 },
        monetary: { $gte: threshold }
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        customers,
        pagination: { page, limit, total, pages: totalPages }
      }
    });
  } catch (error) {
    logger.error('Error fetching VIP customers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /export/winback/csv
router.get('/export/winback/csv', exportLimiter, async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

    const customers = await Customer.find({
      recencyDays: { $gte: 45, $lte: 90 },
      monetary: { $gt: 100 }
    }).sort({ monetary: -1 }).limit(5000).lean();

    const csvHeaders = [
      'Customer Key', 'Name', 'Phone', 'Frequency', 'Monetary',
      'Avg Order Value', 'Recency Days', 'Segment'
    ];

    const csvRows = customers.map(c => [
      sanitizeCsvField(c.customerKey || ''),
      sanitizeCsvField(c.name || ''),
      c.phone || '',
      c.frequency || 0,
      c.monetary || 0,
      c.avgOrderValue || 0,
      c.recencyDays || 0,
      sanitizeCsvField(c.segment || '')
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field).join(','))
    ].join('\n');

    const filename = `winback-customers-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

    logger.export(`Winback CSV export: ${customers.length} customers`);
  } catch (error) {
    logger.error('Error exporting winback CSV:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /export/winback/json
router.get('/export/winback/json', exportLimiter, async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

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

    logger.export(`Winback JSON export: ${data.length} customers`);
  } catch (error) {
    logger.error('Error exporting winback JSON:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /export/vip/csv
router.get('/export/vip/csv', exportLimiter, async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

    const count = await Customer.countDocuments();
    let threshold = 0;

    if (count >= 10) {
      const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
      threshold = thresholdDoc[0]?.monetary || 0;
    }

    const customers = await Customer.find({
      frequency: { $gte: 3 },
      monetary: { $gte: threshold }
    }).sort({ monetary: -1 }).limit(5000).lean();

    const csvHeaders = [
      'Customer Key', 'Name', 'Phone', 'Frequency', 'Monetary',
      'Avg Order Value', 'Recency Days', 'Segment'
    ];

    const csvRows = customers.map(c => [
      sanitizeCsvField(c.customerKey || ''),
      sanitizeCsvField(c.name || ''),
      c.phone || '',
      c.frequency || 0,
      c.monetary || 0,
      c.avgOrderValue || 0,
      c.recencyDays || 0,
      sanitizeCsvField(c.segment || '')
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field).join(','))
    ].join('\n');

    const filename = `vip-customers-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

    logger.export(`VIP CSV export: ${customers.length} customers`);
  } catch (error) {
    logger.error('Error exporting VIP CSV:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /export/vip/json
router.get('/export/vip/json', exportLimiter, async (req, res) => {
  try {
    const disabled = checkMarketingEnabled(req, res);
    if (disabled) return;

    const count = await Customer.countDocuments();
    let threshold = 0;

    if (count >= 10) {
      const thresholdDoc = await Customer.find().sort({ monetary: -1 }).skip(Math.floor(count * 0.9)).limit(1).lean();
      threshold = thresholdDoc[0]?.monetary || 0;
    }

    const customers = await Customer.find({
      frequency: { $gte: 3 },
      monetary: { $gte: threshold }
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

    logger.export(`VIP JSON export: ${data.length} customers`);
  } catch (error) {
    logger.error('Error exporting VIP JSON:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
