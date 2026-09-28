// Operating-window tests. The fetcher must poll during trading hours and stay
// completely off the portal during the afternoon break and overnight.
process.env.LOG_LEVEL = 'error';

const assert = require('assert');
const GrabOrderFetcher = require('../src/index');

const name = 'operating hours (MYT windows)';

// Build a UTC instant whose MYT (UTC+8) wall clock is the given time on 2026-09-27.
const atMyt = (hh, mm) => new Date(Date.UTC(2026, 8, 27, hh - 8, mm));

const inside = (h, m) => {
  const f = new GrabOrderFetcher();
  return f.isWithinOperatingHours(atMyt(h, m));
};

const tests = [
  {
    name: 'polls from 11:00 to 15:00 MYT',
    fn: () => {
      assert.strictEqual(inside(11, 0), true, '11:00 is the start of the first window');
      assert.strictEqual(inside(12, 30), true);
      assert.strictEqual(inside(14, 59), true);
      assert.strictEqual(inside(15, 0), true, '15:00 is inclusive');
    },
  },
  {
    name: 'does NOT poll during the 15:00-17:00 break',
    fn: () => {
      assert.strictEqual(inside(15, 1), false, 'just after 15:00');
      assert.strictEqual(inside(16, 0), false, 'mid-break');
      assert.strictEqual(inside(16, 59), false, 'just before 17:00');
    },
  },
  {
    name: 'polls from 17:00 to 22:30 MYT',
    fn: () => {
      assert.strictEqual(inside(17, 0), true, '17:00 restarts');
      assert.strictEqual(inside(19, 15), true);
      assert.strictEqual(inside(22, 30), true, '22:30 is inclusive');
    },
  },
  {
    name: 'does NOT poll outside trading hours',
    fn: () => {
      assert.strictEqual(inside(10, 59), false, 'just before 11:00');
      assert.strictEqual(inside(0, 0), false, 'midnight');
      assert.strictEqual(inside(9, 0), false, 'morning');
      assert.strictEqual(inside(22, 31), false, 'just after 22:30');
      assert.strictEqual(inside(23, 59), false, 'end of day');
    },
  },
  {
    name: 'converts MYT wall clock correctly regardless of host timezone',
    fn: () => {
      // 19:00 MYT is 11:00 UTC. The old inline implementation recomputed this by
      // hand; a mistake there silently shifted the whole schedule.
      assert.strictEqual(GrabOrderFetcher.getMytMinutesOfDay(atMyt(19, 0)), 19 * 60);
      assert.strictEqual(GrabOrderFetcher.getMytMinutesOfDay(atMyt(0, 0)), 0);
      // 00:30 MYT the next day is 16:30 UTC the previous day.
      assert.strictEqual(GrabOrderFetcher.getMytMinutesOfDay(new Date(Date.UTC(2026, 8, 26, 16, 30))), 30);
    },
  },
  {
    name: 'parses window specs and rejects nonsense',
    fn: () => {
      assert.deepStrictEqual(GrabOrderFetcher.parseWindow('11:00-15:00'), { start: 660, end: 900 });
      assert.deepStrictEqual(GrabOrderFetcher.parseWindow('17:00-22:30'), { start: 1020, end: 1350 });
      assert.deepStrictEqual(GrabOrderFetcher.parseWindow('9:00-9:30'), { start: 540, end: 570 });
      assert.throws(() => GrabOrderFetcher.parseWindow('nonsense'), /Invalid operating window/);
      assert.throws(() => GrabOrderFetcher.parseWindow('22:00-11:00'), /start must not be after end/);
    },
  },
  {
    name: 'defaults to two windows with the mid-afternoon break',
    fn: () => {
      const saved = process.env.OPERATING_HOURS;
      delete process.env.OPERATING_HOURS;
      try {
        assert.deepStrictEqual(GrabOrderFetcher.getOperatingWindows(), [
          { start: 660, end: 900 },
          { start: 1020, end: 1350 },
        ]);
        assert.strictEqual(GrabOrderFetcher.describeSchedule(), '11:00-15:00, 17:00-22:30');
      } finally {
        if (saved !== undefined) process.env.OPERATING_HOURS = saved;
      }
    },
  },
  {
    name: 'honours an OPERATING_HOURS override',
    fn: () => {
      const saved = process.env.OPERATING_HOURS;
      process.env.OPERATING_HOURS = '09:00-12:00';
      try {
        const f = new GrabOrderFetcher();
        assert.strictEqual(f.isWithinOperatingHours(atMyt(10, 0)), true);
        assert.strictEqual(f.isWithinOperatingHours(atMyt(13, 0)), false);
        assert.strictEqual(GrabOrderFetcher.describeSchedule(), '09:00-12:00');
      } finally {
        if (saved === undefined) delete process.env.OPERATING_HOURS;
        else process.env.OPERATING_HOURS = saved;
      }
    },
  },
  {
    name: 'defaults the polling interval to 5 minutes',
    fn: () => {
      const saved = process.env.POLLING_INTERVAL_MINUTES;
      delete process.env.POLLING_INTERVAL_MINUTES;
      try {
        assert.strictEqual(new GrabOrderFetcher().pollingInterval, 5);
      } finally {
        if (saved !== undefined) process.env.POLLING_INTERVAL_MINUTES = saved;
      }
      process.env.POLLING_INTERVAL_MINUTES = '2';
      try {
        assert.strictEqual(new GrabOrderFetcher().pollingInterval, 2, 'an explicit value still wins');
      } finally {
        if (saved === undefined) delete process.env.POLLING_INTERVAL_MINUTES;
        else process.env.POLLING_INTERVAL_MINUTES = saved;
      }
    },
  },
];

module.exports = { name, tests };
