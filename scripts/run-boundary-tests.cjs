'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_PATH = path.resolve(__dirname, '..');
const TESTS_PATH = path.join(ROOT_PATH, 'tests');
const PARALLEL_CONCURRENCY = 8;
const SERIAL_TEST_NAMES = Object.freeze([
  'builder-live-preview-dev-server-runtime.test.cjs',
]);

function boundaryTestGroups() {
  const allTestNames = fs.readdirSync(TESTS_PATH, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.cjs'))
    .map((entry) => entry.name)
    .sort();
  for (const name of SERIAL_TEST_NAMES) {
    if (!allTestNames.includes(name)) throw new Error('A serial boundary test is unavailable.');
  }
  return Object.freeze({
    serial: Object.freeze(SERIAL_TEST_NAMES.map((name) => path.join(TESTS_PATH, name))),
    parallel: Object.freeze(allTestNames
      .filter((name) => !SERIAL_TEST_NAMES.includes(name))
      .map((name) => path.join(TESTS_PATH, name))),
  });
}

function runNodeTests(files, concurrency, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(process.execPath, [
        '--test',
        `--test-concurrency=${concurrency}`,
        ...files,
      ], {
        cwd: ROOT_PATH,
        env: process.env,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      });
    } catch {
      reject(new Error('The boundary test process could not be started.'));
      return;
    }
    child.once('error', () => reject(new Error('The boundary test process could not be started.')));
    child.once('close', (code, signal) => {
      if (signal !== null || code !== 0) {
        reject(new Error('The boundary test process failed.'));
        return;
      }
      resolve();
    });
  });
}

async function runBoundaryTests(spawnProcess = spawn) {
  const groups = boundaryTestGroups();
  await runNodeTests(groups.parallel, PARALLEL_CONCURRENCY, spawnProcess);
}

if (require.main === module) {
  runBoundaryTests().catch(() => {
    process.stderr.write('Boundary validation failed.\n');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  PARALLEL_CONCURRENCY,
  SERIAL_TEST_NAMES,
  boundaryTestGroups,
  runBoundaryTests,
  runNodeTests,
});
