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
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  createBuilderDraftCheckpointStore,
} = require('../electron/builder-draft-checkpoint-store.cjs');
const {
  createBuilderDraftCheckpointRecordingService,
} = require('../electron/builder-draft-checkpoint-recording-service.cjs');
const {
  BuilderAutomaticDraftCheckpointServiceError,
  createBuilderAutomaticDraftCheckpointService,
} = require('../electron/builder-automatic-draft-checkpoint-service.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174800';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174801';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174802';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174803';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174805';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174806';
const BASE_OID = '3'.repeat(40);

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function temporaryStores() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-auto-checkpoint-'));
  return {
    root,
    address: path.join(root, 'addresses.sqlite'),
    checkpoint: path.join(root, 'checkpoints.sqlite'),
  };
}

function candidateReceipt(index, { firstDraft = false } = {}) {
  const character = index.toString(16);
  const seed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: `builder-turn:123e4567-e89b-42d3-a456-${(900 + index).toString().padStart(12, '0')}`,
    task_id: TASK_ID,
    run_id: `builder-run:123e4567-e89b-42d3-a456-${(910 + index).toString().padStart(12, '0')}`,
    request_id: `builder-git-request:123e4567-e89b-42d3-a456-${(920 + index).toString().padStart(12, '0')}`,
    candidate_id: `builder-code-change-candidate:${character.repeat(64).slice(0, 64)}`,
    candidate_digest: digest(character),
    resulting_tree_digest: digest((index + 1).toString(16)),
    semantic_identity_digest: digest((index + 2).toString(16)),
    verification_receipt_digest: digest((index + 3).toString(16)),
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: character.repeat(40).slice(0, 40),
    tree_oid: (index + 1).toString(16).repeat(40).slice(0, 40),
    parent_oid: firstDraft ? null : BASE_OID,
    expected_base_oid: firstDraft ? null : BASE_OID,
    code_authority: CODE_AUTHORITY,
    product_revision_admission: PRODUCT_REVISION_ADMISSION,
    replay: false,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(seed);
  return { ...seed, verification_receipt_digest: sha256Canonical(verification) };
}

function setup(t) {
  const paths = temporaryStores();
  const addressStore = createBuilderSessionTaskAddressStore(paths.address);
  addressStore.record_session_address({
    session_address: createBuilderSessionAddress({
      session_id: SESSION_ID,
      project_id: PROJECT_ID,
      display_id: 'S-A1B2C3',
      title: 'Automatic checkpoint session',
      status: 'active',
      root_conversation_id: CONVERSATION_ID,
      current_task_id: TASK_ADDRESS_ID,
      parent_session_id: null,
      forked_from_session_id: null,
      forked_from_revision_receipt_digest: null,
      created_by: 'local-user',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
      archived_at_ms: null,
    }),
  });
  addressStore.record_task_address({
    task_address: createBuilderTaskAddress({
      task_address_id: TASK_ADDRESS_ID,
      session_id: SESSION_ID,
      project_id: PROJECT_ID,
      agent_id: AGENT_ID,
      parent_task_address_id: null,
      conversation_id: CONVERSATION_ID,
      title: 'Automatic checkpoint task',
      goal: 'Keep verified AI changes recoverable.',
      status: 'active',
      current_brief_id: null,
      current_plan_id: null,
      base_revision_receipt_digest: null,
      produced_revision_receipt_digest: null,
      created_by: 'local-user',
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
      closed_at_ms: null,
    }),
  });
  const checkpointStore = createBuilderDraftCheckpointStore(paths.checkpoint);
  const recordingService = createBuilderDraftCheckpointRecordingService({
    draft_checkpoint_store: checkpointStore,
  });
  let now = 10_000;
  const service = createBuilderAutomaticDraftCheckpointService({
    address_store: addressStore,
    draft_checkpoint_store: checkpointStore,
    draft_checkpoint_recording_service: recordingService,
    now_ms: () => now++,
  });
  t.after(() => {
    checkpointStore.close();
    addressStore.close();
    fs.rmSync(paths.root, { force: true, recursive: true });
  });
  return { service, checkpointStore };
}

