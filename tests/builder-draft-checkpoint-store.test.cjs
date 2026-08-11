'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
  BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
  BuilderDraftCheckpointStoreError,
  createBuilderDraftCheckpointStore,
} = require('../electron/builder-draft-checkpoint-store.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174500';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174500';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174501';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174502';
const OTHER_TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174502';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174503';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174504';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174505';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174506';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174507';
const COMMIT_OID = '1'.repeat(40);
const TREE_OID = '2'.repeat(40);
const BASE_OID = '3'.repeat(40);

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-draft-checkpoints-'));
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
    turn_id: index === 1 ? TURN_ID : builderId('turn', 700 + index),
    task_id: TASK_ID,
    run_id: index === 1 ? RUN_ID : builderId('run', 700 + index),
    request_id: index === 1 ? REQUEST_ID : builderId('git-request', 700 + index),
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
  const verification = overrides.candidate_verification
    ?? createBuilderGitCandidateVerificationReceipt(receipt);
  return createBuilderDraftCheckpoint({
    candidate_receipt: receipt,
    candidate_verification: verification,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    checkpoint_sequence: index,
    base_revision_ref: {
      revision_receipt_digest: digest('f'),
      commit_oid: BASE_OID,
    },
    created_at_ms: 10_000 + index,
    summary: `Checkpoint ${index} saved for local restore.`,
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: index,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_summary: {
      status: 'candidate_verified',
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
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => (
      key !== 'candidate_receipt' && key !== 'candidate_verification'
    ))),
  });
}

function assertStoreError(fn, expectedCode = 'builder_draft_checkpoint_store_invalid') {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderDraftCheckpointStoreError);
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

test('records Draft Checkpoints and restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderDraftCheckpointStore(databasePath);
  const record = checkpoint(1, {
    candidate_receipt: {
      commit_oid: COMMIT_OID,
      tree_oid: TREE_OID,
    },
  });

  assert.equal(store.store_version, BUILDER_DRAFT_CHECKPOINT_STORE_VERSION);
  const recorded = store.record_draft_checkpoint({ draft_checkpoint: record });
  assert.equal(recorded.result_version, BUILDER_DRAFT_CHECKPOINT_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'draft_checkpoint_recorded');
  assert.deepEqual(recorded.draft_checkpoint.draft_checkpoint, record);
  assert.equal(recorded.checkpoint_evidence.checkpoint_authority, 'main_owned_draft_checkpoint_store');
  assert.equal(recorded.checkpoint_evidence.checkpoint_contract_authority, 'main_draft_checkpoint_contract_v1');
  assert.equal(recorded.checkpoint_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.checkpoint_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.checkpoint_evidence.conversation_append, false);
  assert.equal(recorded.checkpoint_evidence.provider_dispatch, false);
  assert.equal(recorded.checkpoint_evidence.model_dispatch, false);
  assert.equal(recorded.checkpoint_evidence.source_read, 'not_present');
  assert.equal(recorded.checkpoint_evidence.source_write, 'not_present');
  assert.equal(recorded.checkpoint_evidence.git_mutation, false);
  assert.equal(recorded.checkpoint_evidence.permission_grant_authority, false);
  assert.equal(recorded.checkpoint_evidence.revision_authority, false);
  assert.equal(recorded.checkpoint_evidence.save_authority, false);
  assert.equal(recorded.checkpoint_evidence.publication, false);
  assert.equal(recorded.checkpoint_evidence.work_capsule_authority, false);
  assert.equal(recorded.checkpoint_evidence.recovery_model, 'idempotent_store_replay');
  assert.equal(recorded.checkpoint_evidence.schema_version, BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION);
  assert.equal(recorded.checkpoint_evidence.user_version, BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION);
  assert.match(recorded.checkpoint_evidence.schema_fingerprint_digest, /^sha256:[0-9a-f]{64}$/u);

  const replayed = store.record_draft_checkpoint({ draft_checkpoint: record });
  assert.equal(replayed.operation, 'draft_checkpoint_replayed');
  assert.deepEqual(replayed.draft_checkpoint.draft_checkpoint, record);

  const read = store.read_draft_checkpoint({
    project_id: PROJECT_ID,
    checkpoint_id: record.checkpoint_id,
  });
  assert.equal(read.result_version, BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.draft_checkpoint.draft_checkpoint, record);
  assert.equal(Object.isFrozen(read.draft_checkpoint.draft_checkpoint), true);
  store.close();

  const restarted = createBuilderDraftCheckpointStore(databasePath);
  const restored = restarted.read_draft_checkpoint({
    project_id: PROJECT_ID,
    checkpoint_id: record.checkpoint_id,
  });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.draft_checkpoint.draft_checkpoint, record);
  restarted.close();
});

