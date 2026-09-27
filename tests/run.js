// Zero-dependency test harness.
//
// Each test file exports { name, tests: [{ name, fn }] } where fn may be async and
// asserts by throwing. A test that returns 'skip' is reported as skipped rather
// than failed — that is how MongoDB-dependent tests degrade on a bare checkout.
const path = require('path');

const FILES = [
  './timestamp.test.js',
  './operating-hours.test.js',
  './extractor.test.js',
  './order-model.test.js',
  './state-sync.test.js',
  './api-session.test.js',
];

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m';

async function run() {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  console.log(`\ngrab-fetcher-bot test suite\n${'='.repeat(60)}\n`);

  for (const file of FILES) {
    let mod;
    try {
      mod = require(file);
    } catch (e) {
      console.log(`  ${RED}FAIL${RESET}  could not load ${path.basename(file)}: ${e.message}`);
      failed++;
      failures.push({ suite: path.basename(file), test: '<load>', error: e });
      continue;
    }

    console.log(`${BOLD}${mod.name}${RESET}`);

    // A suite can expose a guard: if it throws or reports unavailable, the
    // remaining tests are skipped rather than failed.
    const suiteAvailable = mod.available ? await mod.available() : true;

    for (const t of mod.tests) {
      if (suiteAvailable === false) {
        console.log(`  ${YELLOW}SKIP${RESET}  ${t.name}`);
        skipped++;
        continue;
      }
      try {
        const result = await t.fn();
        if (result === 'skip') {
          console.log(`  ${YELLOW}SKIP${RESET}  ${t.name}`);
          skipped++;
        } else {
          console.log(`  ${GREEN}PASS${RESET}  ${t.name}`);
          passed++;
        }
      } catch (e) {
        // A MongoDB outage mid-run should skip the rest, not cascade failures.
        if (e && (e.name === 'MongooseServerSelectionError' || /buffering timed out|ECONNREFUSED|topology/i.test(String(e.message)))) {
          console.log(`  ${YELLOW}SKIP${RESET}  ${t.name} (database unavailable)`);
          skipped++;
          continue;
        }
        console.log(`  ${RED}FAIL${RESET}  ${t.name}`);
        console.log(`        ${String(e.message).split('\n').join('\n        ')}`);
        failed++;
        failures.push({ suite: mod.name, test: t.name, error: e });
      }
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) {
      console.log(`  - ${f.suite} > ${f.test}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test harness crashed:', e);
  process.exit(1);
});
