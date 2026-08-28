'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
  DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
  DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
} = require('../electron/builder-check-run-approval-ipc-adapter.cjs');
const {
  createBuilderEnvironmentReadinessDiagnosis,
} = require('../electron/builder-environment-readiness-diagnosis.cjs');
const {
  createBuilderRuntimeReadinessSnapshot,
} = require('../electron/builder-runtime-readiness-snapshot.cjs');
const {
  createBuilderCheckRunApprovalIpcRuntime,
} = require('../electron/builder-check-run-approval-ipc-runtime.cjs');
const {
  createBuilderCheckSkipDecision,
} = require('../electron/builder-check-skip-decision.cjs');
const {
  admittedCheck,
} = require('./helpers/builder-check-run-fixture.cjs');
const {
  createBuilderProjectEnvironmentDiagnosisService,
} = require('../electron/builder-project-environment-diagnosis.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
const PROFILE_ID = `builder-command-profile:${'c'.repeat(32)}`;
const UUID = '123e4567-e89b-42d3-a456-426614174000';

function projection() {
  return {
    projection_version: 'builder-check-run-status-projection.v1',
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_run_id: `builder-check-run:${'d'.repeat(64)}`,
    command_kind: 'test',
    command_label: 'Tests',
    status: 'passed',
    label: 'Checked',
    summary: 'The project check completed successfully.',
    environment_reason: 'none',
    completed_at_ms: 20,
    result_digest: `sha256:${'e'.repeat(64)}`,
    authority: {
      projection_authority: 'main_owned_check_run_status_projection_v1',
      check_run_authority: 'verified_check_run_contract',
      renderer_authority: 'read_only_projection',
      ipc_authority: 'projection_only',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      provider_dispatch: false,
      command_execution: false,
      source_write: 'not_present',
      git_write: false,
      sqlite_write: false,
      save_authority: false,
    },
  };
}

function readResult() {
  return {
    result_version: 'builder-check-run-current-draft-read-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_available_checks_read',
    status: 'ready',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    available_checks: [{
      command_profile_id: PROFILE_ID,
      command_kind: 'test',
      command_display: 'npm test',
      requires_user_approval: true,
    }],
  };
}

function runResult() {
  return {
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_run_status_projection: projection(),
  };
}

function skipResult() {
  return {
    result_version: 'builder-check-skip-current-draft-result.v1',
    service_version: 'builder-check-skip-current-draft-service.v1',
    operation: 'check_skip_decision_recorded',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_skip_decision: createBuilderCheckSkipDecision({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      draft_id: DRAFT_ID,
      draft_checkpoint_id: `builder-draft-checkpoint:${'1'.repeat(64)}`,
      draft_checkpoint_sequence: 1,
      candidate_id: CANDIDATE_ID,
      candidate_digest: `sha256:${'2'.repeat(64)}`,
      resulting_tree_digest: `sha256:${'3'.repeat(64)}`,
      reason_code: 'user_chose_save_without_check',
      decided_at_ms: 20,
    }),
    authority: {
      user_action: 'explicit_skip_check_request_admitted_by_main',
      save_version: 'not_performed',
      check_execution: 'not_performed',
      renderer_candidate_identity: 'not_accepted',
    },
  };
}

function environmentDiagnosisResult(selected = admittedCheck()) {
  const snapshot = createBuilderRuntimeReadinessSnapshot({
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
    updated_at_ms: 30,
  });
  return {
    result_version: 'builder-check-run-current-draft-environment-diagnosis-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_check_environment_diagnosed',
    draft_id: selected.draft_id,
    project_id: selected.admission.project_id,
    candidate_id: selected.admission.candidate_id,
    environment_diagnosis: createBuilderEnvironmentReadinessDiagnosis({
      check_run_admission: selected.admission,
      runtime_readiness_snapshot: snapshot,
      diagnosed_at_ms: 31,
    }),
  };
}

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 42;
  child.kill = () => true;
  return child;
}

