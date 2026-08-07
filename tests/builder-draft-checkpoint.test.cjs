'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  BUILDER_DRAFT_CHECKPOINT_VERSION,
  DRAFT_CHECKPOINT_KIND,
  BuilderDraftCheckpointError,
  createBuilderDraftCheckpoint,
  sanitizeBuilderDraftCheckpoint,
} = require('../electron/builder-draft-checkpoint.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174400';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174401';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174402';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174403';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174404';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174405';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174406';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174407';
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;
const COMMIT_OID = '1'.repeat(40);
const TREE_OID = '2'.repeat(40);
const BASE_OID = '3'.repeat(40);

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function candidateReceipt(overrides = {}) {
  const seed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_id: REQUEST_ID,
    candidate_id: CANDIDATE_ID,
    candidate_digest: digest('b'),
    resulting_tree_digest: digest('c'),
    semantic_identity_digest: digest('d'),
    verification_receipt_digest: digest('e'),
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
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

function checkpointInput(overrides = {}) {
  const receipt = candidateReceipt(overrides.candidate_receipt ?? {});
  const verification = overrides.candidate_verification
    ?? createBuilderGitCandidateVerificationReceipt(receipt);
  return {
    candidate_receipt: receipt,
    candidate_verification: verification,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    checkpoint_sequence: 1,
    base_revision_ref: {
      revision_receipt_digest: digest('f'),
      commit_oid: BASE_OID,
    },
    created_at_ms: 20_000,
    summary: 'Checkpoint saved after AI changed the dashboard draft.',
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: 3,
      resulting_tree_digest: digest('c'),
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

function assertCheckpointError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderDraftCheckpointError);
      assert.equal(error.code, 'builder_draft_checkpoint_invalid');
      const text = JSON.stringify({
        name: error.name,
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
      assert.doesNotMatch(
        text,
        /secret-value|credential|provider|source_tree|file_content|Authorization|Bearer|api[_-]?key|C:\\Users/iu,
      );
      return true;
    },
  );
}

test('creates a deterministic local draft checkpoint from verified Git candidate evidence', () => {
  const first = createBuilderDraftCheckpoint(checkpointInput());
  const second = createBuilderDraftCheckpoint(structuredClone(checkpointInput()));

  assert.deepEqual(second, first);
  assert.equal(first.checkpoint_version, BUILDER_DRAFT_CHECKPOINT_VERSION);
  assert.equal(first.checkpoint_kind, DRAFT_CHECKPOINT_KIND);
  assert.match(first.checkpoint_id, /^builder-draft-checkpoint:[0-9a-f]{64}$/u);
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.session_id, SESSION_ID);
  assert.equal(first.task_address_id, TASK_ADDRESS_ID);
  assert.equal(first.conversation_id, CONVERSATION_ID);
  assert.equal(first.turn_id, TURN_ID);
  assert.equal(first.task_id, TASK_ID);
  assert.equal(first.run_id, RUN_ID);
  assert.equal(first.request_id, REQUEST_ID);
  assert.equal(first.candidate_ref.ref_kind, 'git_candidate_commit');
  assert.equal(first.candidate_ref.candidate_id, CANDIDATE_ID);
  assert.equal(first.candidate_ref.commit_oid, COMMIT_OID);
  assert.equal(first.candidate_ref.tree_oid, TREE_OID);
  assert.equal(first.candidate_ref.parent_oid, BASE_OID);
  assert.equal(first.base_revision_ref.revision_receipt_digest, digest('f'));
  assert.equal(first.source_scope.changed_file_count, 3);
  assert.equal(first.checkpoint_state, 'active');
  assert.equal(first.restore_eligibility, 'candidate_ref_verified');
  assert.equal(first.lifecycle.checkpoint_authority, 'main_draft_checkpoint_contract_v1');
  assert.equal(first.lifecycle.sqlite_write, 'not_performed');
  assert.equal(first.lifecycle.git_write, 'not_performed');
  assert.equal(first.lifecycle.renderer_authority, 'not_present');
  assert.equal(first.lifecycle.provider_dispatch, 'not_performed');
  assert.equal(first.lifecycle.source_mutation, 'not_performed');
  assert.equal(first.lifecycle.revision_admission, 'not_created');
  assert.equal(first.lifecycle.save_admission, 'not_performed');
  assert.equal(first.lifecycle.permission_grant, 'not_performed');
  assert.equal(first.lifecycle.publication, 'not_performed');
  assert.equal(first.lifecycle.autonomous_experiment, 'not_performed');
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(sanitizeBuilderDraftCheckpoint(structuredClone(first)), first);
  assert.doesNotMatch(
    JSON.stringify(first),
    /source_tree|file_content|operations|raw_prompt|provider_secret|credential|api[_-]?key|Authorization|Bearer|save_result|work_capsule|public_url/iu,
  );
});

test('supports first-draft checkpoints without a saved base revision', () => {
  const receipt = candidateReceipt({
    parent_oid: null,
    expected_base_oid: null,
  });
  const checkpoint = createBuilderDraftCheckpoint(checkpointInput({
    candidate_receipt: receipt,
    candidate_verification: createBuilderGitCandidateVerificationReceipt(receipt),
    base_revision_ref: {
      revision_receipt_digest: null,
      commit_oid: null,
    },
  }));

  assert.equal(checkpoint.candidate_ref.parent_oid, null);
  assert.equal(checkpoint.base_revision_ref.revision_receipt_digest, null);
  assert.equal(checkpoint.base_revision_ref.commit_oid, null);
});

test('fails closed for mismatched candidate, base, source, and lifecycle claims', () => {
  const receipt = candidateReceipt();
  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    candidate_receipt: receipt,
    candidate_verification: createBuilderGitCandidateVerificationReceipt({
      ...receipt,
      resulting_tree_digest: digest('9'),
    }),
  })));
  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    base_revision_ref: {
      revision_receipt_digest: digest('f'),
      commit_oid: '9'.repeat(40),
    },
  })));
  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: 3,
      resulting_tree_digest: digest('9'),
    },
  })));

  const checkpoint = createBuilderDraftCheckpoint(checkpointInput());
  assertCheckpointError(() => sanitizeBuilderDraftCheckpoint({
    ...checkpoint,
    checkpoint_state: 'promoted',
  }));
  assertCheckpointError(() => sanitizeBuilderDraftCheckpoint({
    ...checkpoint,
    lifecycle: {
      ...checkpoint.lifecycle,
      save_admission: 'performed',
    },
  }));
  assertCheckpointError(() => sanitizeBuilderDraftCheckpoint({
    ...checkpoint,
    candidate_ref: {
      ...checkpoint.candidate_ref,
      commit_oid: '9'.repeat(40),
    },
  }));
});

