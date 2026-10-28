// POST /api/auth/forgot-password
//
// The self-hosted Express app has a full reset flow backed by a PasswordReset
// collection. The serverless deployment has no mail transport and no shared
// token store, so advertising a reset it cannot deliver would be worse than
// saying so. The response is identical for every username, so it cannot be used
// to enumerate accounts.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  res.status(501).json({
    success: false,
    message: 'Password reset is not available on this deployment. Change ADMIN_PASSWORD in the environment and redeploy.'
  });
};
