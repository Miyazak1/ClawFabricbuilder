'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION,
  BuilderRuntimeReadinessSnapshotError,
  createBuilderRuntimeReadinessSnapshot,
  sanitizeBuilderRuntimeReadinessSnapshot,
} = require('../electron/builder-runtime-readiness-snapshot.cjs');
const {
  createBuilderRuntimeToolchainProbe,
} = require('../electron/builder-runtime-toolchain-probe.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  admittedCheck,
  PROJECT_ID,
} = require('./helpers/builder-check-run-fixture.cjs');

const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-runtime-readiness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function nodeInput(selected, overrides = {}) {
  return {
    project_id: selected.admission.project_id,
    candidate_id: selected.admission.candidate_id,
    package_manager: selected.admission.package_manager,
    check_run_admission: selected.admission,
    source_tree: selected.tree,
    project_root_path: null,
    check_workspace_path: null,
    host_toolchain_state: 'not_checked',
    toolchain_probe: null,
    install_permission: 'not_requested',
    updated_at_ms: 120,
    ...overrides,
  };
}

function staticInput(overrides = {}) {
  const tree = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<!doctype html><main>Hello</main>\n' }],
  });
  return {
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    package_manager: 'none',
    check_run_admission: null,
    source_tree: tree,
    project_root_path: null,
    check_workspace_path: null,
    host_toolchain_state: 'not_checked',
    toolchain_probe: null,
    install_permission: 'not_requested',
    updated_at_ms: 120,
    ...overrides,
  };
}

function assertReadinessError(error, forbidden = []) {
  assert.equal(error instanceof BuilderRuntimeReadinessSnapshotError, true);
  assert.equal(error.code, 'builder_runtime_readiness_snapshot_invalid');
  assert.equal(error.message, 'Builder runtime readiness could not be verified.');
  const serialized = JSON.stringify({
    code: error.code,
    message: error.message,
    stack: error.stack,
  });
  for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
  assert.doesNotMatch(serialized, /node_modules|runtime-readiness|secret|token|api[_-]?key/iu);
  return true;
}

function nextTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('reports source-only projects as not needing execution dependencies', () => {
  const snapshot = createBuilderRuntimeReadinessSnapshot(staticInput());

  assert.equal(snapshot.snapshot_version, BUILDER_RUNTIME_READINESS_SNAPSHOT_VERSION);
  assert.equal(snapshot.package_manager, 'none');
  assert.equal(snapshot.package_manifest, 'absent');
  assert.equal(snapshot.dependency_manifest, 'absent');
  assert.equal(snapshot.project_dependency_state, 'not_applicable');
  assert.equal(snapshot.check_workspace_dependency_state, 'not_applicable');
  assert.equal(snapshot.dependency_strategy, 'no_execution_needed');
  assert.equal(snapshot.authority.renderer_authority, 'not_present');
  assert.equal(snapshot.authority.provider_dispatch, false);
  assert.equal(snapshot.authority.harness_dispatch, false);
  assert.equal(snapshot.authority.install_authority, 'not_granted');
  assert.equal(Object.hasOwn(snapshot, 'project_root_path'), false);
  assert.equal(Object.hasOwn(snapshot, 'check_workspace_path'), false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('distinguishes unadmitted project root from unmaterialized check workspace', () => {
  const selected = admittedCheck('npm', 'test');
  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected));

  assert.equal(snapshot.package_manifest, 'present');
  assert.equal(snapshot.dependency_manifest, 'absent');
  assert.equal(snapshot.lockfile, 'none');
  assert.equal(snapshot.project_dependency_state, 'not_admitted');
  assert.equal(snapshot.check_workspace_dependency_state, 'not_materialized');
  assert.equal(snapshot.dependency_strategy, 'can_run_without_install');
});

test('keeps project-local dependencies separate from candidate workspace readiness', (t) => {
  const selected = admittedCheck('npm', 'test', {
    devDependencies: { vite: '^5.0.0' },
  });
  const projectRoot = tempRoot(t);
  const checkWorkspace = path.join(projectRoot, 'checks');
  fs.mkdirSync(path.join(projectRoot, 'node_modules'));
  fs.mkdirSync(checkWorkspace);

  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
    project_root_path: projectRoot,
    check_workspace_path: checkWorkspace,
    host_toolchain_state: 'visible',
  }));

  assert.equal(snapshot.project_dependency_state, 'install_present');
  assert.equal(snapshot.check_workspace_dependency_state, 'install_missing');
  assert.equal(snapshot.dependency_strategy, 'needs_prepared_dependency_workspace');
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(projectRoot.replace(/\\/gu, '\\\\'), 'u'));
});

