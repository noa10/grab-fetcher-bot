require('dotenv').config();

const logger = require('./utils/logger');
const database = require('./config/database');
const Feedback = require('./models/Feedback');
const GrabBot = require('./services/grabBot');
const FeedbackService = require('./services/feedbackService');

/**
 * Fetch customer reviews once and upsert them into Mongo.
 *
 * Deliberately separate from the order polling cycle: orders are intraday and
 * gated to trading hours, whereas reviews trickle in around the clock and are
 * not worth spending a portal login on every 5 minutes.
 *
 * Usage:
 *   npm run fetch-feedback                 # default window (90 days)
 *   npm run fetch-feedback -- --days 30    # narrower window
 *   npm run fetch-feedback -- --all        # full history backfill
 *   npm run fetch-feedback -- --dry-run    # fetch, report, write nothing
 */
class FeedbackRunner {
  constructor(options = {}) {
    this.bot = new GrabBot();
    this.service = null;
    this.dryRun = !!options.dryRun;
    this.backfillAll = !!options.all;
    this.days = options.days ? parseInt(options.days, 10) : null;
    if (this.days !== null && (!Number.isInteger(this.days) || this.days <= 0)) {
      // Defence in depth: parseArgs already rejects these from the CLI, but the
      // class is also constructed directly (tests, future callers) so a bad value
      // must not be able to produce a window that ends before it starts.
      throw new Error(`FeedbackRunner: days must be a positive integer, got ${options.days}`);
    }
  }

  async init() {
    logger.feedback('Initializing Grab Feedback fetcher...');
    await database.connect();
    logger.database('Database connected successfully');

    await this.bot.initBrowser();
    await this.bot.login();
    logger.feedback('Logged into Grab Merchant portal');

    this.service = new FeedbackService(this.bot.getPage());
    return true;
  }

