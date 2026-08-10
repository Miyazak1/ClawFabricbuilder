'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  createBuilderCheckRunApprovalIpcAdapter,
} = require('../electron/builder-check-run-approval-ipc-adapter.cjs');

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
const PROFILE_ID = `builder-command-profile:${'c'.repeat(32)}`;

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

function harness(overrides = {}) {
  const calls = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const adapter = createBuilderCheckRunApprovalIpcAdapter({
    async readCurrentDraftAvailableChecks(request) {
      calls.push(['read', request]);
      return overrides.readResult ?? readResult();
    },
    async approveAndRunCurrentDraftCheck(request) {
      calls.push(['run', request]);
      if (overrides.runError) throw overrides.runError;
      return overrides.runResult ?? runResult();
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
    value.adapter.channels.approveAndRunCurrentDraftCheck.channel,
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  );
  const available = await value.adapter.channels.readCurrentDraftAvailableChecks.invoke(
    value.event,
    { draft_id: DRAFT_ID },
  );
  const completed = await value.adapter.channels.approveAndRunCurrentDraftCheck.invoke(
    value.event,
    { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID },
  );
  assert.deepEqual(value.calls, [
    ['read', { draft_id: DRAFT_ID }],
    ['run', { draft_id: DRAFT_ID, command_profile_id: PROFILE_ID }],
  ]);
  assert.deepEqual(available.available_checks, [{
    command_profile_id: PROFILE_ID,
    command_kind: 'test',
    command_display: 'npm test',
    requires_user_approval: true,
  }]);
  assert.equal(completed.check_run_status_projection.status, 'passed');
  assert.equal(Object.isFrozen(available), true);
  assert.equal(Object.isFrozen(completed), true);
});

test('requires the active main frame and exact identity-only payloads', async () => {
  const value = harness();
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

test('maps only a fixed busy signal and redacts every other service failure', async () => {
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
