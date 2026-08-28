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
  createBuilderCheckRunApprovalIpcAdapter,
} = require('../electron/builder-check-run-approval-ipc-adapter.cjs');
const {
  createBuilderEnvironmentReadinessDiagnosis,
} = require('../electron/builder-environment-readiness-diagnosis.cjs');
const {
  createBuilderRuntimeReadinessSnapshot,
} = require('../electron/builder-runtime-readiness-snapshot.cjs');
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

function projection(overrides = {}) {
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
    ...overrides,
  };
}

function readResult(overrides = {}) {
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
    ...overrides,
  };
}

function runResult(overrides = {}) {
  return {
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_run_status_projection: projection(),
    ...overrides,
  };
}

function skipResult(overrides = {}) {
  const decision = createBuilderCheckSkipDecision({
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
  });
  return {
    result_version: 'builder-check-skip-current-draft-result.v1',
    service_version: 'builder-check-skip-current-draft-service.v1',
    operation: 'check_skip_decision_recorded',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_skip_decision: decision,
    authority: {
      user_action: 'explicit_skip_check_request_admitted_by_main',
      save_version: 'not_performed',
      check_execution: 'not_performed',
      renderer_candidate_identity: 'not_accepted',
    },
    ...overrides,
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-project-env-ipc-adapter-'));
  const sourceTree = createBuilderProjectSourceTree({
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify({ dependencies: { vite: '^5.0.0' } })}\n`,
      },
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
    spawn_process(file, args, options) {
      const child = childProcess();
      spawns.push({ file, args, options, child });
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
    for (const spawn of spawns) {
      spawn.child.stdout.emit('data', Buffer.from('1.2.3\n'));
      spawn.child.emit('close', 0, null);
    }
    return await pending;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function harness(overrides = {}) {
  const calls = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const adapter = createBuilderCheckRunApprovalIpcAdapter({
    async readCurrentDraftAvailableChecks(request) {
      calls.push(['read', request]);
      return overrides.readResult ?? readResult();
    },
    async diagnoseCurrentDraftCheckEnvironment(request) {
      calls.push(['diagnose', request]);
      if (overrides.runError) throw overrides.runError;
      return overrides.diagnosisResult ?? environmentDiagnosisResult();
    },
    async diagnoseProjectEnvironment(request) {
      calls.push(['project-diagnose', request]);
      if (overrides.runError) throw overrides.runError;
      return overrides.projectDiagnosisResult ?? projectEnvironmentDiagnosisResult();
    },
    async approveAndRunCurrentDraftCheck(request) {
      calls.push(['run', request]);
      if (overrides.runError) throw overrides.runError;
      return overrides.runResult ?? runResult();
    },
    async decideCurrentDraftDependencyPreparation(request) {
      calls.push(['dependency', request]);
      if (overrides.runError) throw overrides.runError;
      return overrides.runResult ?? runResult();
    },
    async skipCurrentDraftCheck(request) {
      calls.push(['skip', request]);
      return overrides.skipResult ?? skipResult();
    },
    mainWindowRef: () => ({ webContents, isDestroyed: () => false }),
  });
  return { adapter, calls, event: { sender: webContents, senderFrame: mainFrame }, webContents };
}

test('projects only fixed available checks and approved CheckRun status', async () => {
  const value = harness();
  assert.equal(
    value.adapter.channels.readCurrentDraftAvailableChecks.channel,
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  );
  assert.equal(
    value.adapter.channels.skipCurrentDraftCheck.channel,
    SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
  );
  assert.equal(
    value.adapter.channels.diagnoseCurrentDraftCheckEnvironment.channel,
    DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
  );
  assert.equal(
    value.adapter.channels.diagnoseProjectEnvironment.channel,
    DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
  );
  assert.equal(
    value.adapter.channels.approveAndRunCurrentDraftCheck.channel,
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  );
  assert.equal(
    value.adapter.channels.decideCurrentDraftDependencyPreparation.channel,
    DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
  );
  const available = await value.adapter.channels.readCurrentDraftAvailableChecks.invoke(
    value.event,
    { draft_id: DRAFT_ID },
  );
  const completed = await value.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  );
  const prepared = await value.adapter.channels.decideCurrentDraftDependencyPreparation.invoke(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once' },
  );
  const skipped = await value.adapter.channels.skipCurrentDraftCheck.invoke(
    value.event,
    { draft_id: DRAFT_ID },
  );
  assert.deepEqual(value.calls, [
    ['read', { draft_id: DRAFT_ID }],
    ['run', { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID }],
    ['dependency', { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once' }],
    ['skip', { draft_id: DRAFT_ID }],
  ]);
  assert.deepEqual(available.available_checks, [{
    command_profile_id: PROFILE_ID,
    command_kind: 'test',
    command_display: 'npm test',
    requires_user_approval: true,
  }]);
  assert.equal(completed.check_run_status_projection.status, 'passed');
  assert.equal(prepared.check_run_status_projection.status, 'passed');
  assert.equal(skipped.status, 'skipped');
  assert.deepEqual(Object.keys(skipped), [
    'result_version', 'operation', 'draft_id', 'project_id', 'candidate_id', 'status',
  ]);
  assert.equal(Object.isFrozen(available), true);
  assert.equal(Object.isFrozen(completed), true);
  assert.equal(Object.isFrozen(skipped), true);
});

test('projects only redacted read-only environment diagnosis', async () => {
  const selected = admittedCheck('npm', 'test');
  const value = harness({ diagnosisResult: environmentDiagnosisResult(selected) });
  const diagnosed = await value.adapter.channels.diagnoseCurrentDraftCheckEnvironment.invoke(
    value.event,
    { draft_id: selected.draft_id, command_profile_id: selected.command_profile_id },
  );

  assert.deepEqual(value.calls, [
    ['diagnose', {
      draft_id: selected.draft_id,
      command_profile_id: selected.command_profile_id,
    }],
  ]);
  assert.equal(diagnosed.operation, 'current_draft_check_environment_diagnosed');
  assert.equal(diagnosed.environment_diagnosis.readiness_state, 'ready');
  assert.equal(diagnosed.environment_diagnosis.primary_action, 'run_check');
  assert.equal(diagnosed.environment_diagnosis.authority.command_execution, false);
  assert.equal(diagnosed.environment_diagnosis.authority.dependency_preparation, false);
  assert.equal(
    diagnosed.environment_diagnosis.authority.browser_preview_authority,
    'readiness_context_only_no_install_decision',
  );
});

test('projects only redacted project-level environment diagnosis', async () => {
  const value = harness();
  const diagnosed = await value.adapter.channels.diagnoseProjectEnvironment.invoke(
    value.event,
    { project_id: PROJECT_ID },
  );

  assert.deepEqual(value.calls, [
    ['project-diagnose', { project_id: PROJECT_ID }],
  ]);
  assert.equal(diagnosed.operation, 'project_environment_diagnosed');
  assert.equal(diagnosed.environment_diagnosis.readiness_state, 'project_dependencies_missing');
  assert.equal(diagnosed.environment_diagnosis.primary_action, 'show_project_dependency_setup');
  assert.equal(diagnosed.environment_diagnosis.authority.command_execution, false);
  assert.equal(diagnosed.environment_diagnosis.authority.dependency_preparation, false);
  assert.equal(
    diagnosed.environment_diagnosis.authority.browser_preview_authority,
    'readiness_context_only_no_install_decision',
  );
  assert.doesNotMatch(JSON.stringify(diagnosed), /"source_tree"|stdout|stderr|"PATH"|cfb-project-env-ipc-adapter/iu);
});

test('requires the active main frame and exact identity-only payloads', async () => {
  const value = harness();
  await assert.rejects(
    value.adapter.channels.diagnoseCurrentDraftCheckEnvironment.invoke(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, source_tree: {} },
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  await assert.rejects(
    value.adapter.channels.diagnoseProjectEnvironment.invoke(
      value.event,
      { project_id: PROJECT_ID, source_tree: {} },
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  await assert.rejects(
    value.adapter.channels.readCurrentDraftAvailableChecks.invoke(
      { sender: value.webContents, senderFrame: {} },
      { draft_id: DRAFT_ID },
    ),
    { code: 'builder_check_run_approval_forbidden' },
  );
  await assert.rejects(
    value.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, source_tree: {} },
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  await assert.rejects(
    value.adapter.channels.decideCurrentDraftDependencyPreparation.invoke(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once', cwd: 'C:\\private' },
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  await assert.rejects(
    value.adapter.channels.decideCurrentDraftDependencyPreparation.invoke(
      value.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'always' },
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  await assert.rejects(
    value.adapter.channels.readCurrentDraftAvailableChecks.invoke(
      value.event,
      new Proxy({ draft_id: DRAFT_ID }, {}),
    ),
    { code: 'builder_check_run_approval_invalid' },
  );
  assert.deepEqual(value.calls, []);
});

test('rejects script details, unsafe command labels, duplicate profiles, and mismatched status', async () => {
  const leaked = readResult();
  leaked.available_checks[0] = { ...leaked.available_checks[0], script_body: 'secret command' };
  const leakedHarness = harness({ readResult: leaked });
  await assert.rejects(
    leakedHarness.adapter.channels.readCurrentDraftAvailableChecks.invoke(
      leakedHarness.event,
      { draft_id: DRAFT_ID },
    ),
    { code: 'builder_check_run_approval_unavailable' },
  );
  const unsafe = harness({
    readResult: readResult({
      available_checks: [{
        command_profile_id: PROFILE_ID,
        command_kind: 'test',
        command_display: 'npm test -- --runInBand && upload',
        requires_user_approval: true,
      }],
    }),
  });
  await assert.rejects(
    unsafe.adapter.channels.readCurrentDraftAvailableChecks.invoke(
      unsafe.event,
      { draft_id: DRAFT_ID },
    ),
    { code: 'builder_check_run_approval_unavailable' },
  );
  const mismatch = harness({
    runResult: runResult({ check_run_status_projection: projection({ candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}` }) }),
  });
  await assert.rejects(
    mismatch.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
      mismatch.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
    ),
    { code: 'builder_check_run_approval_unavailable' },
  );
});

