'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
} = require('../electron/builder-check-run-approval-ipc-adapter.cjs');
const {
  createBuilderCheckRunApprovalIpcRuntime,
} = require('../electron/builder-check-run-approval-ipc-runtime.cjs');

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
const PROFILE_ID = `builder-command-profile:${'c'.repeat(32)}`;

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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({ read = async () => readResult(), run = async () => runResult(), failOn = null } = {}) {
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
    run_approved_check: run,
  };
  const runtime = createBuilderCheckRunApprovalIpcRuntime({
    ipcMain,
    mainWindowRef: () => ({ webContents, isDestroyed: () => false }),
    currentDraftCheckRunService: service,
  });
  return {
    event: { sender: webContents, senderFrame: mainFrame },
    handlers,
    removed,
    runtime,
  };
}

test('registers exactly the read and explicit approve-and-run channels', async () => {
  const value = setup();
  assert.equal(value.runtime.runtime_version, 'builder-check-run-approval-ipc-runtime.v1');
  assert.deepEqual(value.runtime.channels, [
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
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
  assert.equal(value.runtime.dispose(), true);
  assert.deepEqual(value.removed, [
    APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
    READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  ]);
});

test('coalesces repeated reads and rejects concurrent runs for the same draft', async () => {
  const readPending = deferred();
  const runPending = deferred();
  let reads = 0;
  let runs = 0;
  const value = setup({
    read() { reads += 1; return readPending.promise; },
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

test('rolls back partial registration and rejects malformed services', () => {
  const failed = setup({ failOn: APPROVE_CURRENT_DRAFT_CHECK_CHANNEL });
  assert.throws(() => failed.runtime.register(), {
    code: 'builder_check_run_approval_ipc_runtime_unavailable',
  });
  assert.equal(failed.handlers.size, 0);
  assert.deepEqual(failed.removed, [READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL]);
  assert.throws(() => createBuilderCheckRunApprovalIpcRuntime({
    ipcMain: { handle() {}, removeHandler() {} },
    mainWindowRef: () => null,
    currentDraftCheckRunService: {
      service_version: 'builder-check-run-current-draft-service.v1',
      read_available_checks() {},
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
  assert.match(source, /activeRuns/u);
});