test('rejects extras, accessors, proxies, unsafe text, and hidden source payloads', () => {
  assertCheckpointError(() => createBuilderDraftCheckpoint({
    ...checkpointInput(),
    source_tree: 'secret-value',
  }));

  const accessor = checkpointInput();
  Object.defineProperty(accessor, 'summary', {
    enumerable: true,
    get: () => { throw new Error('secret-value'); },
  });
  assertCheckpointError(() => createBuilderDraftCheckpoint(accessor));

  let traps = 0;
  assertCheckpointError(() => createBuilderDraftCheckpoint(new Proxy(checkpointInput(), {
    ownKeys() {
      traps += 1;
      return [];
    },
  })));
  assert.equal(traps, 0);

  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    summary: ' padded ',
  })));
  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    verification_summary: {
      status: 'provider_claimed_success',
      summary: 'Provider said it worked.',
    },
  })));
  assertCheckpointError(() => createBuilderDraftCheckpoint(checkpointInput({
    source_scope: {
      scope_kind: 'project_candidate',
      changed_file_count: 50_001,
      resulting_tree_digest: digest('c'),
    },
  })));
});

test('source remains a pure checkpoint contract without runtime, save, or publication authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-checkpoint.cjs'),
    'utf8',
  );

  assert.match(source, /builder-draft-checkpoint\.v1/u);
  assert.match(source, /verified_git_candidate_receipt_pair/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|builder-provider|provider_secret|credential_value|secret_ref|child_process|execFile|spawn\s*\(|writeFile|appendFile|mkdir|rm\(|unlink|rmdir|persist_candidate_commit|record_project_revision|select_current|saveDraft|record_grant|publish|upload|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