async function projectEnvironmentDiagnosisResult() {
  const spawns = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-project-env-ipc-runtime-'));
  const sourceTree = createBuilderProjectSourceTree({
    files: [
      { path: 'package.json', content: '{"dependencies":{"vite":"^5.0.0"}}\n' },
      { path: 'package-lock.json', content: '{}\n' },
    ],
  });
  const service = createBuilderProjectEnvironmentDiagnosisService({
    project_read_authority: {
      authority_version: 'builder-project-read-authority.v1',
      load_current() {
        return {
          result_version: 'builder-project-read-result.v1',
          operation: 'current_loaded',
          project_id: PROJECT_ID,
          title: 'Project',
          summary: 'Project summary',
          source_tree: sourceTree,
          base_revision: null,
          authority_evidence: {},
        };
      },
      load_revision() {},
      list_current() {},
      list_history() {},
    },
    project_workspace_path_service: {
      service_version: 'builder-project-workspace-path-service.v1',
      resolve_project_workspace_path() {
        return {
          result_version: 'builder-project-workspace-path-result.v1',
          project_id: PROJECT_ID,
          project_root_path: root,
          authority: 'main_owned_bound_project_workspace_path',
        };
      },
    },
    spawn_process() {
      const child = childProcess();
      spawns.push(child);
      return child;
    },
    terminate_process_tree(input) {
      return input.child.kill() === true;
    },
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms: () => 40,
      set_timeout(callback) { void callback; return 1; },
      clear_timeout() {},
    },
    platform: process.platform,
    windows_root: process.platform === 'win32'
      ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
      : null,
  });
  try {
    const pending = service.diagnose_project_environment({ project_id: PROJECT_ID });
    await new Promise((resolve) => setImmediate(resolve));
    for (const child of spawns) {
      child.stdout.emit('data', Buffer.from('1.2.3\n'));
      child.emit('close', 0, null);
    }
    return await pending;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({
  read = async () => readResult(),
  diagnose = async () => environmentDiagnosisResult(),
  projectDiagnose = async () => projectEnvironmentDiagnosisResult(),
  run = async () => runResult(),
  dependency = async () => runResult(),
  skip = async () => skipResult(),
  failOn = null,
} = {}) {
  const handlers = new Map();
  const removed = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const ipcMain = {
    handle(channel, invoke) {
      if (channel === failOn) throw new Error('private registration failure');
      handlers.set(channel, invoke);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  const service = {
    service_version: 'builder-check-run-current-draft-service.v1',
    read_available_checks: read,
    read_current_candidate_for_main_only() {},
    diagnose_check_environment: diagnose,
    run_approved_check: run,
    decide_dependency_preparation_and_run_check: dependency,
  };
  const projectDiagnosisService = {
    service_version: 'builder-project-environment-diagnosis-service.v1',
    diagnose_project_environment: projectDiagnose,
  };
  const runtime = createBuilderCheckRunApprovalIpcRuntime({
    ipcMain,
    mainWindowRef: () => ({ webContents, isDestroyed: () => false }),
    currentDraftCheckRunService: service,
    currentDraftCheckSkipService: {
      service_version: 'builder-check-skip-current-draft-service.v1',
      skip_current_draft_check: skip,
    },
    projectEnvironmentDiagnosisService: projectDiagnosisService,
  });
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    handlers,
    removed,
    runtime,
  };
}

test('registers exactly the read, diagnosis, explicit run, dependency preparation, and skip channels', async () => {
  const value = setup();
  assert.equal(value.runtime.runtime_version, 'builder-check-run-approval-ipc-runtime.v1');
  assert.deepEqual(value.runtime.channels, [
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
    DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
    DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
    DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
    SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
  ]);
  assert.equal(value.runtime.register(), true);
  assert.equal((await value.handlers.get(READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID },
  )).status, 'ready');
  assert.equal((await value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  )).check_run_status_projection.status, 'passed');
  const selected = admittedCheck();
  assert.equal((await value.handlers.get(DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL)(
    value.event,
    { draft_id: selected.draft_id, command_profile_id: selected.command_profile_id },
  )).environment_diagnosis.readiness_state, 'ready');
  assert.equal((await value.handlers.get(DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL)(
    value.event,
    { project_id: PROJECT_ID },
  )).environment_diagnosis.readiness_state, 'project_dependencies_missing');
  assert.equal((await value.handlers.get(DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once' },
  )).check_run_status_projection.status, 'passed');
  assert.deepEqual(await value.handlers.get(SKIP_CURRENT_DRAFT_CHECK_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID },
  ), {
    result_version: 'builder-check-skip-current-draft-public-result.v1',
    operation: 'current_draft_check_skipped',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    status: 'skipped',
  });
  assert.equal(value.runtime.dispose(), true);
  assert.deepEqual(value.removed, [
    SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
    DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
    DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
    DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  ]);
});

