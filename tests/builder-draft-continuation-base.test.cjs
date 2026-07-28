'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderDraftContinuationAdmission,
} = require('../electron/builder-draft-continuation-admission.cjs');
const {
  BUILDER_DRAFT_CONTINUATION_BASE_VERSION,
  DRAFT_CONTINUATION_BASE_KIND,
  BuilderDraftContinuationBaseError,
  createBuilderDraftContinuationBase,
  sanitizeBuilderDraftContinuationBase,
} = require('../electron/builder-draft-continuation-base.cjs');
const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const GIT_REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174005';
const CONTINUATION_ID = 'builder-draft-continuation:123e4567-e89b-42d3-a456-426614174006';
const DRAFT_ID = `builder-generation-draft:${'1'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'2'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'3'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'4'.repeat(64)}`;
const EVENT_DIGEST = `sha256:${'5'.repeat(64)}`;
const EVENT_ID = `builder-conversation-event:${'6'.repeat(64)}`;
const SEMANTIC_DIGEST = `sha256:${'7'.repeat(64)}`;
const COMMIT_OID = '8'.repeat(40);
const TREE_OID = '9'.repeat(40);
const PARENT_OID = 'a'.repeat(40);

function sourceTree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Draft</main>\n' },
      { path: 'src/app.js', content: 'export const draft = true;\n' },
    ],
  });
}

function pendingDraft(tree = sourceTree()) {
  return {
    result_version: 'builder-generation-pending-draft.v2',
    draft_id: DRAFT_ID,
    restart_restore: 'git_sqlite_verified',
    conversation_event_admission: 'sqlite_recorded',
    git_request_id: GIT_REQUEST_ID,
    title: 'Dashboard draft',
    summary: 'A pending dashboard candidate waiting for review.',
    conversation_head: {
      sequence: 9,
      event_id: EVENT_ID,
      event_digest: EVENT_DIGEST,
    },
    candidate_proof: {
      proof_version: 'builder-generation-pending-candidate-proof.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      request_digest: REQUEST_DIGEST,
      git_request_id: GIT_REQUEST_ID,
      candidate_id: CANDIDATE_ID,
      candidate_digest: CANDIDATE_DIGEST,
      resulting_tree_digest: tree.source_tree_digest,
      expected_base_oid: PARENT_OID,
      base_revision: {
        revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
        commit_oid: PARENT_OID,
      },
    },
  };
}

function admission(tree = sourceTree()) {
  return createBuilderDraftContinuationAdmission({
    pending_draft: pendingDraft(tree),
    continuation_id: CONTINUATION_ID,
    admitted_at_ms: 10_000,
  });
}

function candidateReceipt(tree = sourceTree(), overrides = {}) {
  const unsigned = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_id: GIT_REQUEST_ID,
    candidate_id: CANDIDATE_ID,
    candidate_digest: CANDIDATE_DIGEST,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: SEMANTIC_DIGEST,
    verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    parent_oid: PARENT_OID,
    expected_base_oid: PARENT_OID,
    code_authority: CODE_AUTHORITY,
    product_revision_admission: PRODUCT_REVISION_ADMISSION,
    replay: false,
    ...overrides,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(unsigned);
  return {
    ...unsigned,
    verification_receipt_digest: sha256Canonical(verification),
  };
}

function verifiedCandidate(tree = sourceTree(), overrides = {}) {
  const receipt = candidateReceipt(tree, overrides.receipt ?? {});
  return {
    result_version: 'builder-git-verified-candidate-read-result.v1',
    candidate_receipt: receipt,
    verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
    source_tree: tree,
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
    ...overrides.result,
  };
}

