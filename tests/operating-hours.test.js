// Operating-window tests. The fetcher must poll during trading hours and stay
// completely off the portal during the afternoon break and overnight.
process.env.LOG_LEVEL = 'error';

const assert = require('assert');
const GrabOrderFetcher = require('../src/index');

const name = 'operating hours (MYT windows)';

// Build a UTC instant whose MYT (UTC+8) wall clock is the given time on 2026-09-27.
// That date is a Sunday, so the default (non-Friday) windows apply.
const atMyt = (hh, mm) => new Date(Date.UTC(2026, 8, 27, hh - 8, mm));

// Same, but on an explicit MYT day of October 2026 (2 Oct is a Friday).
const atMytOn = (day, hh, mm) => new Date(Date.UTC(2026, 9, day, hh - 8, mm));

const DAY_VARS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  .map(d => `OPERATING_HOURS_${d}`);

// The tests run with the repo's .env loaded (src/index.js calls dotenv), so any
// assertion about defaults has to clear both the base variable and the weekday
// overrides instead of assuming the shell is clean.
const withEnv = (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const clearDayOverrides = () =>
  Object.fromEntries(DAY_VARS.map(k => [k, undefined]));

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
    name: 'polls from 17:00 to 22:00 MYT',
    fn: () => {
      assert.strictEqual(inside(17, 0), true, '17:00 restarts');
      assert.strictEqual(inside(19, 15), true);
      assert.strictEqual(inside(21, 59), true);
      assert.strictEqual(inside(22, 0), true, '22:00 is inclusive');
    },
  },
  {
    name: 'does NOT poll outside trading hours',
    fn: () => {
      assert.strictEqual(inside(10, 59), false, 'just before 11:00');
      assert.strictEqual(inside(0, 0), false, 'midnight');
      assert.strictEqual(inside(9, 0), false, 'morning');
      assert.strictEqual(inside(22, 1), false, 'just after 22:00');
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
    name: 'assigns the evening window to the MYT weekday, not the UTC day',
    fn: () => {
      // 2026-10-02 16:30 UTC is 2026-10-03 00:30 MYT — Saturday, not Friday.
      // Reading getUTCDay() directly would apply Friday's windows to Saturday's
      // first half-hour and vice versa for every evening instant.
      assert.strictEqual(GrabOrderFetcher.getMytDayOfWeek(new Date(Date.UTC(2026, 9, 2, 16, 30))), 6);
      // 2026-10-02 15:30 UTC is 2026-10-02 23:30 MYT — still Friday.
      assert.strictEqual(GrabOrderFetcher.getMytDayOfWeek(new Date(Date.UTC(2026, 9, 2, 15, 30))), 5);
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
      withEnv({ OPERATING_HOURS: undefined, ...clearDayOverrides() }, () => {
        assert.deepStrictEqual(GrabOrderFetcher.getOperatingWindows(atMyt(12, 0)), [
          { start: 660, end: 900 },
          { start: 1020, end: 1320 },
        ]);
        assert.strictEqual(GrabOrderFetcher.describeSchedule(), '11:00-15:00, 17:00-22:00');
      });
    },
  },
  {
    name: 'honours an OPERATING_HOURS override',
    fn: () => {
      withEnv({ OPERATING_HOURS: '09:00-12:00', ...clearDayOverrides() }, () => {
        const f = new GrabOrderFetcher();
        assert.strictEqual(f.isWithinOperatingHours(atMyt(10, 0)), true);
        assert.strictEqual(f.isWithinOperatingHours(atMyt(13, 0)), false);
        assert.strictEqual(GrabOrderFetcher.describeSchedule(), '09:00-12:00');
      });
    },
  },
  {
    name: 'Friday uses its own shorter lunch break',
    fn: () => {
      withEnv({
        OPERATING_HOURS: '11:00-15:00,17:00-22:00',
        OPERATING_HOURS_FRI: '11:00-12:30,17:00-22:00',
      }, () => {
        const f = new GrabOrderFetcher();
        // 2 Oct 2026 is a Friday.
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 11, 0)), true, 'Friday 11:00');
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 12, 30)), true, 'Friday 12:30 is inclusive');
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 13, 0)), false, 'Friday afternoon break starts at 12:30');
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 14, 59)), false);
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 17, 0)), true, 'Friday evening window');
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(2, 22, 0)), true);
        // The other days keep the longer 15:00 finish.
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(1, 14, 0)), true, 'Thursday 14:00');
        assert.strictEqual(f.isWithinOperatingHours(atMytOn(3, 14, 0)), true, 'Saturday 14:00');
        // The override must not leak into the weekly description's base.
        assert.strictEqual(
          GrabOrderFetcher.describeSchedule(),
          '11:00-15:00, 17:00-22:00 (FRI 11:00-12:30, 17:00-22:00)'
        );
      });
    },
  },
  {
    name: 'defaults the polling interval to 5 minutes',
    fn: () => {
      withEnv({ POLLING_INTERVAL_MINUTES: undefined }, () => {
        assert.strictEqual(new GrabOrderFetcher().pollingInterval, 5);
      });
      withEnv({ POLLING_INTERVAL_MINUTES: '2' }, () => {
        assert.strictEqual(new GrabOrderFetcher().pollingInterval, 2, 'an explicit value still wins');
      });
    },
  },
];

module.exports = { name, tests };
