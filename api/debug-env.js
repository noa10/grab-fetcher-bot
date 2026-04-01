module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'set' : undefined,
    MONGODB_URI: process.env.MONGODB_URI ? 'set' : undefined,
    mongooseReadyState: require('mongoose').connection.readyState,
  });
};
