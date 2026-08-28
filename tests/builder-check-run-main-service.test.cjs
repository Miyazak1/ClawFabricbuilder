'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunMainServiceError,
  createBuilderCheckRunMainService,
} = require('../electron/builder-check-run-main-service.cjs');
const {
  createBuilderCheckRunActivityRegistry,
} = require('../electron/builder-check-run-activity-registry.cjs');
const { createBuilderCheckRun } = require('../electron/builder-check-run.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('../electron/builder-check-run-status-projection.cjs');
const {
  createBuilderRuntimeReadinessSnapshot,
} = require('../electron/builder-runtime-readiness-snapshot.cjs');
const { admittedCheck } = require('./helpers/builder-check-run-fixture.cjs');

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  throw new Error('invalid canonical test value');
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function dependencyPreparationReceipt(selected, status = 'prepared') {
  const unsigned = {
    receipt_version: 'builder-check-dependency-preparation-receipt.v1',
    project_id: selected.admission.project_id,
    candidate_id: selected.admission.candidate_id,
    package_manager: selected.runtime.package_manager,
    install_command: 'npm install',
    status,
    exit_code: status === 'prepared' ? 0 : 1,
    started_at_ms: 100,
    completed_at_ms: 100,
    output_digest: `sha256:${'5'.repeat(64)}`,
    authority: {
      preparation_authority: 'main_owned_dependency_preparation_v1',
      workspace_authority: 'trusted_candidate_check_workspace',
      renderer_authority: 'not_present',
      provider_dispatch: false,
      harness_dispatch: false,
      project_workspace_write: false,
      check_workspace_write: true,
      git_write: false,
      sqlite_write: false,
      network_access: 'package_manager_default',
      install_authority: 'explicit_allow_once',
      raw_output: 'digest_only',
      path_disclosure: 'not_serialized',
    },
  };
  return Object.freeze({
    ...unsigned,
    receipt_digest: sha256Canonical(unsigned),
  });
}

function toolchainProbe(selected, overrides = {}) {
  const nodeState = overrides.probeNodeState ?? 'visible';
  const packageManagerState = overrides.probePackageManagerState ?? 'visible';
  const unsigned = {
    probe_version: 'builder-runtime-toolchain-probe.v1',
    package_manager: selected.runtime.package_manager,
    node_state: nodeState,
    package_manager_state: packageManagerState,
    node_version: nodeState === 'visible' ? 'v22.22.3' : null,
    package_manager_version: packageManagerState === 'visible' ? '10.9.3' : null,
    node_failure: nodeState === 'missing' ? 'spawn_failed' : 'none',
    package_manager_failure: packageManagerState === 'missing' ? 'spawn_failed' : 'none',
    policy: {
      node_probe: 'required_for_node_package_managers',
      package_manager_probe: 'selected_package_manager_only',
      timeout_ms: 5000,
      output_budget_bytes: 512,
      shell: false,
      network_access: false,
      install_execution: false,
      raw_output_serialization: false,
    },
    authority: {
      probe_authority: 'main_owned_bounded_toolchain_version_probe_v1',
      renderer_authority: 'not_present',
      provider_dispatch: false,
      harness_dispatch: false,
      path_disclosure: 'not_serialized',
      environment_variable_disclosure: false,
      secret_access: 'not_present',
      source_read: 'not_present',
      source_write: false,
      git_write: false,
      sqlite_write: false,
      network_access: false,
      install_authority: 'not_granted',
    },
    probed_at_ms: 100,
  };
  const digest = sha256Canonical(unsigned);
  return Object.freeze({
    ...unsigned,
    probe_id: `builder-runtime-toolchain-probe:${digest.slice('sha256:'.length)}`,
    probe_digest: digest,
  });
}

function request(selected) {
  return {
    draft_id: selected.draft_id,
    draft_checkpoint_ref: selected.checkpoint,
    git_candidate_receipt: selected.candidate,
    git_verification_receipt: selected.verification,
    project_understanding_snapshot: selected.understanding,
    command_profile_id: selected.command_profile_id,
    source_tree: selected.tree,
  };
}

function harness(status = 'passed', overrides = {}) {
  const selected = overrides.selected ?? admittedCheck();
  const calls = [];
  let stored = null;
  let workspace = null;
  const service = createBuilderCheckRunMainService({
    runtime_resolver: {
      resolver_version: 'builder-packaged-check-runtime-resolver.v1',
      resolve_npm_runtime() {
        calls.push('resolve');
        return selected.runtime;
      },
    },
    workspace_materializer: {
      materializer_version: 'builder-check-workspace-materializer.v1',
      materialize_candidate(input) {
        calls.push('materialize');
        assert.equal(input.source_tree, selected.tree);
        workspace = Object.freeze({ token: 'workspace' });
        return workspace;
      },
      cleanup(input) {
        calls.push('cleanup');
        assert.equal(input, workspace);
        workspace = null;
        return { cleaned: true, reason: 'removed' };
      },
      ...(overrides.readinessSnapshot
        ? {
          read_workspace_readiness_snapshot(input) {
            calls.push('readiness');
            assert.equal(input.workspace_admission, workspace);
            assert.equal(input.project_root_path, overrides.projectRootPath ?? null);
            assert.equal(input.toolchain_probe.package_manager, selected.runtime.package_manager);
            return overrides.readinessSnapshot(input);
          },
        }
        : {}),
    },
    project_workspace_path_service: {
      service_version: 'builder-project-workspace-path-service.v1',
      async resolve_project_workspace_path(input) {
        calls.push('project-root');
        assert.equal(input.project_id, selected.admission.project_id);
        return Object.freeze({
          result_version: 'builder-project-workspace-path-result.v1',
          project_id: selected.admission.project_id,
          project_root_path: overrides.projectRootPath ?? null,
          authority: 'main_owned_bound_project_workspace_path',
        });
      },
    },
    check_run_runner: {
      runner_version: 'builder-check-run-runner.v1',
      async run_check(input) {
        calls.push('run');
        if (overrides.runnerError) throw new Error('private runtime path');
        workspace = null;
        return createBuilderCheckRun({
          check_run_admission: input.check_run_admission,
          status,
          exit_code: status === 'passed' ? 0 : status === 'failed' ? 2 : null,
          output_digest: `sha256:${'e'.repeat(64)}`,
          failure_class: status === 'passed' ? 'none' : status === 'failed' ? 'command_failed' : status,
          started_at_ms: 101,
          completed_at_ms: 120,
        });
      },
    },
    dependency_preparer: {
      preparer_version: 'builder-check-dependency-preparer.v1',
      async prepare_dependencies(input) {
        calls.push('prepare');
        assert.equal(input.check_run_admission.project_id, selected.admission.project_id);
        assert.equal(input.workspace_admission, workspace);
        assert.equal(input.package_manager, selected.runtime.package_manager);
        if (overrides.prepareError) throw new Error('private npm path');
        return overrides.prepareReceipt
          ? overrides.prepareReceipt(input)
          : dependencyPreparationReceipt(selected, overrides.prepareStatus ?? 'prepared');
      },
    },
    toolchain_probe_service: {
      service_version: 'builder-runtime-toolchain-probe-service.v1',
      async probe_package_manager(input) {
        calls.push('probe');
        assert.equal(input.package_manager, selected.runtime.package_manager);
        return toolchainProbe(selected, overrides);
      },
    },
    check_run_store: {
      store_version: 'builder-check-run-store.v1',
      record_check_run({ check_run: checkRun }) {
        calls.push('record');
        if (overrides.storeError) throw new Error('private sqlite path');
        stored = checkRun;
        return { operation: 'check_run_recorded' };
      },
    },
    check_run_status_service: {
      service_version: 'builder-check-run-status-service.v1',
      read_current_check_run_status(input) {
        calls.push('status');
        assert.equal(input.project_id, stored.project_id);
        assert.equal(input.candidate_id, stored.candidate_id);
        return {
          check_run_status_projection: projectBuilderCheckRunStatus({ check_run: stored }),
        };
      },
    },
    activity_registry: createBuilderCheckRunActivityRegistry({
      on_activity_changed(event) {
        calls.push('notify');
        assert.equal(event.project_id, stored.project_id);
        assert.equal(event.candidate_id, stored.candidate_id);
        assert.equal(event.activity, null);
      },
    }),
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms() {
        calls.push('clock');
        return 100;
      },
    },
  });
  return { selected, service, calls, get stored() { return stored; } };
}

