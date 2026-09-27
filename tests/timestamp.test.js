const assert = require('assert');
const { parseGrabTimestamp } = require('../src/utils/helpers');

const name = 'parseGrabTimestamp (MYT correctness)';

const tests = [
  {
    name: 'parses 11:30 PM MYT to the correct UTC instant',
    fn: () => {
      // Grab shows "27 Sep, 11:30 PM" in MYT (UTC+8) => 15:30 UTC, not 23:30 UTC.
      const ref = new Date('2026-09-27T12:00:00Z');
      const parsed = parseGrabTimestamp('27 Sep, Sun, 11:30 PM', ref);
      assert.strictEqual(parsed.toISOString(), '2026-09-27T15:30:00.000Z');
    },
  },
  {
    name: 'parses 9:15 AM MYT to the correct UTC instant',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const parsed = parseGrabTimestamp('27 Sep, Sun, 9:15 AM', ref);
      assert.strictEqual(parsed.toISOString(), '2026-09-27T01:15:00.000Z');
    },
  },
  {
    name: 'midnight MYT maps to the previous UTC day (00:00 MYT = 16:00 UTC prior day)',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const parsed = parseGrabTimestamp('27 Sep, Sun, 12:00 AM', ref);
      assert.strictEqual(parsed.toISOString(), '2026-09-26T16:00:00.000Z');
    },
  },
  {
    name: 'is independent of the host timezone',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const parsed = parseGrabTimestamp('27 Sep, Sun, 11:30 PM', ref);
      // Round-trip through MYT display to prove the wall clock is right.
      const myt = new Date(parsed.getTime() + 8 * 3600 * 1000);
      assert.strictEqual(myt.getUTCHours(), 23);
      assert.strictEqual(myt.getUTCMinutes(), 30);
      assert.strictEqual(myt.getUTCDate(), 27);
    },
  },
  {
    name: '12 AM and 12 PM are handled (AM/PM boundary)',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const midnight = parseGrabTimestamp('27 Sep, Sun, 12:00 AM', ref);
      const noon = parseGrabTimestamp('27 Sep, Sun, 12:00 PM', ref);
      assert.strictEqual(midnight.getUTCHours(), 16, 'midnight MYT');
      assert.strictEqual(noon.getUTCHours(), 4, 'noon MYT');
    },
  },
  {
    name: 'infers the previous year for a month/day in the future',
    fn: () => {
      // Seen on 2 Jan 2027, "28 Dec" must mean 28 Dec 2026.
      const ref = new Date('2027-01-02T00:00:00Z');
      const parsed = parseGrabTimestamp('28 Dec, Mon, 10:00 AM', ref);
      assert.strictEqual(parsed.getUTCFullYear(), 2026);
      assert.strictEqual(parsed.getUTCMonth(), 11);
      assert.strictEqual(parsed.getUTCDate(), 28);
    },
  },
  {
    name: 'keeps the current year for a past month/day',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const parsed = parseGrabTimestamp('15 Mar, Sun, 10:00 AM', ref);
      assert.strictEqual(parsed.getUTCFullYear(), 2026);
    },
  },
  {
    name: 'tolerates a missing weekday in the string',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      const withDay = parseGrabTimestamp('27 Sep, Sun, 11:30 PM', ref);
      const withoutDay = parseGrabTimestamp('27 Sep, 11:30 PM', ref);
      assert.strictEqual(withoutDay.getTime(), withDay.getTime());
    },
  },
  {
    name: 'falls back to the reference date on unparseable input',
    fn: () => {
      const ref = new Date('2026-09-27T12:00:00Z');
      assert.strictEqual(parseGrabTimestamp('not a date', ref).getTime(), ref.getTime());
      assert.strictEqual(parseGrabTimestamp('', ref).getTime(), ref.getTime());
      assert.strictEqual(parseGrabTimestamp(null, ref).getTime(), ref.getTime());
    },
  },
  {
    name: 'defaults the reference date to now when omitted',
    fn: () => {
      const parsed = parseGrabTimestamp('27 Sep, Sun, 11:30 PM');
      assert.ok(!isNaN(parsed.getTime()));
      // A full year in the past or future means the year inference went wrong.
      const drift = Math.abs(Date.now() - parsed.getTime());
      assert.ok(drift < 370 * 24 * 3600 * 1000, 'parsed date is wildly out of range');
    },
  },
];

module.exports = { name, tests };
