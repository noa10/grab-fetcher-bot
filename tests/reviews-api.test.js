// Reviews listing: filter construction and pagination bounds.
//
// Pure functions on purpose — these are the parts that decide which reviews a
// caller can see, and they must be provable without a database.
const assert = require('assert');
const { buildFilter, DEFAULT_LIMIT, MAX_LIMIT } = require('../src/api/reviews-query');

const NOW = Date.now();

module.exports = {
  name: 'reviews api',

  tests: [
    {
      name: 'no query means no filter',
      fn: async () => {
        assert.deepStrictEqual(buildFilter({}), {});
      }
    },
    {
      name: 'rating is limited to 1-5 and ignores junk',
      fn: async () => {
        assert.strictEqual(buildFilter({ rating: '4' }).rating, 4);
        assert.strictEqual(buildFilter({ rating: '5' }).rating, 5);
        assert.strictEqual(buildFilter({ rating: '9' }).rating, undefined);
        assert.strictEqual(buildFilter({ rating: 'abc' }).rating, undefined);
        assert.strictEqual(buildFilter({ rating: '' }).rating, undefined);
      }
    },
    {
      name: 'replied=false selects reviews with no merchant reply',
      fn: async () => {
        const filter = buildFilter({ replied: 'false' });
        assert.ok(Array.isArray(filter.$and) && filter.$and.length === 1);
        const or = filter.$and[0].$or;
        assert.ok(or.some(c => c.merchantReplies && c.merchantReplies.$size === 0));
        assert.ok(or.some(c => c.merchantReplies && c.merchantReplies.$exists === false));
      }
    },
    {
      name: 'replied=true negates the same clauses',
      fn: async () => {
        const filter = buildFilter({ replied: 'true' });
        assert.ok(Array.isArray(filter.$and) && filter.$and.length === 1);
        assert.ok(Array.isArray(filter.$and[0].$nor));
        assert.strictEqual(filter.$and[0].$nor.length, 2);
      }
    },
    {
      name: 'replied and search stack instead of clobbering each other',
      fn: async () => {
        const filter = buildFilter({ replied: 'false', search: 'sedap' });
        assert.strictEqual(filter.$and.length, 2, 'both clauses must survive');
        assert.ok(filter.$and[0].$or, 'reply filter');
        assert.ok(filter.$and[1].$or, 'search filter');
      }
    },
    {
      name: 'search is escaped, not treated as a regex',
      fn: async () => {
        const filter = buildFilter({ search: 'a.*b(' });
        const regex = filter.$and[0].$or[0].description.$regex;
        assert.ok(regex.includes('\\'), 'special characters must be escaped');
        assert.ok(regex.includes('a\\.\\*b'), 'dot and star must be literal: ' + regex);
        assert.strictEqual(filter.$and[0].$or[0].description.$options, 'i');
      }
    },
    {
      name: 'search looks at text, customer and order id',
      fn: async () => {
        const or = buildFilter({ search: 'GF-1' }).$and[0].$or;
        const keys = or.map(c => Object.keys(c)[0]).sort();
        assert.deepStrictEqual(keys, ['customerName', 'description', 'orderID']);
      }
    },
    {
      name: 'days builds a rolling cutoff and rejects nonsense ranges',
      fn: async () => {
        const filter = buildFilter({ days: '30' });
        // createdAt is a Mongo range, not a bare Date.
        assert.ok(filter.createdAt && filter.createdAt.$gte instanceof Date);
        const skew = Math.abs((NOW - 30 * 86400000) - filter.createdAt.$gte.getTime());
        assert.ok(skew < 60000, 'cutoff should be ~30 days ago');
        assert.strictEqual(buildFilter({ days: '0' }).createdAt, undefined);
        assert.strictEqual(buildFilter({ days: '-5' }).createdAt, undefined);
        assert.strictEqual(buildFilter({ days: '9999' }).createdAt, undefined);
      }
    },
    {
      name: 'aspect ids are matched exactly and upper-cased',
      fn: async () => {
        assert.strictEqual(buildFilter({ aspect: 'taste' })['aspects.aspectId'], 'TASTE');
      }
    },
    {
      name: 'limit bounds are constants the API can advertise',
      fn: async () => {
        assert.strictEqual(DEFAULT_LIMIT, 20);
        assert.strictEqual(MAX_LIMIT, 100);
      }
    }
  ]
};