test('maps only fixed safe decision signals and redacts every other service failure', async () => {
  const busy = new Error('private busy detail');
  busy.code = 'builder_check_run_approval_busy';
  const busyHarness = harness({ runError: busy });
  await assert.rejects(
    busyHarness.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
      busyHarness.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
    ),
    (error) => error.code === 'builder_check_run_approval_busy'
      && error.message === 'A project check is already in progress.',
  );
  const stale = new Error('private stale draft detail');
  stale.code = 'builder_check_run_current_draft_failed';
  const staleHarness = harness({ runError: stale });
  await assert.rejects(
    staleHarness.adapter.channels.decideCurrentDraftDependencyPreparation.invoke(
      staleHarness.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID, decision: 'allow_once' },
    ),
    (error) => error.code === 'builder_check_run_current_draft_failed'
      && error.message === 'The draft changed before the project check could start.'
      && !error.message.includes('private'),
  );
  const privateFailure = new Error('C:\\private\\check path');
  privateFailure.code = 'sqlite_private_failure';
  const failed = harness({ runError: privateFailure });
  await assert.rejects(
    failed.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
      failed.event,
      { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
    ),
    (error) => error.code === 'builder_check_run_approval_unavailable'
      && !error.message.includes('private'),
  );
});

test('source boundary has no Electron registration, preload, source, provider, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-approval-ipc-adapter.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /require\(['"]electron['"]\)|ipcMain\.|ipcRenderer|contextBridge|read_verified_candidate|spawn\(|save_draft/iu);
  assert.match(source, /activeWebContents/u);
  assert.match(source, /senderFrame/u);
});
