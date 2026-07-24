'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  CREATE_SCHEMA_SQL,
  METADATA_TABLES,
  BuilderProductMetadataSchemaError,
  sanitizeListCurrentProjectRevisionsRequest,
  sanitizeListProjectRevisionsRequest,
  sanitizeLoadCurrentRequest,
  sanitizeLoadProjectRevisionRequest,
  sanitizeRecordProjectRevisionRequest,
  sha256Canonical,
} = require('../electron/builder-product-metadata-schema.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function request({
  idempotencyIndex = 1,
  taskIndex = 1,
  runIndex = 2,
  reviewIndex = 3,
  reviewerIndex = 4,
  turnIndex = 5,
  requestIndex = 6,
  candidateIndex = 7,
  commit = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  parent = null,
  expected = null,
  candidateDigest = digest('c'),
  resultingTreeDigest = digest('d'),
  semanticIdentityDigest = digest('e'),
  title = 'Create the project',
  summary = 'A saved Builder project revision.',
  selectedAt = 5,
  baseCreatedAt = 1,
  overrides = {},
} = {}) {
  const taskId = `builder-task:${uuid(taskIndex)}`;
  const runId = `builder-run:${uuid(runIndex)}`;
  const turnId = `builder-turn:${uuid(turnIndex)}`;
  const requestId = `builder-git-request:${uuid(requestIndex)}`;
  const candidateId = `builder-code-change-candidate:${String(candidateIndex).padStart(64, '0')}`;
  const verification = {
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    request_id: requestId,
    candidate_id: candidateId,
    candidate_digest: candidateDigest,
    expected_base_oid: parent,
    commit_oid: commit,
    candidate_tree_oid: tree,
    resulting_tree_digest: resultingTreeDigest,
    semantic_identity_digest: semanticIdentityDigest,
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
  const verificationDigest = sha256Canonical(verification);
  const base = {
    idempotency: {
      idempotency_key: `builder-idempotency:${String(idempotencyIndex).padStart(64, '0')}`,
    },
    project: {
      project_id: PROJECT_ID,
      created_at_ms: baseCreatedAt,
    },
    conversation: {
      conversation_id: CONVERSATION_ID,
      project_id: PROJECT_ID,
      created_at_ms: baseCreatedAt,
    },
    task: {
      task_id: taskId,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      title,
      base_commit_oid: parent,
      created_at_ms: baseCreatedAt + 1,
    },
    run: {
      run_id: runId,
      project_id: PROJECT_ID,
      task_id: taskId,
      turn_id: turnId,
      request_id: requestId,
      candidate_id: candidateId,
      status: 'succeeded',
      result_kind: 'candidate',
      result_digest: candidateDigest,
      completed_at_ms: baseCreatedAt + 2,
    },
    review: {
      review_id: `builder-review:${uuid(reviewIndex)}`,
      project_id: PROJECT_ID,
      task_id: taskId,
      run_id: runId,
      subject_kind: 'git_candidate',
      subject_candidate_id: candidateId,
      subject_candidate_digest: candidateDigest,
      subject_verification_receipt_digest: verificationDigest,
      decision: 'accepted',
      reviewer_id: `builder-user:${uuid(reviewerIndex)}`,
      reviewed_at_ms: baseCreatedAt + 3,
    },
    git_candidate_verification_receipt: verification,
    git_candidate_receipt: {
      receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
      repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: turnId,
      task_id: taskId,
      run_id: runId,
      request_id: requestId,
      candidate_id: candidateId,
      candidate_digest: candidateDigest,
      resulting_tree_digest: resultingTreeDigest,
      semantic_identity_digest: semanticIdentityDigest,
      verification_receipt_digest: verificationDigest,
      object_format: 'sha1',
      commit_oid: commit,
      tree_oid: tree,
      parent_oid: parent,
      expected_base_oid: parent,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
    project_revision: {
      project_id: PROJECT_ID,
      title,
      summary,
      conversation_id: CONVERSATION_ID,
      turn_id: turnId,
      request_id: requestId,
      object_format: 'sha1',
      commit_oid: commit,
      tree_oid: tree,
      parent_oid: parent,
      candidate_id: candidateId,
      candidate_digest: candidateDigest,
      resulting_tree_digest: resultingTreeDigest,
      semantic_identity_digest: semanticIdentityDigest,
      verification_receipt_digest: verificationDigest,
      selected_at_ms: selectedAt,
    },
    expected_current_revision_receipt_digest: expected,
  };
  return { ...base, ...overrides };
}

function assertSchemaError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderProductMetadataSchemaError);
      assert.equal(error.code, 'builder_product_metadata_schema_invalid');
      assert.equal(error.message, 'Builder product metadata could not be verified.');
      assert.equal(error.stack, `${error.name}: ${error.message}`);
      return true;
    },
  );
}