test('orchestrates approved candidate check through runtime, workspace, runner, store, and status', async () => {
  const h = harness();
  const result = await h.service.run_approved_check(request(h.selected));
  assert.equal(result.result_version, 'builder-check-run-main-result.v1');
  assert.equal(result.operation, 'approved_check_completed');
  assert.equal(result.check_run_status_projection.status, 'passed');
  assert.equal(result.check_run_status_projection.check_run_id, h.stored.check_run_id);
  assert.deepEqual(h.calls, [
    'resolve',
    'clock',
    'probe',
    'project-root',
    'materialize',
    'run',
    'record',
    'status',
    'notify',
  ]);
  assert.ok(Object.isFrozen(result));
});

test('records a failed check as review evidence instead of turning it into a service failure', async () => {
  const h = harness('failed');
  const result = await h.service.run_approved_check(request(h.selected));
  assert.equal(result.check_run_status_projection.status, 'failed');
  assert.equal(result.check_run_status_projection.label, 'Check failed');
  assert.equal(h.stored.status, 'failed');
});

test('records dependency workspace readiness blocks without starting the runner', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
  const h = harness('passed', {
    selected,
    readinessSnapshot(input) {
      return createBuilderRuntimeReadinessSnapshot({
        project_id: selected.admission.project_id,
        candidate_id: selected.admission.candidate_id,
        package_manager: selected.admission.package_manager,
        check_run_admission: selected.admission,
        source_tree: selected.tree,
        project_root_path: null,
        check_workspace_path: checkWorkspacePath,
        host_toolchain_state: 'visible',
        toolchain_probe: null,
        install_permission: input.install_permission,
        updated_at_ms: input.updated_at_ms,
      });
    },
  });
  const result = await h.service.run_approved_check(request(h.selected));

  assert.equal(result.check_run_status_projection.status, 'incomplete');
  assert.equal(result.check_run_status_projection.label, 'Check unavailable');
  assert.equal(
    result.check_run_status_projection.environment_reason,
    'dependency_workspace_missing',
  );
  assert.equal(
    result.check_run_status_projection.summary,
    'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
  );
  assert.equal(h.stored.status, 'environment_unavailable');
  assert.equal(h.stored.environment_reason, 'dependency_workspace_missing');
  assert.deepEqual(h.calls, [
    'resolve',
    'clock',
    'probe',
    'project-root',
    'materialize',
    'readiness',
    'clock',
    'cleanup',
    'record',
    'status',
    'notify',
  ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('diagnoses dependency readiness without preparing, running, storing, or notifying', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.diagnose_check_environment(request(h.selected));

    assert.equal(result.result_version, 'builder-check-run-environment-diagnosis-result.v1');
    assert.equal(result.operation, 'check_environment_diagnosed');
    assert.equal(result.environment_diagnosis.readiness_state, 'dependencies_not_prepared');
    assert.equal(result.environment_diagnosis.primary_action, 'prepare_once');
    assert.equal(result.environment_diagnosis.authority.command_execution, false);
    assert.equal(result.environment_diagnosis.authority.dependency_preparation, false);
    assert.equal(h.stored, null);
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'cleanup',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('records dependency preparation denial without preparing dependencies or running checks', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'deny',
    });

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(result.check_run_status_projection.environment_reason, 'install_denied');
    assert.equal(h.stored.status, 'environment_unavailable');
    assert.equal(h.stored.environment_reason, 'install_denied');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'clock',
      'cleanup',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('prepares dependencies once and reruns readiness before starting the check runner', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      prepareReceipt() {
        fs.mkdirSync(path.join(checkWorkspacePath, 'node_modules'), { recursive: true });
        return dependencyPreparationReceipt(selected, 'prepared');
      },
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'passed');
    assert.equal(h.stored.status, 'passed');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'prepare',
      'clock',
      'readiness',
      'run',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('does not prepare dependencies when readiness already proves the check workspace is prepared', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    fs.mkdirSync(path.join(checkWorkspacePath, 'node_modules'), { recursive: true });
    const h = harness('passed', {
      selected,
      prepareReceipt() {
        throw new Error('prepare must not run when readiness is already satisfied');
      },
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'passed');
    assert.equal(h.stored.status, 'passed');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'run',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('records incomplete check evidence when dependency preparation fails', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      prepareStatus: 'failed',
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(result.check_run_status_projection.environment_reason, 'dependency_preparation_failed');
    assert.equal(
      result.check_run_status_projection.summary,
      'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.',
    );
    assert.equal(h.stored.status, 'environment_unavailable');
    assert.equal(h.stored.environment_reason, 'dependency_preparation_failed');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'prepare',
      'clock',
      'cleanup',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('records preparation failure when approval leaves the check workspace unready', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      prepareStatus: 'prepared',
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(result.check_run_status_projection.environment_reason, 'dependency_preparation_failed');
    assert.equal(h.stored.status, 'environment_unavailable');
    assert.equal(h.stored.environment_reason, 'dependency_preparation_failed');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'prepare',
      'clock',
      'readiness',
      'clock',
      'cleanup',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('records dependency preparation timeout separately from missing dependencies', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      prepareStatus: 'timed_out',
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'visible',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(result.check_run_status_projection.environment_reason, 'dependency_preparation_timed_out');
    assert.equal(h.stored.status, 'environment_unavailable');
    assert.equal(h.stored.environment_reason, 'dependency_preparation_timed_out');
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('records unavailable package manager when preparation cannot start from a missing probe', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      prepareError: true,
      probePackageManagerState: 'missing',
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'missing',
          toolchain_probe: input.toolchain_probe,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check({
      ...request(h.selected),
      dependency_preparation_decision: 'allow_once',
    });

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(result.check_run_status_projection.environment_reason, 'package_manager_unavailable');
    assert.equal(
      result.check_run_status_projection.summary,
      'Builder could not start the package manager needed to prepare check dependencies.',
    );
    assert.equal(h.stored.environment_reason, 'package_manager_unavailable');
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('does not block packaged runtime checks solely because the host package manager is unavailable', async () => {
  const selected = admittedCheck('npm', 'test', {}, {
    resolution_source: 'packaged_runtime',
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'missing',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check(request(h.selected));

    assert.equal(result.check_run_status_projection.status, 'passed');
    assert.equal(h.stored.status, 'passed');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'run',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('prefers dependency workspace readiness over host probe misses for packaged runtime', async () => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  }, {
    resolution_source: 'packaged_runtime',
  });
  const checkWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-main-readiness-'));
  try {
    const h = harness('passed', {
      selected,
      readinessSnapshot(input) {
        return createBuilderRuntimeReadinessSnapshot({
          project_id: selected.admission.project_id,
          candidate_id: selected.admission.candidate_id,
          package_manager: selected.admission.package_manager,
          check_run_admission: selected.admission,
          source_tree: selected.tree,
          project_root_path: null,
          check_workspace_path: checkWorkspacePath,
          host_toolchain_state: 'missing',
          toolchain_probe: null,
          install_permission: input.install_permission,
          updated_at_ms: input.updated_at_ms,
        });
      },
    });
    const result = await h.service.run_approved_check(request(h.selected));

    assert.equal(result.check_run_status_projection.status, 'incomplete');
    assert.equal(
      result.check_run_status_projection.environment_reason,
      'dependency_workspace_missing',
    );
    assert.equal(h.stored.status, 'environment_unavailable');
    assert.equal(h.stored.environment_reason, 'dependency_workspace_missing');
    assert.deepEqual(h.calls, [
      'resolve',
      'clock',
      'probe',
      'project-root',
      'materialize',
      'readiness',
      'clock',
      'cleanup',
      'record',
      'status',
      'notify',
    ]);
  } finally {
    fs.rmSync(checkWorkspacePath, { recursive: true, force: true });
  }
});

test('cleans a materialized workspace when the runner rejects before taking ownership', async () => {
  const h = harness('passed', { runnerError: true });
  await assert.rejects(h.service.run_approved_check(request(h.selected)), (error) => {
    assert.ok(error instanceof BuilderCheckRunMainServiceError);
    assert.equal(error.code, 'builder_check_run_main_service_failed');
    assert.equal(error.runtime_code, 'check_runner');
    assert.equal(error.runtime_cause_code, 'unknown');
    assert.doesNotMatch(JSON.stringify(error), /runtime path|workspace|candidate|secret/iu);
    return true;
  });
  assert.deepEqual(h.calls, [
    'resolve',
    'clock',
    'probe',
    'project-root',
    'materialize',
    'run',
    'cleanup',
  ]);
});

test('fails closed on storage failure, extra input, accessors, proxies, and malformed dependencies', async () => {
  const storage = harness('passed', { storeError: true });
  await assert.rejects(
    storage.service.run_approved_check(request(storage.selected)),
    BuilderCheckRunMainServiceError,
  );

  const h = harness();
  await assert.rejects(h.service.run_approved_check({
    ...request(h.selected),
    renderer_status: 'passed',
  }), BuilderCheckRunMainServiceError);
  await assert.rejects(
    h.service.run_approved_check(new Proxy(request(h.selected), {})),
    BuilderCheckRunMainServiceError,
  );
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'draft_id', {
    enumerable: true,
    get() { invoked = true; return h.selected.draft_id; },
  });
  await assert.rejects(h.service.run_approved_check(hostile), BuilderCheckRunMainServiceError);
  assert.equal(invoked, false);

  assert.throws(() => createBuilderCheckRunMainService({}), BuilderCheckRunMainServiceError);
});

test('source is main-only orchestration without Electron, IPC, provider, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-main-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|BrowserWindow|preload/iu);
  assert.doesNotMatch(source, /fetch\s*\(|https?:\/\/|provider|api[_-]?key|Authorization/iu);
  assert.doesNotMatch(source, /saveDraft|saveVersion|git\s+commit|DatabaseSync|node:sqlite/iu);
});
