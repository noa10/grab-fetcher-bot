const {
  checkMarketingEnabled, getCachedOrCompute,
  setCORS, handleOptions, methodNotAllowed, marketingDisabled, withDatabase
} = require('./_shared');
const Order = require('../../src/models/Order');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (handleOptions(req, res)) return;
  if (methodNotAllowed(req, res)) return;

  if (!checkMarketingEnabled()) return marketingDisabled(res);

  await withDatabase(async () => {
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
  }).catch(error => {
    console.error('Error fetching cohort data:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
