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
const { createBuilderDraftCheckpoint } = require('../electron/builder-draft-checkpoint.cjs');
const { createBuilderDraftCheckpointStore } = require('../electron/builder-draft-checkpoint-store.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION,
  BuilderDraftCheckpointTimelineProjectionError,
  projectBuilderDraftCheckpointTimeline,
  sanitizeBuilderDraftCheckpointTimelineProjection,
} = require('../electron/builder-draft-checkpoint-timeline-projection.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174600';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174601';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174602';
const OTHER_TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174602';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174603';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174605';
const BASE_OID = '3'.repeat(40);

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-checkpoint-timeline-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'draft-checkpoints.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function checkpoint(index) {
  const suffix = (700 + index).toString(16).padStart(12, '0');
  const receiptSeed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: `builder-turn:123e4567-e89b-42d3-a456-${suffix}`,
    task_id: TASK_ID,
    run_id: `builder-run:123e4567-e89b-42d3-a456-${suffix}`,
    request_id: `builder-git-request:123e4567-e89b-42d3-a456-${suffix}`,
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
  };
  const verification = createBuilderGitCandidateVerificationReceipt(receiptSeed);
  const receipt = {
    ...receiptSeed,
    verification_receipt_digest: sha256Canonical(verification),
  };
  return createBuilderDraftCheckpoint({
    candidate_receipt: receipt,
    candidate_verification: createBuilderGitCandidateVerificationReceipt(receipt),
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    checkpoint_sequence: index,
    base_revision_ref: { revision_receipt_digest: digest('f'), commit_oid: BASE_OID },
    created_at_ms: 20_000 + index,
    summary: index === 2
      ? 'Restored earlier draft checkpoint builder-draft-checkpoint:secret-value.'
      : `Changed C:\\Users\\secret-value with sha256:${'a'.repeat(64)}.`,
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: index + 1,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_summary: {
      status: index === 2 ? 'candidate_verified_with_warnings' : 'candidate_verified',
      summary: 'Candidate source was verified for local draft recovery.',
      edit_attempt_ref: {
        edit_attempt_id: `builder-edit-attempt:${'6'.repeat(64)}`,
        edit_attempt_digest: digest('6'),
        status: 'succeeded',
        candidate_id: receipt.candidate_id,
        candidate_digest: receipt.candidate_digest,
        resulting_tree_digest: receipt.resulting_tree_digest,
      },
    },
  });
}

function listRead(t, count = 2) {
  const store = createBuilderDraftCheckpointStore(temporaryDatabase(t));
  for (let index = 1; index <= count; index += 1) {
    store.record_draft_checkpoint({ draft_checkpoint: checkpoint(index) });
  }
  const result = store.list_draft_checkpoints_for_task({
    project_id: PROJECT_ID,
    task_address_id: count === 0 ? OTHER_TASK_ADDRESS_ID : TASK_ADDRESS_ID,
  });
  store.close();
  return result;
}

function assertProjectionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderDraftCheckpointTimelineProjectionError);
    assert.equal(error.code, 'builder_draft_checkpoint_timeline_projection_invalid');
    assert.equal(error.message, 'Builder draft checkpoint timeline is unavailable.');
    assert.equal(error.retryable, false);
    return true;
  });
}

test('projects a bounded newest-first renderer-safe checkpoint timeline', (t) => {
  const read = listRead(t, 2);
  const currentCandidateId = read.draft_checkpoints.at(-1).draft_checkpoint.candidate_ref.candidate_id;
  const result = projectBuilderDraftCheckpointTimeline({
    checkpoint_list_result: read,
    current_candidate_id: currentCandidateId,
  });

  assert.equal(result.projection_version, BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.entries, [
    {
      checkpoint_sequence: 2,
      created_at_ms: 20_002,
      label: 'Automatic checkpoint',
      changed_file_count: 3,
      verification_status: 'candidate_verified_with_warnings',
      is_current: true,
    },
    {
      checkpoint_sequence: 1,
      created_at_ms: 20_001,
      label: 'Automatic checkpoint',
      changed_file_count: 2,
      verification_status: 'candidate_verified',
      is_current: false,
    },
  ]);
  assert.deepEqual(sanitizeBuilderDraftCheckpointTimelineProjection(structuredClone(result)), result);
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret-value|builder-project:|builder-session:|builder-task-address:|builder-conversation:|builder-code-change-candidate:|builder-draft-checkpoint:|sha256:|commit_oid|tree_oid|candidate_digest|C:\\Users|credential|api[_-]?key/iu,
  );
});

test('projects an absent timeline without granting renderer authority', (t) => {
  const result = projectBuilderDraftCheckpointTimeline({
    checkpoint_list_result: listRead(t, 0),
    current_candidate_id: null,
  });
  assert.equal(result.status, 'absent');
  assert.deepEqual(result.entries, []);
  assert.equal(result.truncated, false);
  assert.equal(result.authority.restore_authority, false);
  assert.equal(result.authority.git_write, false);
  assert.equal(result.authority.sqlite_write, false);
});

test('fails closed for mismatched candidates and forged projections', (t) => {
  const read = listRead(t, 2);
  assertProjectionError(() => projectBuilderDraftCheckpointTimeline({
    checkpoint_list_result: read,
    current_candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
  }));
  const currentCandidateId = read.draft_checkpoints.at(-1).draft_checkpoint.candidate_ref.candidate_id;
  const projection = projectBuilderDraftCheckpointTimeline({
    checkpoint_list_result: read,
    current_candidate_id: currentCandidateId,
  });
  assertProjectionError(() => sanitizeBuilderDraftCheckpointTimelineProjection({
    ...projection,
    entries: projection.entries.map((entry, index) => ({
      ...entry,
      is_current: index === 0 || index === 1,
    })),
  }));
  assertProjectionError(() => sanitizeBuilderDraftCheckpointTimelineProjection({
    ...projection,
    authority: { ...projection.authority, restore_authority: true },
  }));
});
