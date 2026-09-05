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
  'builder-coding-loop-compaction-canary.cordis.yml',
);

for (const target of [executable, appArchive, runtimeArchive, harnessConfig]) {
  assert.equal(fs.statSync(target).isFile(), true, target);
}
assert.equal(
  asar.listPackage(appArchive).some(
    (entry) => entry.replaceAll('\\', '/') === '/scripts/verify-builder-harness-coding-loop.cjs',
  ),
  true,
);

function runWorker(args) {
  const result = spawnSync(executable, [canaryWorker, ...args], {
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
  assert.equal(result.status, 0, result.stderr || `Packaged Harness worker failed: ${args.join(' ')}`);
  assert.equal(result.stderr.trim(), '');
  return JSON.parse(result.stdout);
}

const evidence = runWorker(['--compaction']);
const manualEvidence = runWorker(['--manual-compaction']);
const { canonical_event_count: canonicalEventCount, ...stableEvidence } = evidence;
assert.equal(Number.isInteger(canonicalEventCount), true);
assert.equal(canonicalEventCount >= 38, true);
assert.deepEqual(stableEvidence, {
  result_version: 'builder-harness-compaction-canary.v1',
  runtime_kind: 'deepseek_harness.v1',
  provider_scope: 'loopback_deterministic',
  provider_request_count: 7,
  provider_normal_request_count: 6,
  provider_compaction_request_count: 1,
  compaction_end_count: 1,
  compaction_start_count: 1,
  compaction_summary_count: 1,
  replacement_count: 1,
  context_window_tokens: 20000,
  usage_before_compaction_percent: 85,
  compacting_state_observed: true,
  post_compaction_usage_refresh_observed: true,
  usage_after_compaction_percent: 76,
  usage_drop_observed: true,
  continuation_request_observed: true,
  canonical_assistant_delta_count: 2,
  canonical_edit_tool_fact_count: 2,
  private_summary_hidden: true,
  terminal_status: 'run_completed',
  external_network_required: false,
});
const {
  canonical_event_count: manualCanonicalEventCount,
  manual_compaction_shadowed_token_count: manualShadowedTokenCount,
  manual_compaction_start_seq: manualStartSeq,
  manual_compaction_summary_seq: manualSummarySeq,
  manual_compaction_end_seq: manualEndSeq,
  usage_after_compaction_percent: manualUsageAfterPercent,
  ...stableManualEvidence
} = manualEvidence;
assert.equal(Number.isInteger(manualCanonicalEventCount), true);
assert.equal(manualCanonicalEventCount >= 38, true);
assert.equal(Number.isInteger(manualShadowedTokenCount), true);
assert.equal(manualShadowedTokenCount > 0, true);
assert.equal(manualStartSeq < manualSummarySeq && manualSummarySeq < manualEndSeq, true);
assert.equal(Number.isInteger(manualUsageAfterPercent), true);
assert.equal(manualUsageAfterPercent < 50, true);
assert.deepEqual(stableManualEvidence, {
  result_version: 'builder-harness-manual-compaction-canary.v1',
  runtime_kind: 'deepseek_harness.v1',
  provider_scope: 'loopback_deterministic',
  provider_request_count: 7,
  provider_normal_request_count: 6,
  provider_compaction_request_count: 1,
  compaction_end_count: 1,
  compaction_start_count: 1,
  compaction_summary_count: 1,
  replacement_count: 1,
  context_window_tokens: 20000,
  usage_before_compaction_percent: 50,
  compacting_state_observed: true,
  post_compaction_usage_refresh_observed: true,
  usage_drop_observed: true,
  manual_compaction_session_id: 'builder-harness-12345678-1234-4234-8234-123456789abc',
  manual_compaction_completed: true,
  manual_compaction_source_command_echoed: true,
  manual_compaction_start_count: 1,
  manual_compaction_summary_count: 1,
  manual_compaction_end_count: 1,
  manual_compaction_turn_null_observed: true,
  manual_compaction_source_command_observed: true,
  manual_compaction_closed_failure_observed: true,
  manual_compaction_closed_failure_code: 'builder_harness_programming_runtime_closed',
  continuation_request_observed: true,
  canonical_assistant_delta_count: 2,
  canonical_edit_tool_fact_count: 2,
  private_summary_hidden: true,
  terminal_status: 'run_completed',
  external_network_required: false,
});

process.stdout.write(`${JSON.stringify({
  ...evidence,
  result_version: 'builder-packaged-harness-compaction-canary.v1',
  inner_result_version: evidence.result_version,
  manual_inner_result_version: manualEvidence.result_version,
  manual_compaction_completed: manualEvidence.manual_compaction_completed,
  manual_compaction_turn_null_observed: manualEvidence.manual_compaction_turn_null_observed,
  manual_compaction_closed_failure_observed:
    manualEvidence.manual_compaction_closed_failure_observed,
  manual_compaction_continuation_request_observed: manualEvidence.continuation_request_observed,
  executable_path: executable,
  runtime_source: 'packaged_resources_asar',
  builder_runtime_source: 'packaged_app_asar',
}, null, 2)}\n`);
