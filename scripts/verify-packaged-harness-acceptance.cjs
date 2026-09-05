'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const RESULT_VERSION = 'builder-packaged-harness-coding-loop-acceptance-gate.v1';

const ACCEPTANCE_STEPS = Object.freeze([
  Object.freeze({
    id: 'packaged_coding_loop',
    script: 'verify-packaged-harness-coding-loop.cjs',
    args: Object.freeze([]),
    timeout_ms: 90_000,
    expected_result_version: 'builder-packaged-harness-coding-loop-canary.v1',
  }),
  Object.freeze({
    id: 'packaged_native_resume',
    script: 'verify-packaged-harness-coding-loop.cjs',
    args: Object.freeze(['--resume']),
    timeout_ms: 90_000,
    expected_result_version: 'builder-packaged-harness-native-resume-canary.v1',
  }),
  Object.freeze({
    id: 'packaged_failure_feedback',
    script: 'verify-packaged-harness-failure-canary.cjs',
    args: Object.freeze([]),
    timeout_ms: 360_000,
    expected_result_version: 'builder-packaged-harness-failure-canary.v4',
  }),
]);

function parseJsonOutput(stdout, stepId) {
  if (typeof stdout !== 'string' || stdout.trim().length === 0) {
    throw new Error(`Acceptance step ${stepId} did not produce JSON evidence.`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Acceptance step ${stepId} produced invalid JSON evidence: ${error.message}`);
  }
}

function validateStepEvidence(step, evidence) {
  assert.equal(evidence?.result_version, step.expected_result_version, step.id);
  if (step.id === 'packaged_coding_loop') {
    assert.equal(evidence.runtime_kind, 'deepseek_harness.v1');
    assert.equal(evidence.provider_scope, 'loopback_deterministic');
    assert.equal(evidence.initial_edit_observed, true);
    assert.equal(evidence.failed_check_recorded, true);
    assert.equal(evidence.repair_turn_observed, true);
    assert.equal(evidence.repaired_edit_observed, true);
    assert.equal(evidence.canonical_edit_tool_fact_count, 2);
    assert.equal(evidence.passed_check_recorded, true);
    assert.equal(evidence.terminal_status, 'run_completed');
    assert.equal(evidence.external_network_required, false);
    assert.equal(evidence.runtime_source, 'packaged_resources_asar');
    assert.equal(evidence.builder_runtime_source, 'packaged_app_asar');
    return;
  }
  if (step.id === 'packaged_native_resume') {
    assert.equal(evidence.provider_scope, 'loopback_deterministic');
    assert.equal(evidence.cold_process_restart, true);
    assert.equal(evidence.native_tool_history_restored, true);
    assert.equal(evidence.edited_workspace_restored, true);
    assert.equal(evidence.external_edit_rejected, true);
    assert.equal(evidence.resumed_write_count, 0);
    assert.equal(evidence.unknown_tool_outcome_verified, false);
    assert.equal(evidence.terminal_status, 'run_completed');
    assert.equal(evidence.runtime_source, 'packaged_resources_asar');
    assert.equal(evidence.builder_runtime_source, 'packaged_app_asar');
    return;
  }
  if (step.id === 'packaged_failure_feedback') {
    assert.equal(evidence.runtime_kind, 'deepseek_harness.v1');
    assert.equal(evidence.idle?.composer_recovered, true);
    assert.equal(evidence.idle?.failure_recorded, true);
    assert.equal(evidence.crash?.composer_recovered, true);
    assert.equal(evidence.crash?.failure_recorded, true);
    assert.equal(evidence.interrupted_checkpoint?.checkpoint_recovered_after_restart, true);
    assert.equal(evidence.interrupted_checkpoint?.continue_available, true);
    assert.equal(evidence.dependency_readiness?.composer_recovered, true);
    assert.equal(evidence.dependency_preparation_allow?.isolated_workspace_only, true);
    assert.equal(evidence.dependency_preparation_allow?.project_node_modules_absent, true);
    assert.equal(evidence.dependency_preparation_failure?.composer_recovered, true);
    assert.equal(evidence.dependency_preparation_failure?.project_node_modules_absent, true);
    return;
  }
  throw new Error(`Acceptance step ${step.id} is unknown.`);
}

function summarizeEvidence(step, evidence, durationMs) {
  return Object.freeze({
    id: step.id,
    duration_ms: durationMs,
    result_version: evidence.result_version,
  });
}

function runStep(step, spawnSync = childProcess.spawnSync) {
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', step.script), ...step.args],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: step.timeout_ms,
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  assert.equal(result.signal, null, result.stderr || `Acceptance step ${step.id} was signaled.`);
  assert.equal(result.status, 0, result.stderr || `Acceptance step ${step.id} failed.`);
  const evidence = parseJsonOutput(result.stdout, step.id);
  validateStepEvidence(step, evidence);
  return summarizeEvidence(step, evidence, Date.now() - startedAt);
}

function runAcceptance({ steps = ACCEPTANCE_STEPS, spawnSync = childProcess.spawnSync } = {}) {
  const startedAt = Date.now();
  const completedSteps = steps.map((step) => runStep(step, spawnSync));
  return Object.freeze({
    result_version: RESULT_VERSION,
    runtime_kind: 'deepseek_harness.v1',
    ordinary_release_external_network_required: false,
    completed_step_count: completedSteps.length,
    duration_ms: Date.now() - startedAt,
    steps: completedSteps,
  });
}

function runCli() {
  const result = runAcceptance();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  ACCEPTANCE_STEPS,
  RESULT_VERSION,
  parseJsonOutput,
  runAcceptance,
  validateStepEvidence,
});

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
