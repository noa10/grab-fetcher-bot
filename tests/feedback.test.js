const FeedbackService = require('../src/services/feedbackService');
const Feedback = require('../src/models/Feedback');
const FeedbackRunner = require('../src/feedback-runner');

/**
 * Real review payloads captured from the live portal on 2026-10-03. Kept
 * verbatim (rather than invented fixtures) because the two traps these tests
 * guard against are both shape facts about live data:
 *   - reviewReplies is [null] when unanswered, not []
 *   - reviewAspects[].rating is 1 / -1 / 0 depending on `source`, NOT a 1-5 scale
 */

const FIVE_STAR_WITH_ASPECTS = {
  reviewID: '077f90aba94a525d29074e1b50ebbf57',
  createdAt: '2026-10-03T08:36:33Z',
  rating: 5,
  description: 'sedap yang amat ya Allah',
  orderID: '001117785533-C8JKVCDETAUYHA',
  bookingCode: '',
  eaterName: 'SITI R.',
  isReportedBefore: false,
  status: 'PUBLIC',
  orderedItems: ['Recommends: Set Krapow Daging', 'Ice Lemon Tea (300ml)'],
  isNew: true,
  reportedAt: '0001-01-01T00:00:00Z',
  unreportableReason: 0,
  unreplyableReason: 0,
  reviewReplies: [null],
  paxReviewImageUrls: null,
  contentLastModifiedAt: '2026-10-03T08:36:53Z',
  recommendedItems: ['Set Krapow Daging', 'Ice Lemon Tea (300ml)'],
  merchantName: 'Mad Krapow - Subang Permai',
  merchantID: '1-C36JLBD2PFD3LA',
  serviceType: 'DELIVERY',
  reviewAspects: [
    { aspectId: 'TASTE', aspectName: 'Taste', rating: 1, source: 'SELECTED_BY_PAX', reason: '' },
    { aspectId: 'PORTION_SIZE', aspectName: 'Portion size', rating: 1, source: 'SELECTED_BY_PAX', reason: '' },
    { aspectId: 'PACKAGING', aspectName: 'Packaging', rating: 1, source: 'SELECTED_BY_PAX', reason: '' },
    { aspectId: 'FRESHNESS', aspectName: 'Freshness', rating: 1, source: 'SELECTED_BY_PAX', reason: '' }
  ],
  paxLastUpdatedAt: '2026-10-03T08:36:53Z',
  shouldDisplaySeeTranslation: true
};

const ONE_STAR_REVIEW = {
  reviewID: '500a9f26c1290cb1eff27fff465f98b7',
  createdAt: '2026-07-07T15:18:34Z',
  rating: 1,
  description: 'Tawar, lain sgt rasa ngn padkapau biasa. Portion ok utk 1 org makan.',
  orderID: '00143582232-C8BXEYVCLPADN6',
  eaterName: 'Nurul F.',
  status: 'PUBLIC',
  orderedItems: [],
  recommendedItems: [],
  reviewReplies: [null],
  paxReviewImageUrls: ['https://example.invalid/img.jpg'],
  contentLastModifiedAt: '2026-07-07T15:18:34Z',
  merchantName: 'Mad Krapow - Subang Permai',
  merchantID: '1-C36JLBD2PFD3LA',
  serviceType: 'DELIVERY',
  // Verbatim from the live 1-star review. verdict 0 with source
  // DETECTED_FROM_REVIEW means Grab's NLP matched the topic in the text — it is
  // NOT a zero-star aspect score. This fixture is what disproved the original
  // "verdict is a 1-5 scale" reading.
  reviewAspects: [
    { aspectId: 'TASTE', aspectName: 'Taste', rating: 0, source: 'DETECTED_FROM_REVIEW',
      reason: 'Tawar, lain sgt rasa ngn padkapau biasa.' },
    { aspectId: 'PORTION_SIZE', aspectName: 'Portion size', rating: 0, source: 'DETECTED_FROM_REVIEW',
      reason: 'Portion ok utk 1 org makan.' }
  ],
  shouldDisplaySeeTranslation: false
};

