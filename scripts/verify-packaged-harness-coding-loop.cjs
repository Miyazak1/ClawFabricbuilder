'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const executable = path.join(unpacked, 'ClawFabric Builder.exe');
const resources = path.join(unpacked, 'resources');
const appArchive = path.join(resources, 'app.asar');
const runtimeArchive = path.join(resources, 'harness-runtime.asar');
const canaryWorker = path.join(
  appArchive,
  'scripts',
  'verify-builder-harness-coding-loop.cjs',
);
const harnessConfig = path.join(
  resources,
  'app.asar.unpacked',
  'electron',
  'harness',
  'builder-coding-loop.cordis.yml',
);

function parseWorkerArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('Packaged Harness coding loop arguments are invalid.');
  if (argv.length === 0) return Object.freeze([]);
  if (argv.length === 1 && ['--resume', '--resume-unknown'].includes(argv[0])) {
    return Object.freeze([argv[0]]);
  }
  throw new Error('Packaged Harness coding loop mode is invalid.');
}

function expectedStableEvidence(workerArgs) {
  if (workerArgs.length === 0) {
    return Object.freeze({
      result_version: 'builder-harness-coding-loop-canary.v1',
      runtime_kind: 'deepseek_harness.v1',
      provider_scope: 'loopback_deterministic',
      provider_request_count: 6,
      initial_edit_observed: true,
      failed_check_recorded: true,
      repair_turn_observed: true,
      repaired_edit_observed: true,
      canonical_edit_tool_fact_count: 2,
      passed_check_recorded: true,
      terminal_status: 'run_completed',
      external_network_required: false,
    });
  }
  const unknownToolOutcomeVerified = workerArgs[0] === '--resume-unknown';
  return Object.freeze({
    result_version: 'builder-harness-native-resume-canary.v1',
    provider_scope: 'loopback_deterministic',
    cold_process_restart: true,
    native_tool_history_restored: true,
    edited_workspace_restored: true,
    external_edit_rejected: true,
    resumed_write_count: 0,
    unknown_tool_outcome_verified: unknownToolOutcomeVerified,
    provider_request_count: unknownToolOutcomeVerified ? 4 : 5,
    terminal_status: 'run_completed',
  });
}

function packagedResultVersion(workerArgs) {
  if (workerArgs.length === 0) return 'builder-packaged-harness-coding-loop-canary.v1';
  if (workerArgs[0] === '--resume') return 'builder-packaged-harness-native-resume-canary.v1';
  return 'builder-packaged-harness-native-resume-unknown-canary.v1';
}

const workerArgs = parseWorkerArgs(process.argv.slice(2));

for (const target of [executable, appArchive, runtimeArchive, harnessConfig]) {
  assert.equal(fs.statSync(target).isFile(), true, target);
}
assert.equal(
  asar.listPackage(appArchive).some(
    (entry) => entry.replaceAll('\\', '/') === '/scripts/verify-builder-harness-coding-loop.cjs',
  ),
  true,
);

const result = spawnSync(executable, [canaryWorker, ...workerArgs], {
  cwd: root,
  env: {
    PATH: process.env.PATH || path.dirname(executable),
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_NO_WARNINGS: '1',
    BUILDER_HARNESS_RUNTIME_ROOT: runtimeArchive,
    BUILDER_HARNESS_CONFIG_PATH: harnessConfig,
  },
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60_000,
  maxBuffer: 4 * 1_024 * 1_024,
});

assert.equal(result.error, undefined);
assert.equal(result.signal, null);
assert.equal(result.status, 0, result.stderr || 'Packaged Harness coding loop failed.');
assert.equal(result.stderr.trim(), '');
const evidence = JSON.parse(result.stdout);
const { canonical_event_count: canonicalEventCount, ...stableEvidence } = evidence;
if (workerArgs.length === 0) {
  assert.equal(Number.isInteger(canonicalEventCount), true);
  assert.equal(canonicalEventCount >= 38, true);
} else {
  assert.equal(canonicalEventCount, undefined);
}
assert.deepEqual(stableEvidence, expectedStableEvidence(workerArgs));

process.stdout.write(`${JSON.stringify({
  ...evidence,
  result_version: packagedResultVersion(workerArgs),
  inner_result_version: evidence.result_version,
  packaged_worker_args: workerArgs,
  executable_path: executable,
  runtime_source: 'packaged_resources_asar',
  builder_runtime_source: 'packaged_app_asar',
}, null, 2)}\n`);
