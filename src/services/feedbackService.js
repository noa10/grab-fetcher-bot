const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');

/**
 * Fetches Grab customer reviews ("pax reviews") from the merchant Feedback tab.
 *
 * This talks to the portal's own JSON API rather than scraping the DOM. The
 * Feedback page is a client-rendered SPA whose visible rows are paginated
 * client-side, so DOM scraping would mean walking 7 pages of a table that the
 * browser has already sliced out of a single response. Calling the API gets the
 * whole set in one round of nextToken pagination.
 *
 * See the grab-fetcher-bot-runbook skill for the verified endpoint contract.
 *
 * AUTH MODEL — the important subtlety:
 *   - GET  feedback/overview needs no CSRF token; a credentialed fetch works.
 *   - POST feedback/reviews REQUIRES an `x-csrf-token` header. Without it the
 *     API returns 403 with a {target, reason, message} body. That 403 looks
 *     exactly like a credentials problem, so this class distinguishes them.
 *   - The token is in NO cookie (not even httpOnly) and in no localStorage key.
 *     It exists only in the header of the SPA's own XHR. So we visit
 *     /feedback, watch the app make its request, and lift the token off it.
 *     Re-implementing the token derivation would be reverse-engineering a
 *     rotating scheme for no benefit.
 */

const FEEDBACK_API_BASE = 'https://api.grab.com/food/merchant/v1/feedback';
const FEEDBACK_PAGE_URL = 'https://merchant.grab.com/feedback';

/**
 * Store id used by the feedback API. This is the STORE id (Mad Krapow - Subang
 * Permai), not the master account id in localStorage.merchantSelector
 * (MYMG20230315032033018448, "BAKARIS ENTERPRISE") — they are different
 * identifiers and the master id is rejected by the API.
 *
 * Hardcoded because there is only one store. When a second store is added this
 * must become a list, and the ids have to be read off the portal — they cannot
 * be derived from the merchantSelector entry.
 */
const DEFAULT_MERCHANT_ID = '1-C36JLBD2PFD3LA';
const DEFAULT_MERCHANT_NAME = 'Mad Krapow - Subang Permai';

// Grab returns 20 per page and hands back a nextToken until exhausted.
const PAGE_SIZE_HINT = 20;
// Safety stop so a nextToken that never terminates cannot hang the runner.
const MAX_PAGES = 200;

class FeedbackService {
  /**
   * @param {import('puppeteer').Page} page Authenticated page on the portal.
   * @param {object} [options]
   * @param {string} [options.merchantId] Store id (see DEFAULT_MERCHANT_ID note).
   */
  constructor(page, options = {}) {
    this.page = page;
    this.merchantId = options.merchantId || process.env.GRAB_STORE_ID || DEFAULT_MERCHANT_ID;
    this.merchantName = options.merchantName || DEFAULT_MERCHANT_NAME;
    this.serviceType = options.serviceType || 'DELIVERY';
    this.csrfToken = null;
  }

  /**
   * Load /feedback and capture the x-csrf-token off the app's own XHR.
   *
   * Must run before fetchReviews(). Safe to call repeatedly: the token is only
   * captured once per instance, so an unchanged token is not re-fetched.
   */
  async captureCsrfToken() {
    if (this.csrfToken) return this.csrfToken;

    if (!this.page) {
      throw new Error('FeedbackService requires an authenticated page');
    }

    // The SPA fires feedback/reviews itself on load. Capture that request's
    // headers rather than guessing at the token's derivation.
    let captured = null;
    const onRequest = (req) => {
      if (
        req.method() === 'POST' &&
        req.url().includes('/feedback/reviews')
      ) {
        const headers = req.headers();
        if (headers['x-csrf-token']) {
          captured = headers;
        }
      }
    };
    this.page.on('request', onRequest);

    try {
      await this.page.goto(FEEDBACK_PAGE_URL, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await sleep(6000);

      // If the request was missed, fall back to clicking the sidebar item —
      // a cached SPA can skip the fetch entirely on a warm navigation.
      if (!captured) {
        logger.feedback('CSRF token not seen on direct load, retrying via sidebar');
        await this.page.evaluate(() => {
          const item = [...document.querySelectorAll('.sidebar-menu-item-title')]
            .find(e => e.textContent.trim() === 'Feedback');
          item?.closest('li')?.click?.();
        });
        await sleep(6000);
      }

      if (!captured) {
        throw new Error(
          'Could not capture x-csrf-token from the portal Feedback page. ' +
          'The page markup or request signature may have changed.'
        );
      }

      this.csrfToken = captured['x-csrf-token'];
      logger.feedback('CSRF token captured from portal request');
      return this.csrfToken;
    } finally {
      this.page.off('request', onRequest);
    }
  }

  /** Headers the reviews endpoint requires. */
  buildHeaders() {
    if (!this.csrfToken) {
      throw new Error('CSRF token not captured — call captureCsrfToken() first');
    }
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      'x-csrf-token': this.csrfToken,
      merchantid: this.merchantId,
      requestsource: 'troyPortal',
      referer: 'https://merchant.grab.com/'
    };
  }