function assertBaseError(error) {
  assert.equal(error instanceof BuilderDraftContinuationBaseError, true);
  assert.equal(error.code, 'builder_draft_continuation_base_invalid');
  assert.equal(error.message, 'The draft continuation base could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

function baseDigest(value) {
  return sha256Canonical({
    admission_digest: value.admission_digest,
    base_kind: value.base_kind,
    base_source_tree_digest: value.base_source_tree_digest,
    base_version: value.base_version,
    draft_id: value.draft_id,
    parent_candidate_commit_oid: value.parent_candidate_commit_oid,
    parent_candidate_expected_base_oid: value.parent_candidate_expected_base_oid,
    parent_candidate_request_id: value.parent_candidate_request_id,
    parent_candidate_tree_oid: value.parent_candidate_tree_oid,
    previous_candidate_digest: value.previous_candidate_digest,
    previous_candidate_id: value.previous_candidate_id,
    previous_resulting_tree_digest: value.previous_resulting_tree_digest,
    previous_run_id: value.previous_run_id,
    previous_task_id: value.previous_task_id,
    previous_turn_id: value.previous_turn_id,
    project_id: value.project_id,
  });
}

test('binds a draft continuation base to the verified pending candidate commit', () => {
  const tree = sourceTree();
  const base = createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: verifiedCandidate(tree),
  });

  assert.equal(base.base_version, BUILDER_DRAFT_CONTINUATION_BASE_VERSION);
  assert.equal(base.base_kind, DRAFT_CONTINUATION_BASE_KIND);
  assert.equal(base.project_id, PROJECT_ID);
  assert.equal(base.conversation_id, CONVERSATION_ID);
  assert.equal(base.draft_id, DRAFT_ID);
  assert.equal(base.previous_turn_id, TURN_ID);
  assert.equal(base.previous_task_id, TASK_ID);
  assert.equal(base.previous_run_id, RUN_ID);
  assert.equal(base.previous_candidate_id, CANDIDATE_ID);
  assert.equal(base.previous_candidate_digest, CANDIDATE_DIGEST);
  assert.equal(base.previous_resulting_tree_digest, tree.source_tree_digest);
  assert.equal(base.parent_candidate_request_id, GIT_REQUEST_ID);
  assert.equal(base.parent_candidate_commit_oid, COMMIT_OID);
  assert.equal(base.parent_candidate_tree_oid, TREE_OID);
  assert.equal(base.parent_candidate_expected_base_oid, PARENT_OID);
  assert.deepEqual(base.base_source_tree, tree);
  assert.equal(base.base_source_tree_digest, tree.source_tree_digest);
  assert.deepEqual(base.authority, {
    base_authority: 'main_draft_continuation_pending_candidate_base_v1',
    admission_authority: 'main_draft_continuation_admission_contract_v1',
    code_authority: 'git_commit_tree',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: 'not_performed',
    source_read: 'main_verified_candidate_source_tree',
    source_mutation: 'not_performed',
    git_parent_authority: 'verified_pending_candidate_commit',
    project_revision_authority: 'not_present',
    save_authority: 'not_present',
    base_revision_semantics: 'not_a_project_revision',
  });
  assert.equal(base.base_digest, baseDigest(base));
  assert.deepEqual(sanitizeBuilderDraftContinuationBase(base), base);
  assert.equal(Object.isFrozen(base), true);
  assert.equal(Object.isFrozen(base.base_source_tree), true);
  assert.equal(Object.isFrozen(base.authority), true);
});

test('rejects mismatched admission, receipt, verification, or source evidence', () => {
  const tree = sourceTree();
  assert.throws(() => createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: verifiedCandidate(tree, {
      receipt: { candidate_digest: `sha256:${'c'.repeat(64)}` },
    }),
  }), assertBaseError);
  assert.throws(() => createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: verifiedCandidate(tree, {
      receipt: { turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174999' },
    }),
  }), assertBaseError);

  const forgedVerification = verifiedCandidate(tree);
  forgedVerification.verification_receipt = {
    ...forgedVerification.verification_receipt,
    commit_oid: 'd'.repeat(40),
  };
  assert.throws(() => createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: forgedVerification,
  }), assertBaseError);

  const otherTree = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Different</main>\n' }],
  });
  assert.throws(() => createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: {
      ...verifiedCandidate(tree),
      source_tree: otherTree,
    },
  }), assertBaseError);
  assert.throws(() => createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: { ...verifiedCandidate(tree), extra: true },
  }), assertBaseError);
});

test('rejects forged base objects that claim revision, save, or renderer authority', () => {
  const tree = sourceTree();
  const base = createBuilderDraftContinuationBase({
    admission: admission(tree),
    verified_candidate: verifiedCandidate(tree),
  });

  const revisionClaim = {
    ...base,
    authority: {
      ...base.authority,
      base_revision_semantics: 'project_revision',
    },
  };
  assert.throws(() => sanitizeBuilderDraftContinuationBase({
    ...revisionClaim,
    base_digest: baseDigest(revisionClaim),
  }), assertBaseError);

  const rendererClaim = {
    ...base,
    authority: {
      ...base.authority,
      renderer_authority: 'present',
    },
  };
  assert.throws(() => sanitizeBuilderDraftContinuationBase({
    ...rendererClaim,
    base_digest: baseDigest(rendererClaim),
  }), assertBaseError);

  assert.throws(() => sanitizeBuilderDraftContinuationBase({
    ...base,
    parent_candidate_commit_oid: PARENT_OID,
  }), assertBaseError);
  assert.throws(() => sanitizeBuilderDraftContinuationBase({
    ...base,
    extra: true,
  }), assertBaseError);
});

test('source remains a main-only base contract without provider, IPC, save, or revision authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-continuation-base.cjs'),
    'utf8',
  );
  assert.match(source, /pending_candidate_git_base/u);
  assert.match(source, /not_a_project_revision/u);
  assert.match(source, /verified_pending_candidate_commit/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|builder-provider|provider_secret|credential_value|secret_ref|child_process|execFile|spawn\s*\(|persist_candidate_commit|write_current|record_grant|record_revocation|saveDraft|record_project_revision|accept_candidate|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