function recordRequest(index, { firstDraft = false } = {}) {
  const receipt = candidateReceipt(index, { firstDraft });
  return {
    candidate_receipt: receipt,
    candidate_verification: createBuilderGitCandidateVerificationReceipt(receipt),
    base_revision_ref: firstDraft
      ? { revision_receipt_digest: null, commit_oid: null }
      : { revision_receipt_digest: digest('f'), commit_oid: BASE_OID },
    summary: `Automatic checkpoint ${index}`,
    changed_file_count: index,
  };
}

test('records, replays, and increments automatic checkpoints for the current task address', (t) => {
  const { service, checkpointStore } = setup(t);
  const first = service.record_verified_candidate_checkpoint(recordRequest(1));
  const replay = service.record_verified_candidate_checkpoint(recordRequest(1));
  const second = service.record_verified_candidate_checkpoint(recordRequest(2));

  assert.equal(first.operation, 'draft_checkpoint_recorded');
  assert.equal(replay.operation, 'draft_checkpoint_replayed');
  assert.equal(second.draft_checkpoint.draft_checkpoint.checkpoint_sequence, 2);
  assert.equal(first.draft_checkpoint_status_projection.label, 'Checkpoint saved');
  assert.equal(second.draft_checkpoint_status_projection.changed_file_count, 2);
  assert.equal(
    checkpointStore.list_draft_checkpoints_for_task({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }).draft_checkpoints.length,
    2,
  );
});

test('records the first automatic checkpoint without a saved base revision', (t) => {
  const { service } = setup(t);
  const result = service.record_verified_candidate_checkpoint(recordRequest(1, { firstDraft: true }));

  assert.equal(result.status, 'ready');
  assert.equal(result.draft_checkpoint.draft_checkpoint.base_revision_ref.revision_receipt_digest, null);
  assert.equal(result.draft_checkpoint.draft_checkpoint.base_revision_ref.commit_oid, null);
});

test('projects status only for the current candidate and fails closed without an address', (t) => {
  const { service } = setup(t);
  const request = recordRequest(1);
  service.record_verified_candidate_checkpoint(request);
  assert.equal(service.read_current_checkpoint_status({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    candidate_id: request.candidate_receipt.candidate_id,
  }).status, 'ready');
  assert.equal(service.read_current_checkpoint_status({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    candidate_id: `builder-code-change-candidate:${'9'.repeat(64)}`,
  }).status, 'absent');
  const verified = service.verify_current_candidate_checkpoint({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: request.candidate_receipt.task_id,
    run_id: request.candidate_receipt.run_id,
    candidate_id: request.candidate_receipt.candidate_id,
    candidate_digest: request.candidate_receipt.candidate_digest,
    resulting_tree_digest: request.candidate_receipt.resulting_tree_digest,
  });
  assert.equal(verified.operation, 'current_candidate_checkpoint_verified');
  assert.equal(verified.status, 'verified');
  assert.equal(verified.checkpoint_ref.checkpoint_sequence, 1);
  assert.equal(verified.verification_admission, 'main_owned_latest_checkpoint_verified');
  assert.throws(() => service.verify_current_candidate_checkpoint({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: request.candidate_receipt.task_id,
    run_id: request.candidate_receipt.run_id,
    candidate_id: request.candidate_receipt.candidate_id,
    candidate_digest: digest('9'),
    resulting_tree_digest: request.candidate_receipt.resulting_tree_digest,
  }), BuilderAutomaticDraftCheckpointServiceError);
  assert.throws(
    () => service.record_verified_candidate_checkpoint({ ...request, changed_file_count: 0 }),
    BuilderAutomaticDraftCheckpointServiceError,
  );
});
