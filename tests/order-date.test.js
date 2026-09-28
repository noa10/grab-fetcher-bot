// orderDate is the MYT calendar day an order was placed, and it is half the
// dedup key (orderNumber + orderDate). Getting it wrong silently creates a
// duplicate row whenever the History tab lists a late-night order under the
// next MYT day.
//
// The MYT day begins at 16:00 UTC, so the old UTC-truncation misfiled anything
// placed between 00:00 and 08:00 MYT under the previous day. Verified on real
// data: four orders placed 04:18-05:19 MYT on 2026-09-28 were stored as
// 2026-09-27.
process.env.LOG_LEVEL = 'error';

const assert = require('assert');
const Order = require('../src/models/Order');

const name = 'orderDate is the MYT day';

// The MYT day label for a UTC instant, computed independently of the
// implementation, so the test cannot simply mirror the code.
const mytDayLabel = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const mytDayAsStored = ts => Order.toOrderDate(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

const tests = [
  {
    name: 'orders before 08:00 MYT are filed under the correct MYT day',
    fn: () => {
      // 04:18 MYT on 28 Sep = 20:18 UTC on 27 Sep. UTC-truncation gives the 27th.
      const cases = [
        ['2026-09-27T20:18:00Z', '2026-09-28'], // 04:18 MYT 28 Sep
        ['2026-09-27T20:27:00Z', '2026-09-28'], // 04:27 MYT 28 Sep
        ['2026-09-27T20:40:00Z', '2026-09-28'], // 04:40 MYT 28 Sep
        ['2026-09-27T21:19:00Z', '2026-09-28'], // 05:19 MYT 28 Sep
        ['2026-09-27T16:00:00Z', '2026-09-28'], // exactly 00:00 MYT 28 Sep
        ['2026-09-27T15:59:00Z', '2026-09-27'], // 23:59 MYT 27 Sep
      ];
      for (const [iso, expected] of cases) {
        assert.strictEqual(
          mytDayAsStored(new Date(iso)),
          expected,
          `${iso} (${mytDayLabel(iso)} MYT) should file as ${expected}`
        );
      }
    },
  },
  {
    name: 'agrees with the MYT calendar across a whole day',
    fn: () => {
      // Walk every hour of one UTC day; the stored day must always match what
      // a MYT calendar would report, including the two boundary hours.
      let checked = 0;
      for (let h = 0; h < 24; h++) {
        const ts = new Date(Date.UTC(2026, 8, 27, h, 30));
        assert.strictEqual(mytDayAsStored(ts), mytDayLabel(ts.toISOString()), `hour ${h} UTC`);
        checked++;
      }
      assert.strictEqual(checked, 24);
    },
  },
  {
    name: 'spans the month boundary correctly',
    fn: () => {
      // 00:30 MYT on 1 Oct = 16:30 UTC on 30 Sep.
      assert.strictEqual(mytDayAsStored(new Date('2026-09-30T16:30:00Z')), '2026-10-01');
      // 23:30 MYT on 30 Sep = 15:30 UTC on 30 Sep.
      assert.strictEqual(mytDayAsStored(new Date('2026-09-30T15:30:00Z')), '2026-09-30');
    },
  },
  {
    name: 'returns midnight MYT, not a UTC midnight',
    fn: () => {
      const d = Order.toOrderDate(new Date('2026-09-27T20:18:00Z'));
      // Midnight MYT on 28 Sep is 16:00 UTC on 27 Sep.
      assert.strictEqual(d.toISOString(), '2026-09-27T16:00:00.000Z');
      assert.strictEqual(d.getUTCHours(), 16, 'stored day starts at 16:00 UTC');
      assert.strictEqual(d.getUTCMinutes(), 0);
    },
  },
  {
    name: 'is stable and idempotent',
    fn: () => {
      const ts = new Date('2026-09-27T20:18:00Z');
      const a = Order.toOrderDate(ts);
      const b = Order.toOrderDate(a);
      assert.strictEqual(a.getTime(), b.getTime(), 're-deriving from the result must be stable');
      // and it does not mutate its input
      const before = ts.getTime();
      Order.toOrderDate(ts);
      assert.strictEqual(ts.getTime(), before, 'input timestamp must not be mutated');
    },
  },
  {
    name: 'accepts a Date, an ISO string, and defaults to now',
    fn: () => {
      assert.strictEqual(mytDayAsStored(new Date('2026-09-27T20:18:00Z')), '2026-09-28');
      assert.strictEqual(mytDayAsStored('2026-09-27T20:18:00Z'), '2026-09-28');
      const now = Order.toOrderDate();
      assert.ok(now instanceof Date && !isNaN(now.getTime()), 'defaults to a valid Date');
      assert.strictEqual(now.getUTCHours(), 16, 'today is also stored at 16:00 UTC');
    },
  },
];

module.exports = { name, tests };