test('coalesces repeated reads and diagnoses while rejecting concurrent runs for the same draft', async () => {
  const readPending = deferred();
  const diagnosisPending = deferred();
  const projectDiagnosisPending = deferred();
  const runPending = deferred();
  let reads = 0;
  let diagnoses = 0;
  let projectDiagnoses = 0;
  let runs = 0;
  const value = setup({
    read() { reads += 1; return readPending.promise; },
    diagnose() { diagnoses += 1; return diagnosisPending.promise; },
    projectDiagnose() { projectDiagnoses += 1; return projectDiagnosisPending.promise; },
    run() { runs += 1; return runPending.promise; },
  });
  value.runtime.register();
  const firstRead = value.handlers.get(READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID },
  );
  const secondRead = value.handlers.get(READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  readPending.resolve(readResult());
  await Promise.all([firstRead, secondRead]);

  const selected = admittedCheck();
  const firstDiagnosis = value.handlers.get(DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL)(
    value.event,
    { draft_id: selected.draft_id, command_profile_id: selected.command_profile_id },
  );
  const secondDiagnosis = value.handlers.get(DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL)(
    value.event,
    { draft_id: selected.draft_id, command_profile_id: selected.command_profile_id },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(diagnoses, 1);
  diagnosisPending.resolve(environmentDiagnosisResult(selected));
  await Promise.all([firstDiagnosis, secondDiagnosis]);

  const firstProjectDiagnosis = value.handlers.get(DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL)(
    value.event,
    { project_id: PROJECT_ID },
  );
  const secondProjectDiagnosis = value.handlers.get(DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL)(
    value.event,
    { project_id: PROJECT_ID },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(projectDiagnoses, 1);
  projectDiagnosisPending.resolve(await projectEnvironmentDiagnosisResult());
  await Promise.all([firstProjectDiagnosis, secondProjectDiagnosis]);

  const firstRun = value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
    ),
    { code: 'builder_check_run_approval_busy' },
  );
  assert.equal(runs, 1);
  runPending.resolve(runResult());
  await firstRun;
  assert.equal(value.runtime.dispose(), true);
});

test('dependency preparation uses the same active run lock as explicit checks', async () => {
  const pending = deferred();
  let runs = 0;
  let dependencyRuns = 0;
  const value = setup({
    run() { runs += 1; return pending.promise; },
    dependency() { dependencyRuns += 1; return pending.promise; },
  });
  value.runtime.register();
  const firstRun = value.handlers.get(DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
    ),
    { code: 'builder_check_run_approval_busy' },
  );
  assert.equal(runs, 0);
  assert.equal(dependencyRuns, 1);
  pending.resolve(runResult());
  await firstRun;
  assert.equal(value.runtime.dispose(), true);
});

test('stops accepting requests and requires a drain before disposal completes', async () => {
  const pending = deferred();
  const value = setup({ run: () => pending.promise });
  value.runtime.register();
  const operation = value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => value.runtime.dispose(), {
    code: 'builder_check_run_approval_ipc_runtime_cleanup_required',
  });
  assert.equal(value.handlers.size, 0);
  pending.resolve(runResult());
  await operation;
  assert.equal(value.runtime.dispose(), true);
  assert.equal(value.runtime.dispose(), false);
});

test('shutdown removes handlers then awaits every accepted operation before disposal', async () => {
  const readPending = deferred();
  const runPending = deferred();
  const value = setup({
    read: () => readPending.promise,
    run: () => runPending.promise,
  });
  value.runtime.register();
  const readOperation = value.handlers.get(READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID },
  );
  const runOperation = value.handlers.get(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL)(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  );
  await new Promise((resolve) => setImmediate(resolve));
  let shutdownSettled = false;
  const shutdown = value.runtime.shutdown().then((result) => {
    shutdownSettled = true;
    return result;
  });
  assert.equal(value.handlers.size, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  readPending.resolve(readResult());
  await readOperation;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false);
  runPending.resolve(runResult());
  await runOperation;
  assert.equal(await shutdown, true);
  assert.equal(await value.runtime.shutdown(), false);
  assert.equal(value.runtime.dispose(), false);
});

test('rolls back partial registration and rejects malformed services', () => {
  const failed = setup({ failOn: APPROVE_CURRENT_DRAFT_CHECK_CHANNEL });
  assert.throws(() => failed.runtime.register(), {
    code: 'builder_check_run_approval_ipc_runtime_unavailable',
  });
  assert.equal(failed.handlers.size, 0);
  assert.deepEqual(failed.removed, [
    DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
    DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  ]);
  assert.throws(() => createBuilderCheckRunApprovalIpcRuntime({
    ipcMain: { handle() {}, removeHandler() {} },
    mainWindowRef: () => null,
    currentDraftCheckRunService: {
      service_version: 'builder-check-run-current-draft-service.v1',
      read_available_checks() {},
      read_current_candidate_for_main_only() {},
      diagnose_check_environment() {},
      run_approved_check() {},
      decide_dependency_preparation_and_run_check() {},
    },
    currentDraftCheckSkipService: {
      service_version: 'builder-check-skip-current-draft-service.v1',
      skip_current_draft_check() {},
    },
    projectEnvironmentDiagnosisService: {
      service_version: 'builder-project-environment-diagnosis-service.v1',
      diagnose_project_environment: true,
    },
  }), { code: 'builder_check_run_approval_ipc_runtime_unavailable' });
});

test('runtime source has no preload, renderer, provider, source, Git, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-approval-ipc-runtime.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /preload|ipcRenderer|contextBridge|provider|source_tree|writeFile|git_authority|save_draft/iu);
  assert.match(source, /activeReads/u);
  assert.match(source, /activeProjectDiagnoses/u);
  assert.match(source, /activeRuns/u);
});
