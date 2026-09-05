'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ACCEPTANCE_STEPS,
  RESULT_VERSION,
  runAcceptance,
  validateStepEvidence,
} = require('../scripts/verify-packaged-harness-acceptance.cjs');

const root = path.join(__dirname, '..');

test('release gate includes the packaged Harness coding loop', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const verifier = fs.readFileSync(path.join(root, 'scripts', 'verify-package.cjs'), 'utf8');
  const wrapper = fs.readFileSync(
    path.join(root, 'scripts', 'verify-packaged-harness-coding-loop.cjs'),
    'utf8',
  );
  const acceptance = fs.readFileSync(
    path.join(root, 'scripts', 'verify-packaged-harness-acceptance.cjs'),
    'utf8',
  );

  assert.equal(
    manifest.scripts['verify:packaged-harness-coding-loop'],
    'node scripts/verify-packaged-harness-coding-loop.cjs',
  );
  assert.equal(
    manifest.scripts['verify:packaged-harness-resume'],
    'node scripts/verify-packaged-harness-coding-loop.cjs --resume',
  );
  assert.equal(
    manifest.scripts['verify:packaged-harness-acceptance'],
    'node scripts/verify-packaged-harness-acceptance.cjs',
  );
  assert.match(
    manifest.scripts['verify:release'],
    /npm run verify:packaged-harness-acceptance/u,
  );
  assert.match(verifier, /verify-builder-harness-coding-loop\.cjs/u);
  assert.match(verifier, /builder-coding-loop\.cordis\.yml/u);
  assert.match(wrapper, /ELECTRON_RUN_AS_NODE/u);
  assert.match(wrapper, /BUILDER_HARNESS_RUNTIME_ROOT/u);
  assert.match(wrapper, /BUILDER_HARNESS_CONFIG_PATH/u);
  assert.match(wrapper, /builder-packaged-harness-coding-loop-canary\.v1/u);
  assert.match(wrapper, /provider_scope:\s+'loopback_deterministic'/u);
  assert.match(wrapper, /provider_request_count:\s+6/u);
  assert.match(wrapper, /failed_check_recorded:\s+true/u);
  assert.match(wrapper, /repair_turn_observed:\s+true/u);
  assert.match(wrapper, /canonical_edit_tool_fact_count:\s+2/u);
  assert.match(wrapper, /builder-packaged-harness-native-resume-canary\.v1/u);
  assert.match(wrapper, /native_tool_history_restored:\s+true/u);
  assert.match(wrapper, /external_edit_rejected:\s+true/u);
  assert.match(wrapper, /resumed_write_count:\s+0/u);
  assert.match(wrapper, /external_network_required:\s+false/u);
  assert.match(acceptance, /verify-packaged-harness-coding-loop\.cjs/u);
  assert.match(acceptance, /verify-packaged-harness-failure-canary\.cjs/u);
  assert.match(acceptance, /packaged_coding_loop/u);
  assert.match(acceptance, /packaged_native_resume/u);
  assert.match(acceptance, /packaged_failure_feedback/u);
  assert.match(acceptance, /ordinary_release_external_network_required:\s+false/u);
});

test('acceptance gate aggregates only packaged coding-loop product evidence', () => {
  assert.equal(RESULT_VERSION, 'builder-packaged-harness-coding-loop-acceptance-gate.v1');
  assert.deepEqual(
    ACCEPTANCE_STEPS.map((step) => [step.id, step.script, step.args]),
    [
      ['packaged_coding_loop', 'verify-packaged-harness-coding-loop.cjs', []],
      ['packaged_native_resume', 'verify-packaged-harness-coding-loop.cjs', ['--resume']],
      ['packaged_failure_feedback', 'verify-packaged-harness-failure-canary.cjs', []],
    ],
  );

  const outputs = new Map([
    ['packaged_coding_loop', {
      result_version: 'builder-packaged-harness-coding-loop-canary.v1',
      runtime_kind: 'deepseek_harness.v1',
      provider_scope: 'loopback_deterministic',
      initial_edit_observed: true,
      failed_check_recorded: true,
      repair_turn_observed: true,
      repaired_edit_observed: true,
      canonical_edit_tool_fact_count: 2,
      passed_check_recorded: true,
      terminal_status: 'run_completed',
      external_network_required: false,
      runtime_source: 'packaged_resources_asar',
      builder_runtime_source: 'packaged_app_asar',
    }],
    ['packaged_native_resume', {
      result_version: 'builder-packaged-harness-native-resume-canary.v1',
      provider_scope: 'loopback_deterministic',
      cold_process_restart: true,
      native_tool_history_restored: true,
      edited_workspace_restored: true,
      external_edit_rejected: true,
      resumed_write_count: 0,
      unknown_tool_outcome_verified: false,
      terminal_status: 'run_completed',
      runtime_source: 'packaged_resources_asar',
      builder_runtime_source: 'packaged_app_asar',
    }],
    ['packaged_failure_feedback', {
      result_version: 'builder-packaged-harness-failure-canary.v4',
      runtime_kind: 'deepseek_harness.v1',
      idle: { composer_recovered: true, failure_recorded: true },
      crash: { composer_recovered: true, failure_recorded: true },
      interrupted_checkpoint: {
        checkpoint_recovered_after_restart: true,
        continue_available: true,
      },
      dependency_readiness: { composer_recovered: true },
      dependency_preparation_allow: {
        isolated_workspace_only: true,
        project_node_modules_absent: true,
      },
      dependency_preparation_failure: {
        composer_recovered: true,
        project_node_modules_absent: true,
      },
    }],
  ]);

  const result = runAcceptance({
    spawnSync: (_file, args) => {
      const isFailure = args.some((entry) => entry.endsWith('verify-packaged-harness-failure-canary.cjs'));
      const id = isFailure
        ? 'packaged_failure_feedback'
        : args.includes('--resume') ? 'packaged_native_resume' : 'packaged_coding_loop';
      return {
        error: undefined,
        signal: null,
        status: 0,
        stderr: '',
        stdout: JSON.stringify(outputs.get(id)),
      };
    },
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(result.ordinary_release_external_network_required, false);
  assert.deepEqual(
    result.steps.map((step) => [step.id, step.result_version]),
    ACCEPTANCE_STEPS.map((step) => [step.id, step.expected_result_version]),
  );
});

test('acceptance evidence rejects missing resume restoration facts', () => {
  assert.throws(
    () => validateStepEvidence(ACCEPTANCE_STEPS[1], {
      result_version: 'builder-packaged-harness-native-resume-canary.v1',
      provider_scope: 'loopback_deterministic',
      cold_process_restart: true,
      native_tool_history_restored: false,
      edited_workspace_restored: true,
      external_edit_rejected: true,
      resumed_write_count: 0,
      unknown_tool_outcome_verified: false,
      terminal_status: 'run_completed',
      runtime_source: 'packaged_resources_asar',
      builder_runtime_source: 'packaged_app_asar',
    }),
    /Expected values to be strictly equal/u,
  );
});
