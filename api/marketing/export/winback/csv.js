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
  }).catch(error => {
    console.error('Error exporting winback CSV:', error);
    res.status(500).json({ success: false, message: error.message });
  });
};
