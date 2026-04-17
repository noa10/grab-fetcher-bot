function escapeRegex(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALLOWED_SORT_FIELDS = [
  'orderDate', 'orderNumber', 'totalPrice', 'total', 'customer',
  'driver', 'status', 'createdAt', 'updatedAt', 'orderTimestamp'
];
const ALLOWED_SORT_ORDERS = ['asc', 'desc', '1', '-1'];

function sanitizeSortField(field) {
  if (typeof field !== 'string') return 'orderTimestamp';
  return ALLOWED_SORT_FIELDS.includes(field) ? field : 'orderTimestamp';
}

function sanitizeSortOrder(order) {
  if (typeof order !== 'string') return 'desc';
  return ALLOWED_SORT_ORDERS.includes(order.toLowerCase()) ? order.toLowerCase() : 'desc';
}

function buildSafeRegexQuery(searchTerm) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return {};
  }
  const escaped = escapeRegex(searchTerm);
  return { $regex: escaped, $options: 'i' };
}

function sanitizeCsvField(field) {
  if (typeof field !== 'string') return field;
  let sanitized = field.replace(/[\r\n\t]/g, ' ');
  if (/^[=+\-@\s]/.test(sanitized)) {
    return "'" + sanitized;
  }
  return sanitized;
}

module.exports = {
  escapeRegex,
  sanitizeSortField,
  sanitizeSortOrder,
  buildSafeRegexQuery,
  sanitizeCsvField
};