test('defines the exact C0 product metadata schema surface', () => {
  assert.equal(BUILDER_PRODUCT_METADATA_SCHEMA_VERSION, 'builder-product-metadata-schema.v4');
  assert.equal(BUILDER_PRODUCT_METADATA_RESULT_VERSION, 'builder-product-metadata-result.v3');
  assert.equal(BUILDER_PRODUCT_METADATA_USER_VERSION, 4);
  assert.deepEqual(METADATA_TABLES, [
    'projects',
    'project_revisions',
    'conversations',
    'conversation_events',
    'conversation_candidate_results',
    'tasks',
    'runs',
    'reviews',
    'idempotency_records',
  ]);
  assert.equal(CREATE_SCHEMA_SQL.filter((sql) => /\bCREATE TABLE\b/u.test(sql)).length, 9);
  assert.ok(CREATE_SCHEMA_SQL.every((sql) => !/\bCREATE TABLE\b/u.test(sql) || /\bSTRICT\b/u.test(sql)));
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /FOREIGN KEY \(project_id, run_id\) REFERENCES runs/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /UNIQUE \(project_id, commit_oid\)/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /CREATE TABLE conversation_candidate_results/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /PRIMARY KEY \(draft_id\)/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /current_event_sequence/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /command_digest/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /previous_event_digest/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'), /record_json TEXT NOT NULL/u);
  assert.match(CREATE_SCHEMA_SQL.join('\n'),
    /UNIQUE \(project_id, conversation_id, command_id\)/u);
  assert.doesNotMatch(CREATE_SCHEMA_SQL.join('\n'),
    /conversation_events_conversation_sequence_idx/u);
  assert.doesNotMatch(CREATE_SCHEMA_SQL.join('\n'),
    /builder-product-metadata-schema\.v2/u);
  assert.doesNotMatch(CREATE_SCHEMA_SQL.join('\n'), /receipt_json|source_bytes|credential|ui_state|localStorage|provider_secret/iu);
});

test('sanitizes a Git-verifier-bound Project Revision receipt without proving Git objects exist', () => {
  const safe = sanitizeRecordProjectRevisionRequest(request());
  assert.equal(Object.isFrozen(safe), true);
  assert.equal(safe.git_candidate_verification_receipt.receipt_version,
    BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION);
  assert.deepEqual(Reflect.ownKeys(safe.git_candidate_verification_receipt), [
    'receipt_version',
    'repository_version',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'request_id',
    'candidate_id',
    'candidate_digest',
    'expected_base_oid',
    'commit_oid',
    'candidate_tree_oid',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'object_format',
    'commit_ref_admission',
    'request_ref_admission',
    'commit_object_admission',
    'verification_admission',
  ]);
  assert.deepEqual(Reflect.ownKeys(safe.git_candidate_receipt), [
    'receipt_version',
    'repository_version',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'request_id',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'verification_receipt_digest',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
    'expected_base_oid',
    'code_authority',
    'product_revision_admission',
    'replay',
  ]);
  assert.equal(safe.git_candidate_receipt.repository_version, BUILDER_GIT_PROJECT_REPOSITORY_VERSION);
  assert.equal(safe.git_candidate_receipt.receipt_version, BUILDER_GIT_CANDIDATE_RECEIPT_VERSION);
  assert.equal(safe.git_candidate_receipt.code_authority, 'git_commit_candidate');
  assert.equal(safe.git_candidate_receipt.replay, false);
  assert.equal(safe.receipt_input.project_id, PROJECT_ID);
  assert.equal(safe.receipt_input.title, 'Create the project');
  assert.equal(safe.receipt_input.summary, 'A saved Builder project revision.');
  assert.equal(safe.receipt_input.conversation_id, CONVERSATION_ID);
  assert.equal(safe.receipt_input.object_format, 'sha1');
  assert.equal(safe.receipt_input.commit_oid, 'a'.repeat(40));
  assert.equal(safe.receipt_input.tree_oid, 'b'.repeat(40));
  assert.equal(safe.receipt_input.parent_oid, null);
  assert.equal(safe.receipt_input.candidate_digest, digest('c'));
  assert.equal(safe.receipt_input.resulting_tree_digest, digest('d'));
  assert.equal(safe.receipt_input.semantic_identity_digest, digest('e'));
  assert.match(safe.receipt_input.verification_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(safe.semantic_hash, /^sha256:[0-9a-f]{64}$/u);
  const replayed = request();
  replayed.git_candidate_receipt.replay = true;
  const replaySafe = sanitizeRecordProjectRevisionRequest(replayed);
  assert.equal(replaySafe.git_candidate_receipt.replay, true);
  assert.equal(replaySafe.semantic_hash, safe.semantic_hash);
});

test('fails closed on malformed, proxy, rejected, and cross-boundary receipts', () => {
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    extra: true,
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(new Proxy(request(), {})));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    review: { ...request().review, decision: 'rejected' },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    run: { ...request().run, result_digest: digest('e') },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_verification_receipt: {
      ...request().git_candidate_verification_receipt,
      verification_admission: 'rejected',
    },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_verification_receipt: {
      ...request().git_candidate_verification_receipt,
      commit_ref_admission: 'accepted',
    },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_receipt: { ...request().git_candidate_receipt, repository_version: 'other' },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_receipt: { ...request().git_candidate_receipt, code_authority: 'not_committed' },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_receipt: { ...request().git_candidate_receipt, replay: 'false' },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_receipt: { ...request().git_candidate_receipt, expected_base_oid: '0'.repeat(40) },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_verification_receipt: {
      ...request().git_candidate_verification_receipt,
      resulting_tree_digest: digest('f'),
    },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    project_revision: {
      ...request().project_revision,
      resulting_tree_digest: digest('f'),
    },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    project_revision: {
      ...request().project_revision,
      semantic_identity_digest: digest('f'),
    },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_receipt: { ...request().git_candidate_receipt, product_revision_admission: 'recorded' },
  }));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    project_revision: { ...request().project_revision, object_format: 'sha256', commit_oid: 'a'.repeat(40) },
  }));
});

