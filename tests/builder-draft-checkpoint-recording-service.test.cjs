'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
  createBuilderDraftCheckpointStore,
} = require('../electron/builder-draft-checkpoint-store.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,
  BuilderDraftCheckpointRecordingServiceError,
  createBuilderDraftCheckpointRecordingService,
} = require('../electron/builder-draft-checkpoint-recording-service.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174800';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174801';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174802';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174803';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174804';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174805';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174806';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174807';
const BASE_OID = '3'.repeat(40);

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-draft-checkpoint-service-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'draft-checkpoints.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function uuid(index) {
  return `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function builderId(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function candidateReceipt(index = 1, overrides = {}) {
  const seed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: index === 1 ? TURN_ID : builderId('turn', 900 + index),
    task_id: TASK_ID,
    run_id: index === 1 ? RUN_ID : builderId('run', 900 + index),
    request_id: index === 1 ? REQUEST_ID : builderId('git-request', 900 + index),
    candidate_id: `builder-code-change-candidate:${index.toString(16).repeat(64).slice(0, 64)}`,
    candidate_digest: digest(index.toString(16)),
    resulting_tree_digest: digest((index + 1).toString(16)),
    semantic_identity_digest: digest((index + 2).toString(16)),
    verification_receipt_digest: digest((index + 3).toString(16)),
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: index.toString(16).repeat(40).slice(0, 40),
    tree_oid: (index + 1).toString(16).repeat(40).slice(0, 40),
    parent_oid: BASE_OID,
    expected_base_oid: BASE_OID,
    code_authority: CODE_AUTHORITY,
    product_revision_admission: PRODUCT_REVISION_ADMISSION,
    replay: false,
    ...overrides,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(seed);
  return { ...seed, verification_receipt_digest: sha256Canonical(verification) };
}

function checkpointRequest(index = 1, overrides = {}) {
  const receipt = candidateReceipt(index, overrides.candidate_receipt ?? {});
  const verification = overrides.candidate_verification
    ?? createBuilderGitCandidateVerificationReceipt(receipt);
  return {
    candidate_receipt: receipt,
    candidate_verification: verification,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    checkpoint_sequence: index,
    base_revision_ref: {
      revision_receipt_digest: digest('f'),
      commit_oid: BASE_OID,
    },
    created_at_ms: 30_000 + index,
    summary: `Checkpoint ${index} saved after AI prepared a local draft.`,
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: index,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_summary: {
      status: 'candidate_verified',
      summary: 'Git candidate evidence is available for restore.',
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => (
      key !== 'candidate_receipt' && key !== 'candidate_verification'
    ))),
  };
}

function openService(databasePath) {
  const store = createBuilderDraftCheckpointStore(databasePath);
  const service = createBuilderDraftCheckpointRecordingService({
    draft_checkpoint_store: store,
  });
  return { service, store };
}

function assertServiceError(fn, expectedCode = 'builder_draft_checkpoint_recording_service_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderDraftCheckpointRecordingServiceError);
      assert.equal(error.code, expectedCode);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|api[_-]?key|credential|provider|source_tree|C:\\|raw prompt|private marker|Bearer/iu,
      );
      return true;
    },
  );
}

test('records a Draft Checkpoint from verified candidate evidence and restores it after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const { service, store } = openService(databasePath);

  assert.equal(service.service_version, BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION);
  const recorded = service.record_draft_checkpoint_from_candidate(checkpointRequest(1));

  assert.equal(recorded.result_version, BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_RESULT_VERSION);
  assert.equal(recorded.service_version, BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION);
  assert.equal(recorded.operation, 'draft_checkpoint_recorded_from_candidate');
  assert.equal(recorded.status, 'ready');
  assert.equal(recorded.store_operation, 'draft_checkpoint_recorded');
  assert.equal(recorded.checkpoint_count_for_task, 1);
  assert.equal(
    recorded.draft_checkpoint.draft_checkpoint.checkpoint_id,
    recorded.checkpoint_read.draft_checkpoint.draft_checkpoint.checkpoint_id,
  );
  assert.equal(
    recorded.latest_checkpoint_read.draft_checkpoint.draft_checkpoint.checkpoint_id,
    recorded.draft_checkpoint.draft_checkpoint.checkpoint_id,
  );
  assert.equal(recorded.draft_checkpoint.draft_checkpoint.project_id, PROJECT_ID);
  assert.equal(recorded.draft_checkpoint.draft_checkpoint.session_id, SESSION_ID);
  assert.equal(recorded.draft_checkpoint.draft_checkpoint.task_address_id, TASK_ADDRESS_ID);
  assert.equal(recorded.draft_checkpoint.draft_checkpoint.restore_eligibility, 'candidate_ref_verified');
  assert.equal(recorded.evidence.service_authority, 'main_owned_draft_checkpoint_recording_service');
  assert.equal(recorded.evidence.checkpoint_store_authority, 'main_owned_draft_checkpoint_store');
  assert.equal(recorded.evidence.candidate_authority, 'verified_git_candidate_receipt_pair');
  assert.equal(recorded.evidence.renderer_authority, 'not_present');
  assert.equal(recorded.evidence.ipc_authority, 'not_present');
  assert.equal(recorded.evidence.conversation_append, false);
  assert.equal(recorded.evidence.provider_dispatch, false);
  assert.equal(recorded.evidence.model_dispatch, false);
  assert.equal(recorded.evidence.source_write, 'not_present');
  assert.equal(recorded.evidence.git_mutation, false);
  assert.equal(recorded.evidence.permission_grant_authority, false);
  assert.equal(recorded.evidence.review_authority, false);
  assert.equal(recorded.evidence.revision_authority, false);
  assert.equal(recorded.evidence.save_authority, false);
  assert.equal(recorded.evidence.work_capsule_authority, false);
  assert.equal(Object.isFrozen(recorded), true);
  assert.doesNotMatch(
    JSON.stringify(recorded),
    /source_tree|file_content|operations|raw_prompt|provider_secret|secret-value|api[_-]?key|Authorization|Bearer|save_result|public_url/iu,
  );
  store.close();

  const restarted = openService(databasePath);
  const replayed = restarted.service.record_draft_checkpoint_from_candidate(checkpointRequest(1));
  assert.equal(replayed.store_operation, 'draft_checkpoint_replayed');
  assert.deepEqual(
    replayed.draft_checkpoint.draft_checkpoint,
    recorded.draft_checkpoint.draft_checkpoint,
  );
  restarted.store.close();
});

test('tracks the latest checkpoint and ordered task count for repeated mutating turns', (t) => {
  const databasePath = temporaryDatabase(t);
  const { service, store } = openService(databasePath);

  const first = service.record_draft_checkpoint_from_candidate(checkpointRequest(1));
  const second = service.record_draft_checkpoint_from_candidate(checkpointRequest(2));

  assert.equal(first.checkpoint_count_for_task, 1);
  assert.equal(second.checkpoint_count_for_task, 2);
  assert.notEqual(
    first.draft_checkpoint.draft_checkpoint.checkpoint_id,
    second.draft_checkpoint.draft_checkpoint.checkpoint_id,
  );
  assert.equal(
    second.latest_checkpoint_read.draft_checkpoint.draft_checkpoint.checkpoint_id,
    second.draft_checkpoint.draft_checkpoint.checkpoint_id,
  );
  assert.deepEqual(
    store.list_draft_checkpoints_for_task({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }).draft_checkpoints.map((entry) => entry.draft_checkpoint.checkpoint_id),
    [
      first.draft_checkpoint.draft_checkpoint.checkpoint_id,
      second.draft_checkpoint.draft_checkpoint.checkpoint_id,
    ],
  );
  store.close();
});

test('maps replay drift, unavailable stores, malformed input, accessors, and proxies to fixed errors', (t) => {
  const databasePath = temporaryDatabase(t);
  const { service, store } = openService(databasePath);
  service.record_draft_checkpoint_from_candidate(checkpointRequest(1));

  assertServiceError(
    () => service.record_draft_checkpoint_from_candidate(checkpointRequest(2, {
      checkpoint_sequence: 1,
    })),
    'builder_draft_checkpoint_recording_service_conflict',
  );
  assertServiceError(() => service.record_draft_checkpoint_from_candidate({
    ...checkpointRequest(1),
    source_tree: 'secret-value',
  }));

  const accessor = checkpointRequest(1);
  Object.defineProperty(accessor, 'summary', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assertServiceError(() => service.record_draft_checkpoint_from_candidate(accessor));

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertServiceError(() => service.record_draft_checkpoint_from_candidate(new Proxy(
    checkpointRequest(1),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  assertServiceError(
    () => service.record_draft_checkpoint_from_candidate(checkpointRequest(3)),
    'builder_draft_checkpoint_recording_service_unavailable',
  );
});

test('rejects invalid store authority and keeps source free of runtime capabilities', () => {
  assertServiceError(() => createBuilderDraftCheckpointRecordingService({}));
  assertServiceError(() => createBuilderDraftCheckpointRecordingService({
    draft_checkpoint_store: {
      store_version: 'wrong-store-version',
      record_draft_checkpoint() {},
      read_draft_checkpoint() {},
      read_latest_draft_checkpoint_for_task() {},
      list_draft_checkpoints_for_task() {},
    },
  }));
  assertServiceError(() => createBuilderDraftCheckpointRecordingService({
    draft_checkpoint_store: new Proxy(
      { store_version: BUILDER_DRAFT_CHECKPOINT_STORE_VERSION },
      {
        ownKeys() { throw new Error('secret-value'); },
      },
    ),
  }));

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-checkpoint-recording-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|BrowserWindow|safeStorage|fetch\s*\(|http\.|https\.|child_process|spawn|execFile|projectWorkspace\.saveDraft|saveDraft|generateApprovedPlan|proposePlan|providerSettings|workCapsule|publish/iu,
  );
});
