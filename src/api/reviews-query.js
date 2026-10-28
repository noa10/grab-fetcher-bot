/**
 * Review listing shared by the Express route and the Vercel function.
 *
 * The two deployments have different request plumbing but must answer the same
 * questions, so the filter/pagination/summary logic lives here and each entry
 * point only has to parse its query object.
 */
const Feedback = require('../models/Feedback');
const { buildSafeRegexQuery, sanitizeSortOrder } = require('../utils/inputSanitizer');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Clamp a numeric query param, falling back when it is absent or nonsense. */
function toInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Build the Mongo filter for the list.
 *
 * `days` narrows by review date; reviews are an instant (`createdAt`), not a MYT
 * day bucket, so a plain rolling cutoff is correct here — unlike orders.
 */
function buildFilter(query = {}) {
  const filter = {};

  if (query.rating !== undefined && query.rating !== '') {
    const rating = parseInt(query.rating, 10);
    if (rating >= 1 && rating <= 5) filter.rating = rating;
  }

  // Collected into $and: both the reply filter and the search filter need an
  // $or of their own, and assigning them directly would clobber each other.
  const and = [];
  const unrepliedClauses = [
    { merchantReplies: { $size: 0 } },
    { merchantReplies: { $exists: false } }
  ];

  if (query.replied === 'false') {
    and.push({ $or: unrepliedClauses });
  } else if (query.replied === 'true') {
    and.push({ $nor: unrepliedClauses });
  }

  if (query.aspect) {
    // Aspect ids are Grab's own enum (TASTE, PORTION_SIZE, …) — exact match only.
    filter['aspects.aspectId'] = String(query.aspect).toUpperCase();
  }

  const days = parseInt(query.days, 10);
  if (days > 0 && days <= 3650) {
    filter.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
  }

  if (query.search) {
    // Escaped before it reaches Mongo: a review text search must not become a
    // regex injection or a catastrophic backtracking probe.
    const safe = buildSafeRegexQuery(query.search);
    if (Object.keys(safe).length) {
      and.push({
        $or: [
          { description: safe },
          { customerName: safe },
          { orderID: safe }
        ]
      });
    }
  }

  if (and.length) filter.$and = and;
  return filter;
}

/**
 * Header panel for the reviews view.
 *
 * Computed over the date window only, deliberately ignoring the rating/replied/
 * search filters: a distribution that changes when you filter to 5 stars tells
 * you nothing.
 */
async function buildSummary(query = {}) {
  const window = {};
  const days = parseInt(query.days, 10);
  if (days > 0 && days <= 3650) {
    window.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
  }

  const [agg] = await Feedback.aggregate([
    { $match: window },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              average: { $avg: '$rating' },
              withPhotos: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$imageUrls', []] } }, 0] }, 1, 0] } }
            }
          }
        ],
        distribution: [{ $group: { _id: '$rating', count: { $sum: 1 } } }],
        unreplied: [
          {
            $match: {
              $or: [
                { merchantReplies: { $size: 0 } },
                { merchantReplies: { $exists: false } }
              ]
            }
          },
          { $count: 'count' }
        ]
      }
    }
  ]);

  const totals = (agg && agg.totals && agg.totals[0]) || { total: 0, average: null, withPhotos: 0 };
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of (agg && agg.distribution) || []) {
    if (row._id >= 1 && row._id <= 5) distribution[row._id] = row.count;
  }

  return {
    total: totals.total || 0,
    average: totals.average ? Math.round(totals.average * 10) / 10 : null,
    unreplied: (agg && agg.unreplied && agg.unreplied[0] && agg.unreplied[0].count) || 0,
    withPhotos: totals.withPhotos || 0,
    distribution
  };
}

/** Page of reviews plus the summary panel. */
async function listReviews(query = {}) {
  const page = toInt(query.page, 1, 1, 100000);
  const limit = toInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const filter = buildFilter(query);

  // Local whitelist: the shared sanitizeSortField() allowlist is order-shaped and
  // would silently rewrite 'rating' to 'orderTimestamp'.
  const sortField = query.sortBy === 'rating' ? 'rating' : 'createdAt';
  const sortOrder = sanitizeSortOrder(query.sortOrder) === 'asc' ? 1 : -1;
  const sort = sortField === 'rating' ? { rating: sortOrder, createdAt: -1 } : { createdAt: sortOrder };

  const [reviews, total, summary] = await Promise.all([
    Feedback.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .select('reviewID createdAt rating description customerName orderID orderedItems recommendedItems merchantReplies aspects imageUrls serviceType isNewToMerchant')
      .lean(),
    Feedback.countDocuments(filter),
    buildSummary(query)
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data: reviews,
    pagination: {
      currentPage: page,
      totalPages,
      totalCount: total,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    },
    summary
  };
}

module.exports = { listReviews, buildFilter, buildSummary, DEFAULT_LIMIT, MAX_LIMIT };
