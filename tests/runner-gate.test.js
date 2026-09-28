// The GitHub Actions runner is what the systemd timer executes, and the timer
// fires every 5 minutes around the clock. Without the trading-hours gate in
// main(), the bot would hit the Grab portal overnight and through the
// afternoon break. These tests pin the gate the timer depends on.
process.env.LOG_LEVEL = 'error';

const assert = require('assert');
const GitHubActionsRunner = require('../src/github-actions-runner');

const name = 'runner trading-hours gate';

const runner = Object.create(GitHubActionsRunner.prototype);
const at = (hh, mm) => runner.isWithinOperatingHours(new Date(Date.UTC(2026, 8, 28, hh - 8, mm)));

const tests = [
  {
    name: 'polls inside both trading windows',
    fn: () => {
      assert.strictEqual(at(11, 0), true);
      assert.strictEqual(at(13, 30), true);
      assert.strictEqual(at(15, 0), true, '15:00 is the end of the first window');
      assert.strictEqual(at(17, 0), true, '17:00 restarts');
      assert.strictEqual(at(20, 0), true);
      assert.strictEqual(at(22, 30), true, '22:30 is the end of the last window');
    },
  },
  {
    name: 'does not poll during the break or overnight',
    fn: () => {
      // Without this gate the timer would scrape the portal 24/7.
      assert.strictEqual(at(15, 1), false);
      assert.strictEqual(at(16, 0), false);
      assert.strictEqual(at(16, 59), false);
      assert.strictEqual(at(22, 31), false);
      assert.strictEqual(at(0, 0), false);
      assert.strictEqual(at(3, 0), false);
      assert.strictEqual(at(10, 59), false, 'just before the first window');
    },
  },
  {
    name: 'honours an OPERATING_HOURS override',
    fn: () => {
      const saved = process.env.OPERATING_HOURS;
      process.env.OPERATING_HOURS = '09:00-12:00';
      try {
        assert.strictEqual(runner.isWithinOperatingHours(new Date(Date.UTC(2026, 8, 28, 1, 0))), true, '09:00 MYT');
        assert.strictEqual(runner.isWithinOperatingHours(new Date(Date.UTC(2026, 8, 28, 6, 0))), false, '14:00 MYT');
      } finally {
        if (saved === undefined) delete process.env.OPERATING_HOURS;
        else process.env.OPERATING_HOURS = saved;
      }
    },
  },
  {
    name: 'main() skips before initialising a browser when outside hours',
    fn: async () => {
      // Read the source rather than spawning: spawning a real run would hit the
      // live portal. What matters is that the gate runs before runner.init().
      const fs = require('fs');
      const src = fs.readFileSync(require.resolve('../src/github-actions-runner'), 'utf8');
      const gateAt = src.indexOf('isWithinOperatingHours()');
      const initAt = src.indexOf('await runner.init()');
      assert.ok(gateAt > -1, 'main() must check trading hours');
      assert.ok(initAt > -1, 'main() must initialise the runner');
      assert.ok(gateAt < initAt, 'the gate must come before init(), so no browser is launched when closed');
      assert.ok(src.includes('FORCE_POLL'), 'there must be an override for manual runs');
    },
  },
];

module.exports = { name, tests };
