const {
  checkMarketingEnabled,
  setCORS, handleOptions, methodNotAllowed, marketingDisabled, withDatabase,
  Customer
} = require('../../_shared');
const { sanitizeCsvField } = require('../../../../src/utils/inputSanitizer');

module.exports = async (req, res) => {
  setCORS(req, res);
  if (handleOptions(req, res)) return;
  if (methodNotAllowed(req, res)) return;

  if (!checkMarketingEnabled()) return marketingDisabled(res);

  await withDatabase(async () => {
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
  }).catch(error => {
    console.error('Error exporting VIP CSV:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
