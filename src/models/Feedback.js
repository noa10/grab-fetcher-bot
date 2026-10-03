const mongoose = require('mongoose');

/**
 * A Grab customer review ("pax review") from the Feedback > Ratings and reviews tab.
 *
 * Sourced from POST /food/merchant/v1/feedback/reviews rather than the DOM. See
 * the grab-fetcher-bot-runbook skill for the endpoint contract.
 *
 * KEY GOTCHA — `reviewAspects[].verdict` is NOT a rating and has NO numeric
 * scale. Measured across 124 stored reviews (2026-10-03), only three values
 * occur, and they mean different things depending on `source`:
 *
 *   source = SELECTED_BY_PAX     verdict =  1   the pax ticked this aspect as good
 *   source = SELECTED_BY_PAX     verdict = -1   the pax ticked this aspect as bad
 *   source = DETECTED_FROM_REVIEW verdict =  0   Grab's NLP merely MENTIONED the
 *                                                 aspect in the text; `reason`
 *                                                 holds the quoted fragment
 *
 * So `verdict` is tri-state within its source and carries no ordering between
 * sources. Anything that tries to average it — or map it onto the 1-5 star
 * scale — is wrong. The usable signals are the derived `sentiment` field and
 * the `mentions` count, both set in FeedbackService.toDocument.
 */

const aspectSchema = new mongoose.Schema({
  aspectId: { type: String, required: true, trim: true },
  aspectName: { type: String, trim: true, default: '' },
  // Raw Grab value. NOT a 1-5 rating — see the schema note. Only 1, -1 and 0
  // have been observed; anything else is preserved verbatim rather than coerced.
  verdict: { type: Number, default: null },
  // Derived, and the only aspect field safe to aggregate on:
  //   'positive' | 'negative' | 'mentioned' | null
  // 'mentioned' means Grab's NLP flagged the topic in the text without any
  // sentiment — it must not be counted as praise or as a complaint.
  sentiment: {
    type: String,
    enum: ['positive', 'negative', 'mentioned', null],
    default: null
  },
  source: { type: String, trim: true, default: '' },
  // For DETECTED_FROM_REVIEW this is the quoted fragment that triggered the
  // match; empty for SELECTED_BY_PAX.
  reason: { type: String, trim: true, default: '' }
}, { _id: false });

const replySchema = new mongoose.Schema({
  repliedAt: { type: Date, default: null },
  replyText: { type: String, trim: true, default: '' }
}, { _id: false });

const feedbackSchema = new mongoose.Schema({
  // Stable, unique per review. This is the dedup key — it is the one identifier
  // in the payload guaranteed unique, unlike orderID which can repeat.
  // Uniqueness is declared in the compound index below, not here, so the
  // unique option is not shadowed by a duplicate plain index.
  reviewID: {
    type: String,
    required: true,
    trim: true
  },

  // The Grab order this review belongs to. Not unique and not always populated.
  orderID: {
    type: String,
    trim: true,
    default: ''
  },

  // Overall star rating, 1-5. Distinct from aspects[].verdict — see schema note.
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },

  description: {
    type: String,
    trim: true,
    default: ''
  },

  // The Grab review's own creation time (NOT the document's insert time). This is
  // the field every windowed aggregate sorts and filters on.
  //
  // Declared with `timestamps: true` below, which would normally own createdAt —
  // but Mongoose only sets it when the value is unset, so passing Grab's own
  // timestamp here is preserved rather than overwritten with scrape time. That
  // distinction is load-bearing: overwriting it would break every date-range
  // query in this file.
  //
  // No field-level `index: true`: the descending index is declared once via
  // feedbackSchema.index below. Every query here sorts by -1, so an ascending
  // index would never be chosen.
  createdAt: {
    type: Date,
    required: true
  },

  contentLastModifiedAt: { type: Date, default: null },
  paxLastUpdatedAt: { type: Date, default: null },

  customerName: {
    type: String,
    trim: true,
    default: ''
  },

  merchantName: {
    type: String,
    trim: true,
    default: ''
  },

  merchantID: {
    type: String,
    index: true,
    trim: true,
    default: ''
  },

  serviceType: {
    type: String,
    trim: true,
    default: 'DELIVERY'
  },

  status: {
    type: String,
    trim: true,
    default: 'PUBLIC'
  },

  orderedItems: [{ type: String, trim: true }],
  recommendedItems: [{ type: String, trim: true }],
  imageUrls: [{ type: String, trim: true }],

  // Grab returns reviewReplies as [null] when there is no merchant reply.
  merchantReplies: [replySchema],

  aspects: [aspectSchema],

  // Grab's `isNew` flag. Renamed from isNew because Mongoose reserves that
  // pathname and warns it may break functionality.
  isNewToMerchant: { type: Boolean, default: false },
  isReportedBefore: { type: Boolean, default: false },
  shouldDisplaySeeTranslation: { type: Boolean, default: false },

  fetchedAt: { type: Date, default: Date.now, index: true },
  lastUpdated: { type: Date, default: Date.now },

  // SHA-256 over the mutable payload, used to skip no-op writes on re-runs so
  // `updatedAt` stays a truthful "content last changed" signal. Set by
  // FeedbackRunner.saveReviews, not by toDocument.
  contentHash: { type: String, default: '', index: true },

  source: {
    type: String,
    default: 'grab-merchant-portal-feedback-api'
  },

  // Raw payload, kept for debugging and so a future field addition does not
  // require another full scrape to recover it.
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'feedback'
});