  /**
   * Resolve the fetch window.
   *
   * --all sets the window far in the past; the API honours startDate and the
   * nextToken chain simply runs to exhaustion. Verified: paginating from 2019
   * returned 124 reviews back to 2023-05-16 before the token stopped.
   */
  getWindow() {
    if (this.backfillAll) {
      return { startDate: new Date('2019-01-01T00:00:00.000Z'), endDate: new Date() };
    }
    const days = this.days || 90;
    const endDate = new Date();
    return {
      startDate: new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000),
      endDate,
      days
    };
  }

  async runOnce() {
    const startTime = Date.now();
    try {
      const window = this.getWindow();
      logger.feedback(
        `Fetching reviews ${window.startDate.toISOString().slice(0, 10)} → ` +
        `${window.endDate.toISOString().slice(0, 10)}`
      );

      const reviews = await this.service.fetchReviews(window);

      // The overview call needs no CSRF and gives us the portal's own aggregate
      // to sanity-check our row count against.
      let overview = null;
      try {
        overview = await this.service.fetchOverview(window);
        logger.feedback(
          `Portal overview: avg ${overview.averageRating?.toFixed(2)} ` +
          `across ${overview.ratingCount} ratings`
        );
      } catch (e) {
        logger.feedback(`Overview fetch failed (non-fatal): ${e.message}`);
      }

      if (reviews.length === 0) {
        logger.feedback('No reviews returned');
        return { success: true, fetched: 0, inserted: 0, updated: 0 };
      }

      const result = await this.saveReviews(reviews);

      // Surface what actually matters operationally.
      const unreplied = reviews.filter(r => !(r.reviewReplies || []).some(Boolean)).length;
      const lowRated = reviews.filter(r => r.rating <= 3).length;
      logger.feedback(
        `Fetched ${result.total}: ${result.inserted} new, ${result.updated} updated. ` +
        `${unreplied} awaiting merchant reply, ${lowRated} rated 3 or below.`
      );

      if (overview && result.total !== 0) {
        logger.feedback(
          `Sanity check: fetched ${result.total} written reviews vs portal ` +
          `ratingCount ${overview.ratingCount} (these differ legitimately — ` +
          `ratingCount is all-time and includes ratings without written reviews).`
        );
      }

      await this.reportWorstAspects();

      logger.performance('Feedback fetch cycle', startTime);
      return { success: true, ...result, overview };
    } catch (error) {
      logger.error('Error during feedback fetch cycle:', error);
      logger.performance('Feedback fetch cycle (error)', startTime);
      return { success: false, error: error.message };
    }
  }

  /**
   * Upsert reviews keyed on reviewID.
   *
   * $set only the mutable fields rather than replacing the document, so a
   * partial payload can never blank out data written by an earlier scrape.
   *
   * Unchanged reviews are skipped via a content hash. Without it every daily run
   * rewrote all 124 documents — bumping fetchedAt/lastUpdated/updatedAt — so the
   * daily timer generated pure write churn and made "when did we last actually
   * see a change?" unanswerable. Grab does mutate reviews (a merchant reply
   * lands, text is edited), so the hash covers the mutable payload and those
   * still write through.
   */
  async saveReviews(reviews) {
    if (this.dryRun) {
      logger.feedback(`DRY RUN — would write ${reviews.length} reviews`);
      return { total: reviews.length, inserted: 0, updated: 0, unchanged: 0, dryRun: true };
    }

    const existing = await Feedback.find(
      { reviewID: { $in: reviews.map(r => r.reviewID) } },
      { reviewID: 1, contentHash: 1 }
    ).lean();
    const existingById = new Map(existing.map(d => [d.reviewID, d]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const review of reviews) {
      const doc = FeedbackService.toDocument(review);
      const hash = FeedbackService.contentHash(doc);
      const prior = existingById.get(doc.reviewID);

      if (prior) {
        // No change since last scrape: skip the write entirely so updatedAt
        // remains a truthful "content last changed" signal.
        if (prior.contentHash && prior.contentHash === hash) {
          unchanged++;
          continue;
        }
        await Feedback.updateOne(
          { reviewID: doc.reviewID },
          { $set: { ...doc, contentHash: hash, lastUpdated: new Date() } }
        );
        updated++;
      } else {
        try {
          await Feedback.create({ ...doc, contentHash: hash });
          inserted++;
        } catch (e) {
          // Duplicate key means a concurrent run won the race — not an error.
          if (e.code === 11000) {
            await Feedback.updateOne(
              { reviewID: doc.reviewID },
              { $set: { ...doc, contentHash: hash, lastUpdated: new Date() } }
            );
            updated++;
          } else {
            throw e;
          }
        }
      }
    }

    if (inserted > 0) {
      logger.database(`Stored ${inserted} new reviews`);
    }
    if (unchanged > 0) {
      logger.feedback(`Skipped ${unchanged} unchanged review(s) — content hash unchanged`);
    }
    return { total: reviews.length, inserted, updated, unchanged };
  }

  /** Log the aspects customers complain about — the actionable part. */
  async reportWorstAspects() {
    if (this.dryRun) return;
    try {
      const breakdown = await Feedback.getAspectSentimentBreakdown(3650);
      if (breakdown.length === 0) {
        logger.feedback('No aspect-level feedback recorded.');
        return;
      }
      logger.feedback('Aspect sentiment (all history) — complaints first:');
      for (const b of breakdown) {
        logger.feedback(
          `  ${String(b._id || 'unknown').padEnd(18)} ` +
          `complaints=${String(b.negative).padStart(3)}  ` +
          `praise=${String(b.positive).padStart(3)}  ` +
          `mentions=${String(b.mentioned).padStart(3)}`
        );
      }
      logger.feedback(
        "  ('mentions' = Grab's NLP flagged the topic in the review text; " +
        'not sentiment)'
      );
    } catch (e) {
      logger.feedback(`Aspect report failed: ${e.message}`);
    }
  }

  async cleanup() {
    try {
      if (this.bot) await this.bot.cleanup();
      await database.disconnect();
      logger.feedback('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}

/**
 * Parse CLI flags, rejecting anything malformed.
 *
 * These are validated here rather than in the constructor because a bad flag must
 * fail loudly and exit non-zero. Previously `--days -5` produced a window whose
 * start is AFTER its end, so the run silently fetched nothing and still reported
 * success, and `--days abc` quietly fell back to 90. A cron job hitting either
 * would look healthy while collecting no reviews at all.
 *
 * @returns {{dryRun: boolean, all: boolean, days: number|null}}
 * @throws {Error} with a usage message on bad input.
 */
function parseArgs(args) {
  const options = { dryRun: args.includes('--dry-run'), all: args.includes('--all'), days: null };

  const daysIdx = args.indexOf('--days');
  if (daysIdx === -1) return options;

  if (options.all) {
    throw new Error('--days and --all are mutually exclusive: --all already fetches everything.');
  }

  const raw = args[daysIdx + 1];
  // A missing value, or the next flag being taken as the value, is the common
  // typo (`--days --dry-run`) and must not be read as NaN -> 90.
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error('--days requires a positive integer, e.g. --days 30.');
  }

  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`--days must be a positive integer, got "${raw}".`);
  }
  // Cap so a typo cannot ask the portal for a century of pagination.
  if (days > 3650) {
    throw new Error(`--days ${days} exceeds the 3650-day maximum. Use --all for full history.`);
  }

  options.days = days;
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    // Before init(): the logger may not be ready and no browser should launch for
    // a command that cannot succeed.
    console.error(`Argument error: ${error.message}`);
    console.error('Usage: node src/feedback-runner.js [--days N | --all] [--dry-run]');
    process.exit(2);
  }

  const runner = new FeedbackRunner(options);
  let exitCode = 0;

  try {
    await runner.init();
    const result = await runner.runOnce();

    if (result.success) {
      logger.feedback('Feedback fetch completed successfully.');
    } else {
      logger.error(`Feedback fetch failed: ${result.error}`);
      exitCode = 1;
    }
  } catch (error) {
    logger.error('Failed to run feedback fetch job:', error);
    exitCode = 1;
  } finally {
    await runner.cleanup();
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Feedback runner crashed:', error);
    process.exit(1);
  });
}

module.exports = FeedbackRunner;
// parseArgs is exported for the CLI-validation tests; it is not part of the
// runner's own API.
module.exports.parseArgs = parseArgs;
