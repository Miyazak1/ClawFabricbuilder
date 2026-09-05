'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectDependencyPreparer,
  sanitizeBuilderProjectDependencyPreparationResult,
} = require('../electron/builder-project-dependency-preparer.cjs');
const {
  createBuilderProjectEnvironmentDiagnosisService,
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

function isInstallSpawn(spawn) {
  return spawn.args.includes('ci') || spawn.args.includes('install');
}

function createHarness({ nodeModules = false } = {}) {
  const spawns = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-project-deps-'));
  if (nodeModules) fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  const sourceTree = createBuilderProjectSourceTree({
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify({ dependencies: { next: '^15.0.0' } })}\n`,
      },
      { path: 'package-lock.json', content: '{}\n' },
    ],
  });
  const workspacePathService = {
    service_version: 'builder-project-workspace-path-service.v1',
    resolve_project_workspace_path() {
      return {
        result_version: 'builder-project-workspace-path-result.v1',
        project_id: PROJECT_ID,
        project_root_path: root,
        authority: 'main_owned_bound_project_workspace_path',
      };
    },
  };
  const clock = {
    clock_version: 'builder-clock.v1',
    now_ms: () => 100,
    set_timeout(callback) { void callback; return 1; },
    clear_timeout() {},
  };
  const diagnosisService = createBuilderProjectEnvironmentDiagnosisService({
    project_read_authority: {
      authority_version: 'builder-project-read-authority.v1',
      load_current() {
        return {
          result_version: 'builder-project-read-result.v1',
          product_revision_receipt: {
            project_id: PROJECT_ID,
            resulting_tree_digest: sourceTree.source_tree_digest,
          },
          current: {},
          source_tree: sourceTree,
          git_candidate_receipt: {},
          git_verification_receipt: {},
          authority_evidence: {},
          operation: 'current_loaded',
        };
      },
      load_revision() {},
      list_current() {},
      list_history() {},
    },
    project_workspace_path_service: workspacePathService,
    spawn_process(file, args, options) {
      const child = childProcess();
      spawns.push({ file, args, options, child, diagnosis: true });
      return child;
    },
    terminate_process_tree(input) {
      return input.child.kill() === true;
    },
    clock,
    platform: process.platform,
    windows_root: process.platform === 'win32'
      ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
      : null,
  });
  const preparer = createBuilderProjectDependencyPreparer({
    project_environment_diagnosis_service: diagnosisService,
    project_workspace_path_service: workspacePathService,
    spawn_process(file, args, options) {
      const child = childProcess();
      spawns.push({ file, args, options, child, install: true });
      return child;
    },
    terminate_process_tree(input) {
      return input.child.kill() === true;
    },
    clock,
    platform: process.platform,
    windows_root: process.platform === 'win32'
      ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
      : null,
  });
  return { preparer, root, spawns };
}

async function flushSpawns(harness) {
  let processed = 0;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    while (processed < harness.spawns.length) {
      const spawn = harness.spawns[processed];
      processed += 1;
      if (spawn.install === true && isInstallSpawn(spawn)) {
        fs.mkdirSync(path.join(harness.root, 'node_modules'), { recursive: true });
      }
      spawn.child.stdout.emit('data', Buffer.from('1.2.3\n'));
      spawn.child.emit('close', 0, null);
    }
  }
}

test('does not install when project root dependencies are already present', async () => {
  const harness = createHarness({ nodeModules: true });
  try {
    const pending = harness.preparer.prepare_project_dependencies({ project_id: PROJECT_ID });
    await flushSpawns(harness);
    const result = sanitizeBuilderProjectDependencyPreparationResult(await pending);
    assert.equal(result.preparation_receipt.status, 'already_prepared');
    assert.equal(result.environment_diagnosis.readiness_state, 'ready');
    assert.equal(harness.spawns.some((spawn) => spawn.install === true), false);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
});

test('installs once in the project root and returns a fresh ready diagnosis', async () => {
  const harness = createHarness();
  try {
    const pending = harness.preparer.prepare_project_dependencies({ project_id: PROJECT_ID });
    await flushSpawns(harness);
    const result = sanitizeBuilderProjectDependencyPreparationResult(await pending);
    const installSpawn = harness.spawns.find((spawn) => spawn.install === true);
    assert.ok(installSpawn);
    assert.equal(installSpawn.options.cwd, harness.root);
    assert.equal(installSpawn.options.shell, false);
    assert.equal(result.preparation_receipt.status, 'prepared');
    assert.equal(result.preparation_receipt.install_command, 'npm ci');
    assert.equal(result.preparation_receipt.authority.project_workspace_write, true);
    assert.equal(result.preparation_receipt.authority.check_workspace_write, false);
    assert.equal(result.preparation_receipt.authority.harness_dispatch, false);
    assert.equal(result.environment_diagnosis.project_dependency_state, 'install_present');
    assert.equal(result.environment_diagnosis.readiness_state, 'ready');
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
});
