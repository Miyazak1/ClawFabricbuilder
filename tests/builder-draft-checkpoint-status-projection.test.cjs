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
  createBuilderDraftCheckpoint,
} = require('../electron/builder-draft-checkpoint.cjs');
const {
  createBuilderDraftCheckpointStore,
} = require('../electron/builder-draft-checkpoint-store.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION,
  BuilderDraftCheckpointStatusProjectionError,
  projectBuilderDraftCheckpointStatus,
  sanitizeBuilderDraftCheckpointStatusProjection,
} = require('../electron/builder-draft-checkpoint-status-projection.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174600';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174601';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174602';
const OTHER_TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174602';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174603';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174604';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174605';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174606';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174607';
const BASE_OID = '3'.repeat(40);

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-checkpoint-status-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'draft-checkpoints.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function candidateReceipt(index = 1, overrides = {}) {
  const seed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: index === 1 ? TURN_ID : `builder-turn:123e4567-e89b-42d3-a456-${(700 + index).toString(16).padStart(12, '0')}`,
    task_id: TASK_ID,
    run_id: index === 1 ? RUN_ID : `builder-run:123e4567-e89b-42d3-a456-${(700 + index).toString(16).padStart(12, '0')}`,
    request_id: index === 1 ? REQUEST_ID : `builder-git-request:123e4567-e89b-42d3-a456-${(700 + index).toString(16).padStart(12, '0')}`,
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

function checkpoint(index = 1, overrides = {}) {
  const receipt = candidateReceipt(index, overrides.candidate_receipt ?? {});
  return createBuilderDraftCheckpoint({
    candidate_receipt: receipt,
    candidate_verification: createBuilderGitCandidateVerificationReceipt(receipt),
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    checkpoint_sequence: index,
    base_revision_ref: {
      revision_receipt_digest: digest('f'),
      commit_oid: BASE_OID,
    },
    created_at_ms: 20_000 + index,
    summary: `Checkpoint ${index} saved for local restore.`,
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: index + 1,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_summary: {
      status: index === 2 ? 'candidate_verified_with_warnings' : 'candidate_verified',
      summary: 'Git candidate evidence is available for restore.',
      edit_attempt_ref: {
        edit_attempt_id: `builder-edit-attempt:${'6'.repeat(64)}`,
        edit_attempt_digest: digest('6'),
        status: 'succeeded',
        candidate_id: receipt.candidate_id,
        candidate_digest: receipt.candidate_digest,
        resulting_tree_digest: receipt.resulting_tree_digest,
      },
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'candidate_receipt')),
  });
}

function readyRead(t) {
  const store = createBuilderDraftCheckpointStore(temporaryDatabase(t));
  store.record_draft_checkpoint({ draft_checkpoint: checkpoint(1) });
  store.record_draft_checkpoint({ draft_checkpoint: checkpoint(2) });
  const read = store.read_latest_draft_checkpoint_for_task({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  store.close();
  return read;
}

function absentRead(t) {
  const store = createBuilderDraftCheckpointStore(temporaryDatabase(t));
  const read = store.read_latest_draft_checkpoint_for_task({
    project_id: PROJECT_ID,
    task_address_id: OTHER_TASK_ADDRESS_ID,
  });
  store.close();
  return read;
}

function assertProjectionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderDraftCheckpointStatusProjectionError);
    assert.equal(error.code, 'builder_draft_checkpoint_status_projection_invalid');
    assert.equal(error.message, 'Builder draft checkpoint status is unavailable.');
    assert.equal(error.retryable, false);
    assert.equal(error.stack, `${error.name}: ${error.message}`);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|provider|source_tree|commit_oid|tree_oid|sha256:|C:\\Users|api[_-]?key|Bearer/iu,
    );
    return true;
  });
}

