'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  dependencyReadinessEvidence,
  descendantProcesses,
  failedRunEvidence,
  harnessProcesses,
  parseWindowsProcessSnapshot,
  runtimeIdleTimeoutMs,
} = require('../scripts/verify-packaged-harness-failure-canary.cjs');

const repositoryRoot = path.join(__dirname, '..');

test('parses a BOM-prefixed Windows process snapshot and resolves descendants', () => {
  const snapshot = parseWindowsProcessSnapshot(`\uFEFF${JSON.stringify([
    { CommandLine: 'builder main', Name: 'ClawFabric Builder.exe', ParentProcessId: 10, ProcessId: 20 },
    { CommandLine: 'renderer', Name: 'ClawFabric Builder.exe', ParentProcessId: 20, ProcessId: 21 },
    {
      CommandLine: 'ClawFabric Builder.exe packaged-bin.js builder-coding-loop.cordis.yml',
      Name: 'ClawFabric Builder.exe',
      ParentProcessId: 21,
      ProcessId: 22,
    },
    { CommandLine: null, Name: 'unrelated.exe', ParentProcessId: 99, ProcessId: 100 },
  ])}`);

  assert.deepEqual(descendantProcesses(20, snapshot), [
    { command_line: 'renderer', name: 'ClawFabric Builder.exe', parent_process_id: 20, process_id: 21 },
    {
      command_line: 'ClawFabric Builder.exe packaged-bin.js builder-coding-loop.cordis.yml',
      name: 'ClawFabric Builder.exe',
      parent_process_id: 21,
      process_id: 22,
    },
  ]);
  assert.deepEqual(harnessProcesses(snapshot).map((record) => record.process_id), [22]);
});

test('rejects malformed process snapshots and process-tree inputs', () => {
  assert.throws(() => parseWindowsProcessSnapshot('not-json'), /snapshot is invalid/u);
  assert.throws(
    () => parseWindowsProcessSnapshot(JSON.stringify({
      CommandLine: null,
      Name: '',
      ParentProcessId: 1,
      ProcessId: 2,
    })),
    /snapshot is invalid/u,
  );
  assert.throws(() => descendantProcesses(0, []), /Process tree input is invalid/u);
});

test('selects terminal failed run and turn evidence without provider details', () => {
  const evidence = failedRunEvidence({
    conversation: {
      item_facts: {
        counts: { candidate_ready_count: 0, run_completed_count: 1, turn_completed_count: 0 },
      },
      recorded_active_turn_id: 'builder-turn:retained-for-retry',
    },
  });

  assert.equal(evidence.active_turn_id, 'builder-turn:retained-for-retry');
  assert.equal(evidence.counts.run_completed_count, 1);
  assert.equal(evidence.counts.turn_completed_count, 0);
  assert.equal(evidence.counts.candidate_ready_count, 0);
});

test('selects dependency-readiness evidence and repair absence', () => {
  const evidence = dependencyReadinessEvidence({
    conversation: {
      item_facts: {
        counts: { candidate_ready_count: 1, run_completed_count: 1, turn_completed_count: 1 },
      },
    },
    check_run_outcome_projection: {
      status: 'incomplete',
      environment_reason: 'dependency_workspace_missing',
    },
  }, [
    { response_kind: 'harness_tool_read' },
    { response_kind: 'harness_tool_write_package.json' },
    { response_kind: 'harness_text_completed' },
  ]);

  assert.equal(evidence.check_status, 'incomplete');
  assert.equal(evidence.environment_reason, 'dependency_workspace_missing');
  assert.equal(evidence.repair_response_count, 0);
  assert.equal(evidence.counts.run_completed_count, 1);
});

test('counts dependency-readiness repair responses without leaking prompts', () => {
  const evidence = dependencyReadinessEvidence({
    conversation: { item_facts: { counts: { run_completed_count: 1 } } },
    check_run_outcome_projection: {
      status: 'incomplete',
      environment_reason: 'dependency_workspace_missing',
    },
  }, [
    { response_kind: 'harness_tool_read_repair' },
    { response_kind: 'harness_tool_edit_check.js' },
  ]);

  assert.equal(evidence.repair_response_count, 2);
  assert.deepEqual(evidence.response_kinds, [
    'harness_tool_read_repair',
    'harness_tool_edit_check.js',
  ]);
});

test('dependency-readiness canary exercises dependency preparation denial', () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-harness-failure-canary.cjs'),
    'utf8',
  );

  assert.match(source, /data-builder-dependency-preparation/u);
  assert.match(source, /data-builder-deny-dependency-preparation/u);
  assert.match(source, /install_denied/u);
  assert.match(source, /dependency_preparation_denial_recorded/u);
});

test('dependency-preparation canary exercises approve-once local install success', () => {
  const failureSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-harness-failure-canary.cjs'),
    'utf8',
  );
  const providerSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-canary-default.cjs'),
    'utf8',
  );

  assert.match(failureSource, /dependency_preparation_allow/u);
  assert.match(failureSource, /data-builder-allow-dependency-preparation/u);
  assert.match(failureSource, /waitForDependencyPreparationInFlight/u);
  assert.match(failureSource, /Preparing\.\.\./u);
  assert.match(failureSource, /duplicate_prepare_suppressed/u);
  assert.match(failureSource, /check_passed_after_preparation/u);
  assert.match(failureSource, /project_node_modules_absent/u);
  assert.match(providerSource, /harnessDependencyLocalInstall/u);
  assert.match(providerSource, /file:\.\/tools\/clawfabric-local-check-tool/u);
  assert.match(providerSource, /clawfabric-local-check-tool --version/u);
});

test('dependency-preparation canary exercises approve-once install failure', () => {
  const failureSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-harness-failure-canary.cjs'),
    'utf8',
  );
  const providerSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-canary-default.cjs'),
    'utf8',
  );

  assert.match(failureSource, /dependency_preparation_failure/u);
  assert.match(failureSource, /dependency_preparation_failed/u);
  assert.match(failureSource, /Dependency preparation failure did not keep the UI in Preparing state/u);
  assert.match(failureSource, /duplicate_prepare_suppressed/u);
  assert.match(failureSource, /data-builder-dependency-preparation-failed/u);
  assert.match(failureSource, /save_not_enabled/u);
  assert.match(providerSource, /harnessDependencyInstallFails/u);
  assert.match(providerSource, /ClawFabric Broken Local Check Tool/u);
});

test('keeps crash detection independent from idle supervision', () => {
  assert.equal(runtimeIdleTimeoutMs('idle'), 10_000);
  assert.equal(runtimeIdleTimeoutMs('crash'), 30_000);
  assert.throws(() => runtimeIdleTimeoutMs('unknown'), /kind is invalid/u);
});

test('release gate includes packaged Harness failure convergence', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const acceptance = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-packaged-harness-acceptance.cjs'),
    'utf8',
  );

  assert.equal(
    packageJson.scripts['verify:packaged-harness-failure'],
    'node scripts/verify-packaged-harness-failure-canary.cjs',
  );
  assert.match(packageJson.scripts['verify:release'], /npm run verify:packaged-harness-acceptance/u);
  assert.match(acceptance, /verify-packaged-harness-failure-canary\.cjs/u);
  assert.match(acceptance, /packaged_failure_feedback/u);
});
