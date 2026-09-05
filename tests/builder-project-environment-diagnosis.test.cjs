'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderProjectEnvironmentDiagnosisError,
  createBuilderProjectEnvironmentDiagnosisService,
  sanitizeBuilderProjectEnvironmentDiagnosisResult,
} = require('../electron/builder-project-environment-diagnosis.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 42;
  child.kill = () => true;
  return child;
}

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-project-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function sourceTree(packageJson = {
  scripts: { test: 'vitest run' },
  dependencies: { '@vitejs/plugin-react': '^5.0.0' },
}) {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'package.json', content: `${JSON.stringify(packageJson, null, 2)}\n` },
      { path: 'package-lock.json', content: '{}\n' },
      { path: 'index.html', content: '<main></main>\n' },
    ],
  });
}

function readResult(tree) {
  return {
    result_version: 'builder-project-read-result.v1',
    product_revision_receipt: {
      project_id: PROJECT_ID,
      resulting_tree_digest: tree.source_tree_digest,
    },
    current: {},
    source_tree: tree,
    git_candidate_receipt: {},
    git_verification_receipt: {},
    authority_evidence: {},
    operation: 'current_loaded',
  };
}

function harness(t, overrides = {}) {
  const root = overrides.root ?? tempRoot(t);
  const tree = overrides.sourceTree ?? sourceTree();
  const spawns = [];
  let now = 100;
  let timerId = 1;
  const timers = new Map();
  const service = createBuilderProjectEnvironmentDiagnosisService({
    project_read_authority: {
      authority_version: 'builder-project-read-authority.v1',
      load_current(request) {
        assert.deepEqual(request, { project_id: PROJECT_ID });
        return readResult(tree);
      },
      load_revision() {},
      list_current() {},
      list_history() {},
    },
    project_workspace_path_service: {
      service_version: 'builder-project-workspace-path-service.v1',
      resolve_project_workspace_path(request) {
        assert.deepEqual(request, { project_id: PROJECT_ID });
        return {
          result_version: 'builder-project-workspace-path-result.v1',
          project_id: PROJECT_ID,
          project_root_path: root,
          authority: 'main_owned_bound_project_workspace_path',
        };
      },
    },
    spawn_process(file, args, options) {
      if (overrides.missingToolchain === true) {
        const error = new Error('secret PATH');
        error.code = 'ENOENT';
        throw error;
      }
      const child = childProcess();
      spawns.push({ file, args, options, child });
      return child;
    },
    terminate_process_tree(input) {
      return input.child.kill() === true;
    },
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms: () => now,
      set_timeout(callback, delay) {
        const id = timerId;
        timerId += 1;
        timers.set(id, { callback, delay });
        return id;
      },
      clear_timeout(id) {
        timers.delete(id);
      },
    },
    platform: process.platform,
    windows_root: process.platform === 'win32'
      ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
      : null,
  });
  return {
    root,
    service,
    spawns,
    setNow(value) { now = value; },
    settleProbes() {
      for (const spawn of spawns) {
        spawn.child.stdout.emit('data', Buffer.from('1.2.3\n'));
        spawn.child.emit('close', 0, null);
      }
    },
  };
}

async function diagnose(h) {
  const pending = h.service.diagnose_project_environment({ project_id: PROJECT_ID });
  await new Promise((resolve) => setImmediate(resolve));
  h.settleProbes();
  return await pending;
}

function assertProjectDiagnosisError(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof BuilderProjectEnvironmentDiagnosisError, true);
    assert.equal(error.code, 'builder_project_environment_diagnosis_invalid');
    assert.doesNotMatch(JSON.stringify(error), /node_modules|secret|"PATH"|Users/iu);
    return true;
  });
}

test('diagnoses an installed project environment without install or command authority', async (t) => {
  const h = harness(t);
  fs.mkdirSync(path.join(h.root, 'node_modules'));

  const result = await diagnose(h);

  assert.equal(result.operation, 'project_environment_diagnosed');
  assert.equal(result.environment_diagnosis.readiness_state, 'ready');
  assert.equal(result.environment_diagnosis.primary_action, 'none');
  assert.equal(result.environment_diagnosis.project_dependency_state, 'install_present');
  assert.equal(result.environment_diagnosis.toolchains.node.state, 'visible');
  assert.equal(result.environment_diagnosis.toolchains.git.state, 'visible');
  assert.equal(result.environment_diagnosis.authority.command_execution, false);
  assert.equal(result.environment_diagnosis.authority.dependency_preparation, false);
  assert.equal(result.environment_diagnosis.authority.project_workspace_write, false);
  assert.equal(result.environment_diagnosis.authority.browser_preview_authority, 'readiness_context_only_no_install_decision');
  assert.equal(h.spawns.length, 5);
  assert.doesNotMatch(JSON.stringify(result), /node_modules|cfb-project-env|stdout|stderr|"PATH"/iu);
  assert.deepEqual(sanitizeBuilderProjectEnvironmentDiagnosisResult(result), result);
});

