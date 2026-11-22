function sanitizeDatabaseHealth(health) {
  const status = health && typeof health.status === 'string' ? health.status : 'unknown';
  return {
    status,
    message: status === 'connected'
      ? (health && typeof health.message === 'string' ? health.message : 'Database connection is healthy')
      : 'Database health check failed'
  };
}

function getMemoryUsage() {
  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external };
}

module.exports = { sanitizeDatabaseHealth, getMemoryUsage };
