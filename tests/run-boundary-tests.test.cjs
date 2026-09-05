'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const {
  PARALLEL_CONCURRENCY,
  SERIAL_TEST_NAMES,
  boundaryTestGroups,
  runBoundaryTests,
} = require('../scripts/run-boundary-tests.cjs');

test('isolates real preview process tests from the bounded parallel boundary group', () => {
  const groups = boundaryTestGroups();
  assert.deepEqual(SERIAL_TEST_NAMES, ['builder-live-preview-dev-server-runtime.test.cjs']);
  assert.equal(PARALLEL_CONCURRENCY, 8);
  assert.equal(groups.serial.length, 1);
  assert.equal(path.basename(groups.serial[0]), SERIAL_TEST_NAMES[0]);
  assert.equal(groups.parallel.some((file) => path.basename(file) === SERIAL_TEST_NAMES[0]), false);
  assert.equal(groups.parallel.some((file) => path.basename(file) === 'run-boundary-tests.test.cjs'), true);
});

test('runs only the bounded parallel group without a shell', async () => {
  const calls = [];
  const spawnProcess = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };

  await runBoundaryTests(spawnProcess);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, process.execPath);
  assert.equal(calls[0].args.includes(`--test-concurrency=${PARALLEL_CONCURRENCY}`), true);
  assert.equal(calls[0].args.some((entry) => entry.endsWith(SERIAL_TEST_NAMES[0])), false);
  assert.deepEqual(calls.map((call) => call.options.shell), [false]);
  assert.deepEqual(calls.map((call) => call.options.stdio), ['inherit']);
});

test('package validation runs the real preview process test without another isolation worker', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.scripts['test:unit'], 'vitest run --maxWorkers=1');
  assert.equal(
    packageJson.scripts.test,
    'node --test --experimental-test-isolation=none tests/builder-live-preview-dev-server-runtime.test.cjs && node scripts/run-boundary-tests.cjs && npm run test:unit',
  );
  assert.match(
    packageJson.scripts['verify:release'],
    /^npm run lint && node --test --experimental-test-isolation=none tests\/builder-live-preview-dev-server-runtime\.test\.cjs && node scripts\/run-boundary-tests\.cjs && npm run test:unit && npm run dist/u,
  );
  assert.match(
    packageJson.scripts['test:boundaries'],
    /node --test --experimental-test-isolation=none tests\/builder-live-preview-dev-server-runtime\.test\.cjs/u,
  );
  assert.match(packageJson.scripts['test:boundaries'], /&& node scripts\/run-boundary-tests\.cjs/u);
});