test('reports missing project dependencies before suggesting any installation authority', async (t) => {
  const h = harness(t);
  const result = await diagnose(h);

  assert.equal(result.environment_diagnosis.readiness_state, 'project_dependencies_missing');
  assert.equal(result.environment_diagnosis.primary_action, 'show_project_dependency_setup');
  assert.equal(result.environment_diagnosis.project_dependency_state, 'install_missing');
  assert.equal(result.environment_diagnosis.authority.dependency_preparation, false);
});

test('diagnoses saved harness projects with local file dependencies as missing root install', async (t) => {
  const tree = createBuilderProjectSourceTree({
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify({
          name: 'clawfabric-packaged-harness-canary',
          private: true,
          scripts: {
            test: 'clawfabric-local-check-tool --version',
          },
          devDependencies: {
            'clawfabric-local-check-tool': 'file:./tools/clawfabric-local-check-tool',
          },
        }, null, 2)}\n`,
      },
      {
        path: 'tools/clawfabric-local-check-tool/package.json',
        content: `${JSON.stringify({
          name: 'clawfabric-local-check-tool',
          version: '1.0.0',
          bin: {
            'clawfabric-local-check-tool': 'bin/check-tool.js',
          },
        }, null, 2)}\n`,
      },
      {
        path: 'tools/clawfabric-local-check-tool/bin/check-tool.js',
        content: [
          '#!/usr/bin/env node',
          "'use strict';",
          "console.log('clawfabric-local-check-tool 1.0.0');",
          '',
        ].join('\n'),
      },
      { path: 'check.js', content: "const canary = 'ready';\nvoid canary;\n" },
      { path: 'index.html', content: '<main></main>\n' },
    ],
  });
  const h = harness(t, { sourceTree: tree });

  const result = await diagnose(h);

  assert.equal(result.environment_diagnosis.readiness_state, 'project_dependencies_missing');
  assert.equal(result.environment_diagnosis.primary_action, 'show_project_dependency_setup');
  assert.equal(result.environment_diagnosis.package_manager, 'npm');
  assert.equal(result.environment_diagnosis.package_manifest, 'present');
  assert.equal(result.environment_diagnosis.dependency_manifest, 'present');
  assert.equal(result.environment_diagnosis.project_dependency_state, 'install_missing');
  assert.deepEqual(sanitizeBuilderProjectEnvironmentDiagnosisResult(result), result);
});

test('keeps missing host toolchains distinct from missing project dependencies', async (t) => {
  const h = harness(t, { missingToolchain: true });
  const result = await h.service.diagnose_project_environment({ project_id: PROJECT_ID });

  assert.equal(result.environment_diagnosis.readiness_state, 'host_toolchain_missing');
  assert.equal(result.environment_diagnosis.primary_action, 'show_missing_toolchain');
  assert.equal(result.environment_diagnosis.project_dependency_state, 'install_missing');
  assert.equal(result.environment_diagnosis.toolchains.node.state, 'missing');
  assert.notEqual(result.environment_diagnosis.primary_action, 'show_project_dependency_setup');
});

test('fails closed on authority drift, source leakage, and unsupported request shapes', async (t) => {
  const h = harness(t);
  const result = await diagnose(h);

  assertProjectDiagnosisError(() => sanitizeBuilderProjectEnvironmentDiagnosisResult({
    ...result,
    environment_diagnosis: {
      ...result.environment_diagnosis,
      authority: {
        ...result.environment_diagnosis.authority,
        dependency_preparation: true,
      },
    },
  }));
  await assert.rejects(
    h.service.diagnose_project_environment({ project_id: PROJECT_ID, source_tree: {} }),
    BuilderProjectEnvironmentDiagnosisError,
  );
});
