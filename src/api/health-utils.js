function sanitizeDatabaseHealth(health) {
  const status = health && typeof health.status === 'string' ? health.status : 'unknown';
  return {
    status,
    message: status === 'connected'
      ? (health && typeof health.message === 'string' ? health.message : 'Database connection is healthy')
      : 'Database health check failed'
  };
}

module.exports = { sanitizeDatabaseHealth };