test('reads latest and ordered Draft Checkpoints for a Task Address', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderDraftCheckpointStore(databasePath);
  const first = checkpoint(1);
  const second = checkpoint(2);
  const otherTask = checkpoint(3, {
    task_address_id: OTHER_TASK_ADDRESS_ID,
    checkpoint_sequence: 1,
  });

  store.record_draft_checkpoint({ draft_checkpoint: second });
  store.record_draft_checkpoint({ draft_checkpoint: first });
  store.record_draft_checkpoint({ draft_checkpoint: otherTask });

  const latest = store.read_latest_draft_checkpoint_for_task({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(latest.status, 'ready');
  assert.equal(latest.draft_checkpoint.draft_checkpoint.checkpoint_id, second.checkpoint_id);

  const list = store.list_draft_checkpoints_for_task({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.equal(list.status, 'ready');
  assert.deepEqual(
    list.draft_checkpoints.map((entry) => entry.draft_checkpoint.checkpoint_id),
    [first.checkpoint_id, second.checkpoint_id],
  );
  assert.equal(list.truncated, false);

  assert.equal(
    store.read_draft_checkpoint({
      project_id: OTHER_PROJECT_ID,
      checkpoint_id: first.checkpoint_id,
    }).status,
    'absent',
  );
  assert.equal(
    store.read_latest_draft_checkpoint_for_task({
      project_id: PROJECT_ID,
      task_address_id: 'builder-task-address:323e4567-e89b-42d3-a456-426614174502',
    }).status,
    'absent',
  );
  store.close();
});

test('rejects conflicting replay, malformed input, accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderDraftCheckpointStore(databasePath);
  const record = checkpoint(1);
  store.record_draft_checkpoint({ draft_checkpoint: record });

  const conflictingSequence = checkpoint(2, {
    checkpoint_sequence: record.checkpoint_sequence,
  });
  assertStoreError(
    () => store.record_draft_checkpoint({ draft_checkpoint: conflictingSequence }),
    'builder_draft_checkpoint_store_conflict',
  );
  assertStoreError(() => store.record_draft_checkpoint({ draft_checkpoint: record, extra: true }));
  assertStoreError(() => store.read_draft_checkpoint({
    project_id: PROJECT_ID,
    checkpoint_id: record.checkpoint_id,
    extra: true,
  }));
  assertStoreError(() => store.read_latest_draft_checkpoint_for_task({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
    extra: true,
  }));
  assertStoreError(() => store.list_draft_checkpoints_for_task({
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'draft_checkpoint', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  assertStoreError(() => store.record_draft_checkpoint(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_draft_checkpoint(new Proxy(
    { draft_checkpoint: record },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE draft_checkpoints SET run_id = ? WHERE checkpoint_id = ?')
    .run(builderId('run', 999), record.checkpoint_id);
  raw.close();

  const reopened = createBuilderDraftCheckpointStore(databasePath);
  assertStoreError(
    () => reopened.read_draft_checkpoint({ project_id: PROJECT_ID, checkpoint_id: record.checkpoint_id }),
    'builder_draft_checkpoint_store_integrity_failed',
  );
  reopened.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderDraftCheckpointStore(databasePath);
  store.close();

  assertStoreError(
    () => createBuilderDraftCheckpointStore(path.join('relative', 'draft-checkpoints.sqlite')),
    'builder_draft_checkpoint_store_invalid',
  );
  assertStoreError(
    () => createBuilderDraftCheckpointStore(
      path.join(os.tmpdir(), 'missing-parent-for-draft-checkpoint-store', 'draft-checkpoints.sqlite'),
    ),
    'builder_draft_checkpoint_store_unavailable',
  );

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_draft_checkpoint_fact(id TEXT) STRICT');
  raw.close();
  assertStoreError(
    () => createBuilderDraftCheckpointStore(databasePath),
    'builder_draft_checkpoint_store_integrity_failed',
  );
});

test('source boundary remains a main-only Draft Checkpoint store without save or runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-checkpoint-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_draft_checkpoint_store/u);
  assert.match(source, /main_draft_checkpoint_contract_v1/u);
  assert.match(source, /record_draft_checkpoint/u);
  assert.match(source, /read_latest_draft_checkpoint_for_task/u);
  assert.match(source, /list_draft_checkpoints_for_task/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /conversation_append: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /save_authority: false/u);
  assert.match(source, /publication: false/u);
  assert.match(source, /work_capsule_authority: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|stdout|stderr|record_project_revision|select_current|publish|upload/iu,
  );
});