test('rejects nested proxy, accessor, symbol, resource drift, and forged verifier bindings', () => {
  let traps = 0;
  const proxy = new Proxy(request().git_candidate_verification_receipt, {
    ownKeys() {
      traps += 1;
      return [];
    },
  });
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest({
    ...request(),
    git_candidate_verification_receipt: proxy,
  }));
  assert.equal(traps, 0);

  const accessor = request();
  Object.defineProperty(accessor.review, 'subject_candidate_digest', {
    enumerable: true,
    get: () => { throw new Error('private-credential-marker'); },
  });
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(accessor));

  const withSymbol = request();
  withSymbol.git_candidate_receipt[Symbol('hidden')] = true;
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(withSymbol));

  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(request({
    overrides: {
      task: { ...request().task, title: 'x'.repeat(201) },
    },
  })));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(request({
    title: 'x'.repeat(81),
  })));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(request({
    summary: 'x'.repeat(401),
  })));
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(request({
    overrides: {
      task: { ...request().task, title: 'x'.repeat(10_000) },
    },
  })));

  const forged = request();
  forged.git_candidate_receipt.verification_receipt_digest = digest('f');
  forged.review.subject_verification_receipt_digest = digest('f');
  forged.project_revision.verification_receipt_digest = digest('f');
  assertSchemaError(() => sanitizeRecordProjectRevisionRequest(forged));
});

test('sanitizes exact current, exact revision, catalog, and history read requests', () => {
  assert.deepEqual(
    sanitizeLoadCurrentRequest({ project_id: PROJECT_ID }),
    { project_id: PROJECT_ID },
  );
  assert.deepEqual(
    sanitizeLoadProjectRevisionRequest({
      project_id: PROJECT_ID,
      revision_receipt_digest: digest('a'),
    }),
    { project_id: PROJECT_ID, revision_receipt_digest: digest('a') },
  );
  assert.deepEqual(
    sanitizeListCurrentProjectRevisionsRequest({ limit: 256 }),
    { limit: 256 },
  );
  assert.deepEqual(
    sanitizeListProjectRevisionsRequest({ project_id: PROJECT_ID, limit: 128 }),
    { project_id: PROJECT_ID, limit: 128 },
  );
  assertSchemaError(() => sanitizeLoadCurrentRequest({ project_id: PROJECT_ID, extra: true }));
  assertSchemaError(() => sanitizeLoadProjectRevisionRequest({ project_id: PROJECT_ID }));
  assertSchemaError(() => sanitizeListCurrentProjectRevisionsRequest({ limit: 0 }));
  assertSchemaError(() => sanitizeListCurrentProjectRevisionsRequest({ limit: 257 }));
  assertSchemaError(() => sanitizeListProjectRevisionsRequest({ project_id: PROJECT_ID, limit: 0 }));
  assertSchemaError(() => sanitizeListProjectRevisionsRequest({ project_id: PROJECT_ID, limit: 257 }));
  assertSchemaError(() => sanitizeListProjectRevisionsRequest({ project_id: PROJECT_ID }));
});

test('returns fresh fixed schema errors without leaking hostile markers', () => {
  const hostile = request();
  Object.defineProperty(hostile, 'project_revision', {
    enumerable: true,
    get: () => { throw new Error('private-credential-marker'); },
  });
  assert.throws(
    () => sanitizeRecordProjectRevisionRequest(hostile),
    (error) => {
      const text = JSON.stringify({
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
      assert.doesNotMatch(text, /private-credential-marker/u);
      assert.equal(error.code, 'builder_product_metadata_schema_invalid');
      return true;
    },
  );
});