test('reports a prepared check workspace without granting install authority', (t) => {
  const selected = admittedCheck('pnpm', 'test');
  const checkWorkspace = tempRoot(t);
  fs.mkdirSync(path.join(checkWorkspace, 'node_modules'));

  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
    check_workspace_path: checkWorkspace,
    host_toolchain_state: 'visible',
  }));

  assert.equal(snapshot.package_manager, 'pnpm');
  assert.equal(snapshot.lockfile, 'pnpm-lock.yaml');
  assert.equal(snapshot.check_workspace_dependency_state, 'install_present');
  assert.equal(snapshot.dependency_strategy, 'can_run_without_install');
  assert.equal(snapshot.authority.install_authority, 'not_granted');
  assert.equal(snapshot.authority.network_access, false);
});

test('uses a redacted toolchain probe to populate host versions', async () => {
  const selected = admittedCheck('npm', 'test');
  const childProcesses = [];
  const probeService = createBuilderRuntimeToolchainProbe({
    spawn_process(file) {
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      childProcesses.push({ file, child });
      return child;
    },
    terminate_process_tree() { return true; },
    clock: {
      now_ms: () => 100,
      set_timeout() { return 1; },
      clear_timeout() {},
    },
  });
  const pendingProbe = probeService.probe_package_manager({ package_manager: 'npm' });
  childProcesses[0].child.stdout.emit('data', Buffer.from('v22.22.3\n'));
  childProcesses[0].child.emit('close', 0, null);
  await nextTurn();
  childProcesses[1].child.stdout.emit('data', Buffer.from('10.9.3\n'));
  childProcesses[1].child.emit('close', 0, null);
  const toolchain_probe = await pendingProbe;
  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
    host_toolchain_state: 'not_checked',
    toolchain_probe,
  }));

  assert.equal(snapshot.host_toolchain_state, 'visible');
  assert.equal(snapshot.host_node_version, 'v22.22.3');
  assert.equal(snapshot.host_package_manager_version, '10.9.3');
  assert.equal(snapshot.install_permission, 'not_requested');
  assert.equal(snapshot.authority.install_authority, 'not_granted');
});

test('reports host toolchain admission separately from dependency installation', () => {
  const selected = admittedCheck('npm', 'test');
  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
    host_toolchain_state: 'not_admitted',
  }));

  assert.equal(snapshot.host_toolchain_state, 'not_admitted');
  assert.equal(snapshot.dependency_strategy, 'needs_host_toolchain_admission');
});

test('round-trips the digest-bound readiness snapshot and rejects drift', () => {
  const selected = admittedCheck('npm', 'test');
  const snapshot = createBuilderRuntimeReadinessSnapshot(nodeInput(selected));

  assert.deepEqual(sanitizeBuilderRuntimeReadinessSnapshot(snapshot), snapshot);
  assert.throws(
    () => sanitizeBuilderRuntimeReadinessSnapshot({
      ...snapshot,
      host_package_manager_version: '10.9.3',
    }),
    assertReadinessError,
  );
});

test('rejects mismatched admissions and hostile objects without leaking values', () => {
  const selected = admittedCheck('npm', 'test');
  const foreign = admittedCheck('yarn', 'test');

  assert.throws(
    () => createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
      check_run_admission: foreign.admission,
    })),
    assertReadinessError,
  );
  assert.throws(
    () => createBuilderRuntimeReadinessSnapshot(new Proxy(nodeInput(selected), {})),
    assertReadinessError,
  );
  assert.throws(
    () => createBuilderRuntimeReadinessSnapshot(nodeInput(selected, {
      project_root_path: 'relative\\secret',
    })),
    (error) => assertReadinessError(error, ['secret']),
  );
});