feedbackSchema.index({ reviewID: 1 }, { unique: true });
feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ rating: 1, createdAt: -1 });
feedbackSchema.index({ orderID: 1 });

/**
 * Reviews that can be joined to a stored order.
 *
 * Verified 2026-10-03: `orderID` here is the SAME identifier as `Order.longOrderId`
 * (format 11 digits, dash, 14 uppercase alphanumerics — e.g.
 * `00167904465-C74KL7AAPE6ULJ`). It is NOT the GF-xxxx order number, which lives
 * in Order.orderNumber. 22 of 124 stored reviews matched a stored order; the low
 * coverage is expected, not a bug — reviews go back to 2023 while the orders
 * collection only holds recent history.
 */
feedbackSchema.statics.findJoinableToOrders = function(limit = 500) {
  return this.find({ orderID: { $nin: ['', null] } })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/** Reviews with no merchant reply yet — the actionable queue. */
feedbackSchema.statics.findUnreplied = function() {
  return this.find({
    $or: [
      { merchantReplies: { $size: 0 } },
      { merchantReplies: { $exists: false } }
    ]
  }).sort({ createdAt: -1 });
};

/** Lowest-rated reviews first — where the damage is. */
feedbackSchema.statics.findLowRated = function(maxRating = 3, limit = 50) {
  return this.find({ rating: { $lte: maxRating } })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/**
 * Average rating over a trailing window.
 *
 * Unlike the orders code this needs no MYT handling: reviews are an instant
 * (`createdAt`), not a day-bucketed record, so a plain instant comparison is
 * correct.
 */
feedbackSchema.statics.getAverageRating = function(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
};

/** Rating distribution (count per score) over a trailing window. */
feedbackSchema.statics.getRatingDistribution = function(days = 365) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
};

/**
 * Aspect complaint leaderboard — the actionable "what are customers unhappy
 * about" query.
 *
 * Counts only explicitly NEGATIVE verdicts from the customer
 * (SELECTED_BY_PAX verdict -1). `mentioned` aspects are excluded: Grab's NLP
 * flags a topic whenever the text touches it, and counting a neutral mention
 * as a complaint would rank "Taste" worst simply because people talk about
 * taste — which is the opposite of what this query is for.
 */
feedbackSchema.statics.getWorstAspects = function(days = 365, limit = 10) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $unwind: '$aspects' },
    { $match: { 'aspects.sentiment': 'negative' } },
    {
      $group: {
        _id: { id: '$aspects.aspectId', name: '$aspects.aspectName' },
        complaints: { $sum: 1 },
        // Mean star rating of the reviews that complained about this aspect —
        // shows how bad those specific complaints were.
        avgReviewRating: { $avg: '$rating' }
      }
    },
    { $sort: { complaints: -1 } },
    { $limit: limit }
  ]);
};

/**
 * Full aspect sentiment breakdown, so praise and complaint counts sit side by
 * side per aspect.
 */
feedbackSchema.statics.getAspectSentimentBreakdown = function(days = 365) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $unwind: '$aspects' },
    {
      $group: {
        _id: '$aspects.aspectName',
        positive: { $sum: { $cond: [{ $eq: ['$aspects.sentiment', 'positive'] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $eq: ['$aspects.sentiment', 'negative'] }, 1, 0] } },
        mentioned: { $sum: { $cond: [{ $eq: ['$aspects.sentiment', 'mentioned'] }, 1, 0] } }
      }
    },
    { $sort: { negative: -1 } }
  ]);
};

feedbackSchema.methods.hasMerchantReply = function() {
  return Array.isArray(this.merchantReplies) && this.merchantReplies.length > 0;
};

feedbackSchema.methods.toExportFormat = function() {
  return {
    reviewID: this.reviewID,
    orderID: this.orderID,
    rating: this.rating,
    description: this.description,
    customerName: this.customerName,
    createdAt: this.createdAt,
    merchantName: this.merchantName,
    recommendedItems: this.recommendedItems,
    aspects: this.aspects.map(a => `${a.aspectName}: ${a.sentiment || 'n/a'}`).join('; '),
    replied: this.hasMerchantReply(),
    fetchedAt: this.fetchedAt
  };
};

const Feedback = mongoose.model('Feedback', feedbackSchema);

module.exports = Feedback;
