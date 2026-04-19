const {
  checkMarketingEnabled,
  setCORS, handleOptions, methodNotAllowed, marketingDisabled, withDatabase,
  Customer
} = require('../_shared');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (handleOptions(req, res)) return;
  if (methodNotAllowed(req, res)) return;

  if (!checkMarketingEnabled()) return marketingDisabled(res);

  await withDatabase(async () => {
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
  }).catch(error => {
    console.error('Error fetching VIP customers:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