test('projects the latest Draft Checkpoint read result into renderer-safe status', (t) => {
  const result = projectBuilderDraftCheckpointStatus({
    latest_draft_checkpoint_read_result: readyRead(t),
  });

  assert.equal(result.projection_version, BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.label, 'Checkpoint saved');
  assert.equal(result.tone, 'success');
  assert.equal(result.next_action_hint, 'You can compare, restore, continue, or save a version.');
  assert.equal(result.can_compare, true);
  assert.equal(result.can_restore, true);
  assert.equal(result.can_save_version, true);
  assert.equal(result.changed_file_count, 3);
  assert.equal(result.verification_status, 'candidate_verified_with_warnings');
  assert.deepEqual(sanitizeBuilderDraftCheckpointStatusProjection(structuredClone(result)), result);
  assert.deepEqual(result.authority, {
    projection_authority: 'main_owned_draft_checkpoint_status_projection_v1',
    checkpoint_store_read: 'verified_latest_read_result',
    checkpoint_fact: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_read: 'not_present',
    git_write: false,
    sqlite_write: false,
    permission_grant: false,
    revision_admission: 'not_created',
    save_authority: false,
    publication: false,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /builder-project:|builder-session:|builder-task-address:|builder-conversation:|builder-task:|builder-run:|builder-code-change-candidate:|sha256:|commit_oid|tree_oid|candidate_digest|revision_receipt|source_tree|provider_(?:secret|config|envelope|context_body)|credential|api[_-]?key/iu,
  );
});

test('projects absent Draft Checkpoint state without exposing store internals', (t) => {
  const result = projectBuilderDraftCheckpointStatus({
    latest_draft_checkpoint_read_result: absentRead(t),
  });

  assert.equal(result.status, 'absent');
  assert.equal(result.label, 'No draft checkpoint yet');
  assert.equal(result.tone, 'neutral');
  assert.equal(result.can_compare, false);
  assert.equal(result.can_restore, false);
  assert.equal(result.can_save_version, false);
  assert.equal(result.changed_file_count, null);
  assert.equal(result.verification_status, null);
  assert.equal(result.authority.checkpoint_store_read, 'verified_absent_read_result');
  assert.equal(result.authority.checkpoint_fact, 'none');
  assert.doesNotMatch(JSON.stringify(result), /database_id|schema_fingerprint|sha256:|builder-task-address:/iu);
});

test('fails closed for forged read results, projections, accessors, and proxies', (t) => {
  const read = readyRead(t);
  assertProjectionError(() => projectBuilderDraftCheckpointStatus({
    latest_draft_checkpoint_read_result: {
      ...structuredClone(read),
      checkpoint_evidence: {
        ...read.checkpoint_evidence,
        save_authority: true,
      },
    },
  }));
  assertProjectionError(() => projectBuilderDraftCheckpointStatus({
    latest_draft_checkpoint_read_result: {
      ...structuredClone(read),
      draft_checkpoint: null,
    },
  }));
  assertProjectionError(() => sanitizeBuilderDraftCheckpointStatusProjection({
    ...projectBuilderDraftCheckpointStatus({ latest_draft_checkpoint_read_result: read }),
    label: 'Checkpoint saved sha256:aaaaaaaa',
  }));

  const accessor = {};
  Object.defineProperty(accessor, 'latest_draft_checkpoint_read_result', {
    enumerable: true,
    get() {
      throw new Error('secret-value');
    },
  });
  assertProjectionError(() => projectBuilderDraftCheckpointStatus(accessor));
  assertProjectionError(() => projectBuilderDraftCheckpointStatus(new Proxy({
    latest_draft_checkpoint_read_result: read,
  }, {})));
});

test('source remains a pure status projection without SQLite, Git, IPC, provider, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-checkpoint-status-projection.cjs'),
    'utf8',
  );

  assert.match(source, /builder-draft-checkpoint-status-projection\.v1/u);
  assert.match(source, /main_owned_draft_checkpoint_status_projection_v1/u);
  assert.doesNotMatch(
    source,
    /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider_(?:secret|config|envelope|context_body)|credential|source_tree|child_process|execFile|spawn\s*\(|writeFile|appendFile|mkdir|rm\(|unlink|record_project_revision|select_current|saveDraft|publish|upload|safeStorage|Authorization|Bearer/iu,
  );
});
