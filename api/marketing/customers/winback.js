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
  }).catch(error => {
    console.error('Error fetching winback customers:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
