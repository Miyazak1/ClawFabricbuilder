'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION,
  BuilderEnvironmentReadinessDiagnosisError,
  createBuilderEnvironmentReadinessDiagnosis,
  sanitizeBuilderEnvironmentReadinessDiagnosis,
} = require('../electron/builder-environment-readiness-diagnosis.cjs');
const {
  createBuilderRuntimeReadinessSnapshot,
} = require('../electron/builder-runtime-readiness-snapshot.cjs');
const {
  admittedCheck,
} = require('./helpers/builder-check-run-fixture.cjs');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-env-diagnosis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function snapshotInput(selected, overrides = {}) {
  return {
    project_id: selected.admission.project_id,
    candidate_id: selected.admission.candidate_id,
    package_manager: selected.admission.package_manager,
    check_run_admission: selected.admission,
    source_tree: selected.tree,
    project_root_path: null,
    check_workspace_path: null,
    host_toolchain_state: 'visible',
    toolchain_probe: null,
    install_permission: 'not_requested',
    updated_at_ms: 120,
    ...overrides,
  };
}

function diagnosis(selected, snapshot) {
  return createBuilderEnvironmentReadinessDiagnosis({
    check_run_admission: selected.admission,
    runtime_readiness_snapshot: snapshot,
    diagnosed_at_ms: 130,
  });
}

function assertDiagnosisError(error) {
  assert.equal(error instanceof BuilderEnvironmentReadinessDiagnosisError, true);
  assert.equal(error.code, 'builder_environment_readiness_diagnosis_invalid');
  assert.equal(error.message, 'Builder environment readiness diagnosis could not be verified.');
  assert.doesNotMatch(JSON.stringify(error), /node_modules|Temp|secret|token|PATH|USERPROFILE/iu);
  return true;
}

test('projects missing isolated dependencies as a prepare-once action without install authority', (t) => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const projectRoot = tempRoot(t);
  const checkWorkspace = tempRoot(t);
  fs.mkdirSync(path.join(projectRoot, 'node_modules'));
  const snapshot = createBuilderRuntimeReadinessSnapshot(snapshotInput(selected, {
    project_root_path: projectRoot,
    check_workspace_path: checkWorkspace,
  }));
  const result = diagnosis(selected, snapshot);

  assert.equal(result.diagnosis_version, BUILDER_ENVIRONMENT_READINESS_DIAGNOSIS_VERSION);
  assert.equal(result.readiness_state, 'dependencies_not_prepared');
  assert.equal(result.primary_action, 'prepare_once');
  assert.equal(result.project_dependency_state, 'install_present');
  assert.equal(result.check_workspace_dependency_state, 'install_missing');
  assert.equal(result.authority.dependency_preparation, false);
  assert.equal(result.authority.browser_preview_authority, 'readiness_context_only_no_install_decision');
  assert.equal(result.authority.command_execution, false);
  assert.equal(result.authority.project_workspace_write, false);
  assert.equal(result.authority.check_workspace_write, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(projectRoot.replace(/\\/gu, '\\\\'), 'u'));
  assert.deepEqual(sanitizeBuilderEnvironmentReadinessDiagnosis(result), result);
});

test('projects prepared isolated dependencies as ready to run without reinstalling', (t) => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspace = tempRoot(t);
  fs.mkdirSync(path.join(checkWorkspace, 'node_modules'));
  const snapshot = createBuilderRuntimeReadinessSnapshot(snapshotInput(selected, {
    check_workspace_path: checkWorkspace,
  }));
  const result = diagnosis(selected, snapshot);

  assert.equal(result.readiness_state, 'ready');
  assert.equal(result.primary_action, 'run_check');
  assert.equal(result.dependency_strategy, 'can_run_without_install');
});

test('keeps host toolchain misses distinct from dependency preparation', (t) => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspace = tempRoot(t);
  fs.mkdirSync(path.join(checkWorkspace, 'node_modules'));
  const snapshot = createBuilderRuntimeReadinessSnapshot(snapshotInput(selected, {
    check_workspace_path: checkWorkspace,
    host_toolchain_state: 'missing',
  }));
  const result = diagnosis(selected, snapshot);

  assert.equal(result.readiness_state, 'host_toolchain_missing');
  assert.equal(result.primary_action, 'show_missing_toolchain');
  assert.notEqual(result.primary_action, 'prepare_once');
});

test('fails closed on drift and hostile public projections', (t) => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const foreign = admittedCheck('npm', 'build', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspace = tempRoot(t);
  const snapshot = createBuilderRuntimeReadinessSnapshot(snapshotInput(selected, {
    check_workspace_path: checkWorkspace,
  }));
  const result = diagnosis(selected, snapshot);

  assert.throws(
    () => createBuilderEnvironmentReadinessDiagnosis({
      check_run_admission: foreign.admission,
      runtime_readiness_snapshot: snapshot,
      diagnosed_at_ms: 130,
    }),
    assertDiagnosisError,
  );
  assert.throws(
    () => sanitizeBuilderEnvironmentReadinessDiagnosis({
      ...result,
      authority: {
        ...result.authority,
        dependency_preparation: true,
      },
    }),
    assertDiagnosisError,
  );
  assert.throws(
    () => sanitizeBuilderEnvironmentReadinessDiagnosis(new Proxy(result, {})),
    assertDiagnosisError,
  );
});