  /**
   * Fetch every review in a window, following nextToken to exhaustion.
   *
   * @param {object} [options]
   * @param {Date} [options.startDate] Defaults to 90 days ago (portal default).
   * @param {Date} [options.endDate] Defaults to now.
   * @returns {Promise<Array>} Raw review objects as Grab returned them.
   */
  async fetchReviews(options = {}) {
    await this.captureCsrfToken();

    const endDate = options.endDate || new Date();
    const startDate = options.startDate || new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);

    const all = [];
    const seen = new Set();
    let body = {
      serviceType: this.serviceType,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      merchantIDs: [this.merchantId],
      businessTypeFilter: 0,
      include_empty_reviews: false
    };

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const result = await this.page.evaluate(async (args) => {
        const { url, headers, body } = args;
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body)
        });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* non-JSON error body */ }
        return { status: r.status, json, text: text.substring(0, 500) };
      }, { url: `${FEEDBACK_API_BASE}/reviews`, headers: this.buildHeaders(), body });

      if (result.status === 403) {
        // A 403 here is a CSRF/session problem, not bad merchant credentials —
        // the login already succeeded by this point. Make that unambiguous.
        throw new Error(
          `Feedback API returned 403 on page ${pageNum}. This is a stale/missing CSRF ` +
          `token or an expired portal session, NOT bad credentials. ` +
          `Body: ${result.text}`
        );
      }
      if (result.status !== 200) {
        throw new Error(`Feedback API returned ${result.status} on page ${pageNum}: ${result.text}`);
      }

      const reviews = result.json?.reviews || [];
      for (const review of reviews) {
        // Defensive dedup: if the API ever repeats an id across page boundaries,
        // a blind upsert would churn timestamps for no reason.
        if (review.reviewID && seen.has(review.reviewID)) continue;
        if (review.reviewID) seen.add(review.reviewID);
        all.push(review);
      }

      const nextToken = result.json?.nextToken;
      logger.feedback(
        `Fetched page ${pageNum}: ${reviews.length} reviews (total ${all.length})` +
        (nextToken ? '' : ' — last page')
      );

      if (!nextToken) break;
      body = { ...body, nextToken };

      if (pageNum === MAX_PAGES) {
        logger.feedback(
          `WARNING: hit MAX_PAGES (${MAX_PAGES}) with a nextToken still present — ` +
          `stopping early, results may be incomplete`
        );
      }
      // Be gentle: the portal is a production system and this loop is bounded
      // but not rate-limited.
      await sleep(400);
    }

    return all;
  }

  /**
   * Aggregate rating summary (average, count, distribution).
   *
   * Unlike the reviews endpoint this needs no CSRF token.
   */
  async fetchOverview(options = {}) {
    const endDate = options.endDate || new Date();
    const startDate = options.startDate || new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);

    const result = await this.page.evaluate(async (args) => {
      const { url, startDate, endDate, merchantId } = args;
      const qs = new URLSearchParams({
        serviceType: 'DELIVERY',
        startDate,
        endDate,
        'merchantIDs[]': merchantId,
        businessTypeFilter: '0',
        include_empty_reviews: 'false'
      });
      const r = await fetch(`${url}?${qs}`, { credentials: 'include' });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      return { status: r.status, json, text: text.substring(0, 300) };
    }, {
      url: `${FEEDBACK_API_BASE}/overview`,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      merchantId: this.merchantId
    });

    if (result.status !== 200 || !result.json?.feedbackOverview) {
      throw new Error(`Feedback overview API returned ${result.status}: ${result.text}`);
    }

    const ov = result.json.feedbackOverview;
    return {
      averageRating: ov.aggregatedRatingScore,
      ratingCount: ov.ratingCount,
      distribution: (ov.ratingDistribution || []).map(d => ({
        score: d.score,
        percentage: d.countPercentage
      }))
    };
  }

  /**
   * Classify a raw aspect into a sentiment.
   *
   * Verified against 124 stored reviews (2026-10-03): only three (source, value)
   * combinations occur in live data — SELECTED_BY_PAX 1, SELECTED_BY_PAX -1, and
   * DETECTED_FROM_REVIEW 0. The verdict is NOT a 1-5 scale and the two sources
   * are not comparable to each other.
   *
   * Anything unrecognised returns null rather than guessing, so an unexpected
   * new combination surfaces as missing data instead of silently becoming
   * praise or a complaint.
   */
  static toSentiment(source, verdict) {
    if (source === 'SELECTED_BY_PAX') {
      if (verdict === 1) return 'positive';
      if (verdict === -1) return 'negative';
      return null;
    }
    if (source === 'DETECTED_FROM_REVIEW') {
      // Grab's NLP matched the aspect in the free text. That is a topic mention
      // with no sentiment attached — 0 here does NOT mean neutral-to-negative.
      return verdict === 0 ? 'mentioned' : null;
    }
    return null;
  }

  /**
   * Map a raw Grab review onto the Feedback document shape.
   *
   * Exported as a static so it can be unit-tested without a browser or database.
   */
  static toDocument(review) {
    const aspects = (review.reviewAspects || []).map(a => {
      const verdict = typeof a.rating === 'number' ? a.rating : null;
      return {
        aspectId: a.aspectId,
        aspectName: a.aspectName || '',
        verdict,
        sentiment: FeedbackService.toSentiment(a.source, verdict),
        source: a.source || '',
        reason: a.reason || ''
      };
    });

    // Grab sends reviewReplies as [null] when unanswered.
    const merchantReplies = (review.reviewReplies || [])
      .filter(Boolean)
      .map(r => ({
        repliedAt: r.repliedAt && r.repliedAt !== '0001-01-01T00:00:00Z'
          ? new Date(r.repliedAt)
          : null,
        replyText: r.replyText || r.content || ''
      }));

    return {
      reviewID: review.reviewID,
      orderID: review.orderID || '',
      rating: review.rating,
      description: review.description || '',
      createdAt: new Date(review.createdAt),
      contentLastModifiedAt: review.contentLastModifiedAt ? new Date(review.contentLastModifiedAt) : null,
      paxLastUpdatedAt: review.paxLastUpdatedAt ? new Date(review.paxLastUpdatedAt) : null,
      customerName: review.eaterName || '',
      merchantName: review.merchantName || '',
      merchantID: review.merchantID || '',
      serviceType: review.serviceType || this.serviceType || 'DELIVERY',
      status: review.status || 'PUBLIC',
      orderedItems: review.orderedItems || [],
      recommendedItems: review.recommendedItems || [],
      imageUrls: review.paxReviewImageUrls || [],
      merchantReplies,
      aspects,
      isNewToMerchant: !!review.isNew,
      isReportedBefore: !!review.isReportedBefore,
      shouldDisplaySeeTranslation: !!review.shouldDisplaySeeTranslation,
      fetchedAt: new Date(),
      lastUpdated: new Date(),
      source: 'grab-merchant-portal-feedback-api',
      rawData: review
    };
  }
}

module.exports = FeedbackService;
module.exports.DEFAULT_MERCHANT_ID = DEFAULT_MERCHANT_ID;
module.exports.DEFAULT_MERCHANT_NAME = DEFAULT_MERCHANT_NAME;
module.exports.FEEDBACK_API_BASE = FEEDBACK_API_BASE;
module.exports.FEEDBACK_PAGE_URL = FEEDBACK_PAGE_URL;