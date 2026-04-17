const mongoose = require('mongoose');

const marketingCacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    trim: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

marketingCacheSchema.index({ cacheKey: 1 }, { unique: true });
marketingCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const MarketingCache = mongoose.model('MarketingCache', marketingCacheSchema, 'marketingcaches');

module.exports = MarketingCache;