// A 3-star review with a genuinely negative customer-ticked aspect (verdict -1).
// Real text from the portal: "ada insect kat telurrrrr huhuhuhu".
const NEGATIVE_ASPECT_REVIEW = {
  reviewID: 'neg0000000000000000000000000000ab',
  createdAt: '2026-06-01T10:00:00Z',
  rating: 3,
  description: 'ada insect kat telurrrrr huhuhuhu',
  orderID: '00143582233-C8BXEYVCLPADN6',
  eaterName: 'Test P.',
  status: 'PUBLIC',
  orderedItems: [],
  recommendedItems: [],
  reviewReplies: [null],
  paxReviewImageUrls: null,
  merchantName: 'Mad Krapow - Subang Permai',
  merchantID: '1-C36JLBD2PFD3LA',
  serviceType: 'DELIVERY',
  reviewAspects: [
    { aspectId: 'FRESHNESS', aspectName: 'Freshness', rating: -1, source: 'SELECTED_BY_PAX', reason: '' }
  ],
  shouldDisplaySeeTranslation: false
};

module.exports = {
  name: 'feedback',
  fixtures: { FIVE_STAR_WITH_ASPECTS, ONE_STAR_REVIEW, NEGATIVE_ASPECT_REVIEW },
  FeedbackService,
  Feedback,
  tests: [
    {
      name: 'maps a live 5-star review to a document',
      fn: () => {
        const doc = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        assert(doc.reviewID === '077f90aba94a525d29074e1b50ebbf57', 'reviewID carried over');
        assert(doc.rating === 5, 'rating carried over');
        assert(doc.customerName === 'SITI R.', 'eaterName maps to customerName');
        assert(doc.merchantID === '1-C36JLBD2PFD3LA', 'merchantID carried over');
        assert(doc.createdAt instanceof Date, 'createdAt parsed to Date');
        assert(doc.createdAt.toISOString() === '2026-10-03T08:36:33.000Z', 'instant preserved');
        assert(doc.recommendedItems.length === 2, 'recommendedItems mapped');
      }
    },
    {
      // The core trap: [null] must not become a reply object.
      name: 'treats reviewReplies [null] as unanswered, not as a reply',
      fn: () => {
        const doc = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        assert(doc.merchantReplies.length === 0,
          `expected 0 replies, got ${doc.merchantReplies.length}`);
      }
    },
    {
          // The core trap: verdict values are 1 / -1 / 0 by SOURCE, not a 1-5 scale.
          name: 'classifies SELECTED_BY_PAX verdicts as positive or negative',
          fn: () => {
            assert(FeedbackService.toSentiment('SELECTED_BY_PAX', 1) === 'positive',
              'verdict 1 selected by pax = positive');
            assert(FeedbackService.toSentiment('SELECTED_BY_PAX', -1) === 'negative',
              'verdict -1 selected by pax = negative');
          }
        },
        {
          name: 'treats DETECTED_FROM_REVIEW 0 as a mention, not a complaint',
          fn: () => {
            // Grab's NLP matching an aspect in the text carries no sentiment.
            // Classifying this as negative would rank an aspect "worst" merely
            // because customers talk about it.
            assert(FeedbackService.toSentiment('DETECTED_FROM_REVIEW', 0) === 'mentioned',
              'NLP-detected aspect is a mention');
          }
        },
        {
          name: 'returns null for an unrecognised source/verdict pair',
          fn: () => {
            // Better to lose the signal than to silently invent praise or a complaint.
            assert(FeedbackService.toSentiment('SELECTED_BY_PAX', 5) === null,
              '5 is not a valid SELECTED_BY_PAX verdict');
            assert(FeedbackService.toSentiment('SOME_NEW_SOURCE', 1) === null,
              'unknown source yields no sentiment');
            assert(FeedbackService.toSentiment(undefined, undefined) === null,
              'missing input yields no sentiment');
          }
        },
        {
          name: 'a 5-star review does not score worse than a 1-star review',
          fn: () => {
            // Regression guard for the wrong model that was built first: treating
            // verdict as a 1-5 rating made every good review score 1/5.
            const five = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
            const one = FeedbackService.toDocument(ONE_STAR_REVIEW);
            const fiveTaste = five.aspects.find(a => a.aspectId === 'TASTE');
            assert(fiveTaste.sentiment === 'positive', '5-star review rates TASTE positive');
            assert(one.rating < five.rating, 'fixture contrast holds');
            assert(fiveTaste.sentiment !== 'negative',
              'a praised aspect on a 5-star review must never read as a complaint');
          }
        },
        {
          name: 'maps live aspects onto sentiment, preserving the raw verdict',
          fn: () => {
            const doc = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
            assert(doc.aspects.length === 4, 'all four aspects mapped');
            const taste = doc.aspects.find(a => a.aspectId === 'TASTE');
            assert(taste.verdict === 1, 'raw verdict preserved');
            assert(taste.sentiment === 'positive', 'derived sentiment set');
            assert(taste.source === 'SELECTED_BY_PAX', 'source preserved');
          }
        },
        {
          name: 'keeps the quoted fragment for NLP-detected aspects',
          fn: () => {
            const doc = FeedbackService.toDocument(ONE_STAR_REVIEW);
            const taste = doc.aspects.find(a => a.aspectId === 'TASTE');
            assert(taste.sentiment === 'mentioned', 'NLP match is a mention');
            assert(taste.reason.length > 0, 'the triggering quote is retained');
            assert(taste.reason.includes('Tawar'), 'quote is the matched text');
          }
        },
        {
          // The review that exposed the whole bug: a 1-star review whose aspects
          // are all verdict 0. Under the wrong 1-5 model every aspect looked worst.
          name: 'a 1-star review does not turn every aspect into a negative verdict',
          fn: () => {
            const doc = FeedbackService.toDocument(ONE_STAR_REVIEW);
            assert(doc.aspects.every(a => a.sentiment === 'mentioned'),
              'NLP mentions are not negatives, even on a 1-star review');
            assert(doc.aspects.some(a => a.sentiment === 'negative') === false,
              'no fabricated complaints from a low star rating');
          }
        },
    {
      name: 'classifies a customer-ticked bad aspect as negative',
      fn: () => {
        const doc = FeedbackService.toDocument(NEGATIVE_ASPECT_REVIEW);
        const fresh = doc.aspects.find(a => a.aspectId === 'FRESHNESS');
        assert(fresh.verdict === -1, 'raw -1 verdict preserved');
        assert(fresh.sentiment === 'negative', 'customer-ticked complaint is negative');
      }
    },
    {
      name: 'handles a review with an image and an unanswered reply',
      fn: () => {
        const doc = FeedbackService.toDocument(ONE_STAR_REVIEW);
        assert(doc.rating === 1, 'rating carried over');
        assert(doc.imageUrls.length === 1, 'image URL mapped');
        assert(doc.merchantReplies.length === 0, 'unanswered');
        assert(doc.shouldDisplaySeeTranslation === false, 'boolean preserved');
      }
    },
    {
      name: 'survives a review with no aspects at all',
      fn: () => {
        const doc = FeedbackService.toDocument({
          ...ONE_STAR_REVIEW,
          reviewAspects: undefined,
          reviewReplies: undefined,
          paxReviewImageUrls: null,
          recommendedItems: undefined
        });
        assert(doc.aspects.length === 0, 'no aspects is an empty array, not undefined');
        assert(doc.merchantReplies.length === 0, 'no replies is an empty array');
        assert(doc.imageUrls.length === 0, 'no images is an empty array');
      }
    },
    {
      name: 'keeps orderID for joining reviews back to orders',
      fn: () => {
        const doc = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        assert(doc.orderID === '001117785533-C8JKVCDETAUYHA', 'orderID preserved verbatim');
      }
    },
    {
      name: 'hardcodes the store id, not the master account id',
      fn: () => {
        // Guards the confusion that cost the most debugging here: the feedback
        // API wants the STORE id, not the MLM master id from merchantSelector.
        assert(FeedbackService.DEFAULT_MERCHANT_ID === '1-C36JLBD2PFD3LA',
          'store id must be the feedback API store id');
        assert(FeedbackService.DEFAULT_MERCHANT_ID !== 'MYMG20230315032033018448',
          'must not be the master account id — the API rejects that');
      }
    },
    {
      name: 'builds required request headers including the CSRF token',
      fn: () => {
        const svc = new FeedbackService({}, { merchantId: '1-C36JLBD2PFD3LA' });
        svc.csrfToken = 'test-token';
        const h = svc.buildHeaders();
        assert(h['x-csrf-token'] === 'test-token', 'CSRF header present');
        assert(h.merchantid === '1-C36JLBD2PFD3LA', 'merchantid header present');
        assert(h.requestsource === 'troyPortal', 'requestsource header present');
        assert(h.referer === 'https://merchant.grab.com/', 'referer header present');
      }
    },
    {
      name: 'refuses to build headers without a CSRF token',
      fn: () => {
        // Without this guard the failure surfaces as an opaque 403 that reads
        // like bad credentials.
        const svc = new FeedbackService({});
        let threw = false;
        try { svc.buildHeaders(); } catch (e) { threw = /CSRF token not captured/.test(e.message); }
        assert(threw, 'should throw a CSRF-specific error before any request');
      }
    },
    {
      name: 'defaults the window to 90 days and honours --all',
      fn: () => {
        const normal = new FeedbackRunner({ days: 30 }).getWindow();
        assert(normal.days === 30, 'honours explicit days');

        const dflt = new FeedbackRunner({}).getWindow();
        const span = dflt.endDate - dflt.startDate;
        assert(Math.round(span / 86400000) === 90, `default window is 90 days, got ${span / 86400000}`);

        const all = new FeedbackRunner({ all: true }).getWindow();
        assert(all.startDate.getUTCFullYear() === 2019, 'backfill window starts in 2019');
      }
    },
    {
      name: 'rejects a malformed --days instead of silently defaulting',
      fn: () => {
        // Each of these previously produced a 90-day run or a window ending
        // before it starts, while still reporting success.
        const bad = [['--days'], ['--days', '--dry-run'], ['--days', 'abc'], ['--days', '0'], ['--days', '-5'], ['--days', '1.5']];
        for (const args of bad) {
          let threw = false;
          try {
            FeedbackRunner.parseArgs(args);
          } catch (e) {
            threw = true;
          }
          assert(threw, `parseArgs([${args.join(' ')}]) should throw`);
        }
      }
    },
    {
      name: 'accepts valid flags and rejects --days with --all',
      fn: () => {
        assert(FeedbackRunner.parseArgs(['--days', '30']).days === 30, 'parses a valid day count');
        assert(FeedbackRunner.parseArgs(['--days', '7', '--dry-run']).dryRun === true, 'parses --dry-run');
        assert(FeedbackRunner.parseArgs([]).days === null, 'no flag means the default window');
        assert(FeedbackRunner.parseArgs(['--all']).all === true, 'parses --all');

        let threw = false;
        try {
          FeedbackRunner.parseArgs(['--days', '30', '--all']);
        } catch (e) { threw = true; }
        assert(threw, '--days and --all are contradictory and must be rejected');
      }
    },
    {
      name: 'a bad days value cannot produce a backwards window',
      fn: () => {
        // Defence in depth for direct construction, bypassing parseArgs.
        let threw = false;
        try { new FeedbackRunner({ days: -5 }); } catch (e) { threw = true; }
        assert(threw, 'constructor must reject a negative day count');
      }
    },
    {
      name: 'content hash ignores scrape-time fields',
      fn: () => {
        // The whole point: a re-run must not look like a change just because it
        // scraped again.
        const a = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        const b = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        b.fetchedAt = new Date(Date.now() + 60000);
        b.lastUpdated = new Date(Date.now() + 60000);
        assert(FeedbackService.contentHash(a) === FeedbackService.contentHash(b),
          'fetchedAt/lastUpdated must not affect the hash');
      }
    },
    {
      name: 'content hash changes when the review actually changes',
      fn: () => {
        const base = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        const edited = FeedbackService.toDocument({ ...FIVE_STAR_WITH_ASPECTS, description: 'edited text' });
        assert(FeedbackService.contentHash(base) !== FeedbackService.contentHash(edited),
          'edited text must change the hash');

        // A merchant reply landing is the most common real mutation.
        const replied = FeedbackService.toDocument({
          ...FIVE_STAR_WITH_ASPECTS,
          reviewReplies: [{ repliedAt: '2026-10-04T09:00:00Z', replyText: 'Thank you!' }]
        });
        assert(FeedbackService.contentHash(base) !== FeedbackService.contentHash(replied),
          'a new merchant reply must change the hash');
      }
    },
    {
      name: 'content hash is stable across key ordering',
      fn: () => {
        const a = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        const b = FeedbackService.toDocument(FIVE_STAR_WITH_ASPECTS);
        // Simulate BSON field reordering on a round-trip.
        const reordered = JSON.parse(JSON.stringify(b));
        const flipped = Object.fromEntries(Object.entries(reordered).reverse());
        assert(FeedbackService.contentHash(a) === FeedbackService.contentHash(flipped),
          'hash must not depend on object key order');
      }
    },
    {
      name: 'content hash ignores re-signed image URLs',
      fn: () => {
        // Grab mints a fresh CloudFront signature per API response, so a review
        // with a photo otherwise rewrites itself on every single run. Live-verified
        // bug: a review whose contentLastModifiedAt was months old still reported
        // "1 updated" purely because its signature rotated.
        const signed = 'https://d24t71ciweynx9.cloudfront.net/food-reviews/images/0/zUTMxQTM4UDO5QzNyQDO5QjM.jpg'
          + '?Expires=3051353084&Signature=H39W5tIO3mms~X~z9Fe3x9l9OQ9NmwcHx6qnSruvt0wB3hzGPUKThvfDqOr35kBBDUNB7hvOfKHifBPMKgqwTv2mj8s6h9t3izFpi8nJcyWiT2oe20yndZyHJkIKyiEh9DxD6ZHFqzOkvHYWRVlu0f-v7RBPUWgfO5i9mbGCUwxyYS3~6EQkogaMprf-YjyA~vBqY4JSa~EGdGPunUhM7K5O0cTn69QT6g0oTo~yFJVvPvYvr4oqFknd9AnwpWY2zKCmdyAT5duLxG7SVt9FtaaD36ZdjNswESM09WZKttVIibySOUH7fyHcblncN2u1OKngkangl3Gl--GXrPgIcA__&Key-Pair-Id=K3UYLQ5OPJHQLI';

        const a = FeedbackService.toDocument({
          ...FIVE_STAR_WITH_ASPECTS, paxReviewImageUrls: [signed]
        });
        const b = FeedbackService.toDocument({
          ...FIVE_STAR_WITH_ASPECTS,
          paxReviewImageUrls: [signed.replace(/Expires=\d+/, 'Expires=3999999999')
            .replace(/Signature=[^&]+/, 'Signature=DIFFERENT_SIGNATURE')]
        });

        assert(a.imageUrls[0] !== b.imageUrls[0], 'fixture must actually differ in the signature');
        assert(FeedbackService.contentHash(a) === FeedbackService.contentHash(b),
          'a rotated image signature must not look like a content change');
      }
    },
    {
      name: 'content hash still detects a genuinely different image',
      fn: () => {
        const base = 'https://cdn.example.com/food-reviews/images/0/aaa.jpg?Expires=1&Signature=x';
        const a = FeedbackService.toDocument({ ...FIVE_STAR_WITH_ASPECTS, paxReviewImageUrls: [base] });
        const b = FeedbackService.toDocument({
          ...FIVE_STAR_WITH_ASPECTS,
          paxReviewImageUrls: [base.replace('/aaa.jpg', '/bbb.jpg')]
        });
        assert(FeedbackService.contentHash(a) !== FeedbackService.contentHash(b),
          'a replaced image must still be detected via its stable path');
      }
    },
    {
      name: 'dry-run writes nothing',
      fn: () => {
        const runner = new FeedbackRunner({ dryRun: true });
        return runner.saveReviews([FIVE_STAR_WITH_ASPECTS]).then(r => {
          assert(r.dryRun === true, 'flagged as dry run');
          assert(r.inserted === 0 && r.updated === 0, 'nothing written');
          assert(r.total === 1, 'would-have-written count reported');
        });
      }
    }
  ]
};

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
