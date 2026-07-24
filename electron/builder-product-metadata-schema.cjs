'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BuilderGitReceiptContractError,
  canonicalJson,
  sha256Canonical,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');

const BUILDER_PRODUCT_METADATA_SCHEMA_VERSION = 'builder-product-metadata-schema.v4';
const BUILDER_PRODUCT_METADATA_USER_VERSION = 4;
const BUILDER_PRODUCT_METADATA_RESULT_VERSION = 'builder-product-metadata-result.v3';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_PATTERN}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_PATTERN}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_PATTERN}$`, 'u');
const REQUEST_ID_PATTERN = new RegExp(`^builder-git-request:${UUID_PATTERN}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_PATTERN}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_PATTERN}$`, 'u');
const REVIEW_ID_PATTERN = new RegExp(`^builder-review:${UUID_PATTERN}$`, 'u');
const IDEMPOTENCY_KEY_PATTERN = /^builder-idempotency:[0-9a-f]{64}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_PATTERN}$`, 'u');

const METADATA_TABLES = Object.freeze([
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

const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    project_created_at_ms INTEGER NOT NULL,
    current_revision_receipt_digest TEXT,
    current_revision_number INTEGER NOT NULL DEFAULT 0,
    metadata_schema_version TEXT NOT NULL,
    CHECK (metadata_schema_version = 'builder-product-metadata-schema.v4'),
    CHECK (project_created_at_ms >= 0),
    CHECK (current_revision_number >= 0),
    CHECK (
      (current_revision_receipt_digest IS NULL AND current_revision_number = 0)
      OR (current_revision_receipt_digest IS NOT NULL AND current_revision_number > 0)
    ),
    UNIQUE (project_id, current_revision_receipt_digest),
    FOREIGN KEY (project_id, current_revision_receipt_digest)
      REFERENCES project_revisions(project_id, revision_receipt_digest)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE conversations (
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    current_event_sequence INTEGER,
    current_event_id TEXT,
    current_event_digest TEXT,
    PRIMARY KEY (project_id, conversation_id),
    UNIQUE (conversation_id),
    CHECK (created_at_ms >= 0),
    CHECK (current_event_sequence IS NULL OR current_event_sequence BETWEEN 1 AND 1024),
    CHECK (
      (current_event_sequence IS NULL AND current_event_id IS NULL AND current_event_digest IS NULL)
      OR (current_event_sequence IS NOT NULL AND current_event_id IS NOT NULL
        AND current_event_digest IS NOT NULL)
    ),
    UNIQUE (project_id, conversation_id, current_event_sequence),
    FOREIGN KEY (project_id, conversation_id, current_event_sequence)
      REFERENCES conversation_events(project_id, conversation_id, sequence)
      ON DELETE RESTRICT ON UPDATE RESTRICT
      DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE conversation_events (
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    event_digest TEXT NOT NULL,
    command_id TEXT NOT NULL,
    command_digest TEXT NOT NULL,
    event_type TEXT NOT NULL,
    previous_event_sequence INTEGER,
    previous_event_id TEXT,
    previous_event_digest TEXT,
    record_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, conversation_id, sequence),
    UNIQUE (project_id, conversation_id, event_id),
    UNIQUE (project_id, conversation_id, event_digest),
    UNIQUE (project_id, conversation_id, command_id),
    CHECK (sequence BETWEEN 1 AND 1024),
    CHECK (created_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 24576),
    CHECK (
      (sequence = 1 AND previous_event_sequence IS NULL
        AND previous_event_id IS NULL AND previous_event_digest IS NULL)
      OR (sequence > 1 AND previous_event_sequence = sequence - 1
        AND previous_event_id IS NOT NULL AND previous_event_digest IS NOT NULL)
    ),
    FOREIGN KEY (project_id, conversation_id, previous_event_sequence)
      REFERENCES conversation_events(project_id, conversation_id, sequence)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, conversation_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE conversation_candidate_results (
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    candidate_digest TEXT NOT NULL,
    PRIMARY KEY (draft_id),
    UNIQUE (project_id, conversation_id, sequence),
    CHECK (sequence BETWEEN 1 AND 1024),
    CHECK (length(draft_id) = 89),
    CHECK (length(candidate_digest) = 71),
    FOREIGN KEY (project_id, conversation_id, sequence)
      REFERENCES conversation_events(project_id, conversation_id, sequence)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, conversation_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE tasks (
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    base_commit_oid TEXT,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, task_id),
    CHECK (length(title) BETWEEN 1 AND 200),
    CHECK (created_at_ms >= 0),
    FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, conversation_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE runs (
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    status TEXT NOT NULL,
    result_kind TEXT NOT NULL,
    result_digest TEXT NOT NULL,
    completed_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, run_id),
    CHECK (status IN ('succeeded', 'failed', 'cancelled', 'interrupted')),
    CHECK (result_kind IN ('candidate', 'explanation', 'plan', 'failure')),
    CHECK (completed_at_ms >= 0),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, task_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE reviews (
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL,
    subject_candidate_id TEXT NOT NULL,
    subject_candidate_digest TEXT NOT NULL,
    subject_verification_receipt_digest TEXT NOT NULL,
    decision TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    reviewed_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, review_id),
    CHECK (subject_kind = 'git_candidate'),
    CHECK (decision IN ('accepted', 'rejected')),
    CHECK (reviewed_at_ms >= 0),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, task_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE project_revisions (
    project_id TEXT NOT NULL,
    revision_receipt_digest TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    previous_revision_receipt_digest TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    object_format TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    tree_oid TEXT NOT NULL,
    parent_oid TEXT,
    candidate_id TEXT NOT NULL,
    candidate_digest TEXT NOT NULL,
    resulting_tree_digest TEXT NOT NULL,
    semantic_identity_digest TEXT NOT NULL,
    verification_receipt_digest TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    selected_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, revision_receipt_digest),
    UNIQUE (project_id, revision_number),
    UNIQUE (project_id, commit_oid),
    CHECK (revision_number >= 1),
    CHECK (length(title) BETWEEN 1 AND 80),
    CHECK (length(summary) BETWEEN 1 AND 400),
    CHECK (object_format = 'sha1'),
    CHECK (selected_at_ms >= 0),
    FOREIGN KEY (project_id, previous_revision_receipt_digest)
      REFERENCES project_revisions(project_id, revision_receipt_digest)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, conversation_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, task_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, run_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (project_id, review_id) REFERENCES reviews(project_id, review_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE idempotency_records (
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    semantic_hash TEXT NOT NULL,
    result_project_id TEXT NOT NULL,
    result_digest TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, idempotency_key),
    CHECK (operation = 'record_project_revision_receipt'),
    CHECK (created_at_ms >= 0),
    CHECK (project_id = result_project_id),
    FOREIGN KEY (result_project_id, result_digest)
      REFERENCES project_revisions(project_id, revision_receipt_digest)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX project_revisions_project_selected_idx ON project_revisions(project_id, selected_at_ms)',
  'CREATE INDEX conversation_candidate_results_project_idx ON conversation_candidate_results(project_id, conversation_id)',
  'CREATE INDEX tasks_conversation_idx ON tasks(project_id, conversation_id)',
  'CREATE INDEX runs_task_idx ON runs(project_id, task_id)',
  'CREATE INDEX reviews_run_idx ON reviews(project_id, run_id)',
]);

class BuilderProductMetadataSchemaError extends Error {
  constructor() {
    super('Builder product metadata could not be verified.');
    this.name = 'BuilderProductMetadataSchemaError';
    this.code = 'builder_product_metadata_schema_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProductMetadataSchemaError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) fail();
  return value;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum * 2
    || value.trim() !== value
    || value.length > maximum
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeProjectId(value) { return safePattern(value, PROJECT_ID_PATTERN, 64); }
function safeConversationId(value) { return safePattern(value, CONVERSATION_ID_PATTERN, 96); }
function safeTurnId(value) { return safePattern(value, TURN_ID_PATTERN, 80); }
function safeRequestId(value) { return safePattern(value, REQUEST_ID_PATTERN, 87); }
function safeCandidateId(value) { return safePattern(value, CANDIDATE_ID_PATTERN, 94); }
function safeTaskId(value) { return safePattern(value, TASK_ID_PATTERN, 88); }
function safeRunId(value) { return safePattern(value, RUN_ID_PATTERN, 88); }
function safeReviewId(value) { return safePattern(value, REVIEW_ID_PATTERN, 91); }
function safeDigest(value) { return safePattern(value, DIGEST_PATTERN, 71); }
function safeIdempotencyKey(value) { return safePattern(value, IDEMPOTENCY_KEY_PATTERN, 84); }
function safeActorId(value) { return safePattern(value, ACTOR_ID_PATTERN, 96); }
function safeDraftId(value) { return safePattern(value, DRAFT_ID_PATTERN, 89); }

function safeGitOid(value, objectFormat, nullable = false) {
  if (nullable && value === null) return null;
  if (objectFormat !== 'sha1') fail();
  return safePattern(value, GIT_SHA1_PATTERN, 40);
}

function sanitizeProject(value) {
  exactObject(value, ['project_id', 'created_at_ms']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    created_at_ms: safeInteger(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeConversation(value) {
  exactObject(value, ['conversation_id', 'project_id', 'created_at_ms']);
  return freezeDeep({
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    created_at_ms: safeInteger(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeTask(value) {
  exactObject(value, ['task_id', 'project_id', 'conversation_id', 'title', 'base_commit_oid', 'created_at_ms']);
  return freezeDeep({
    task_id: safeTaskId(valueAt(value, 'task_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    title: safeText(valueAt(value, 'title'), 200),
    base_commit_oid: valueAt(value, 'base_commit_oid'),
    created_at_ms: safeInteger(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeRun(value) {
  exactObject(value, [
    'run_id',
    'project_id',
    'task_id',
    'turn_id',
    'request_id',
    'candidate_id',
    'status',
    'result_kind',
    'result_digest',
    'completed_at_ms',
  ]);
  const status = valueAt(value, 'status');
  const resultKind = valueAt(value, 'result_kind');
  if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status)
    || !['candidate', 'explanation', 'plan', 'failure'].includes(resultKind)) fail();
  return freezeDeep({
    run_id: safeRunId(valueAt(value, 'run_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    turn_id: safeTurnId(valueAt(value, 'turn_id')),
    request_id: safeRequestId(valueAt(value, 'request_id')),
    candidate_id: safeCandidateId(valueAt(value, 'candidate_id')),
    status,
    result_kind: resultKind,
    result_digest: safeDigest(valueAt(value, 'result_digest')),
    completed_at_ms: safeInteger(valueAt(value, 'completed_at_ms')),
  });
}

function sanitizeReview(value) {
  exactObject(value, [
    'review_id',
    'project_id',
    'task_id',
    'run_id',
    'subject_kind',
    'subject_candidate_id',
    'subject_candidate_digest',
    'subject_verification_receipt_digest',
    'decision',
    'reviewer_id',
    'reviewed_at_ms',
  ]);
  const subjectKind = valueAt(value, 'subject_kind');
  const decision = valueAt(value, 'decision');
  if (subjectKind !== 'git_candidate' || !['accepted', 'rejected'].includes(decision)) fail();
  return freezeDeep({
    review_id: safeReviewId(valueAt(value, 'review_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    subject_kind: subjectKind,
    subject_candidate_id: safeCandidateId(valueAt(value, 'subject_candidate_id')),
    subject_candidate_digest: safeDigest(valueAt(value, 'subject_candidate_digest')),
    subject_verification_receipt_digest: safeDigest(valueAt(value, 'subject_verification_receipt_digest')),
    decision,
    reviewer_id: safeActorId(valueAt(value, 'reviewer_id')),
    reviewed_at_ms: safeInteger(valueAt(value, 'reviewed_at_ms')),
  });
}

function sanitizeProjectRevisionInput(value) {
  exactObject(value, [
    'project_id',
    'title',
    'summary',
    'conversation_id',
    'turn_id',
    'request_id',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'verification_receipt_digest',
    'selected_at_ms',
  ]);
  const objectFormat = valueAt(value, 'object_format');
  if (objectFormat !== 'sha1') fail();
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    title: safeText(valueAt(value, 'title'), 80),
    summary: safeText(valueAt(value, 'summary'), 400),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    turn_id: safeTurnId(valueAt(value, 'turn_id')),
    request_id: safeRequestId(valueAt(value, 'request_id')),
    object_format: objectFormat,
    commit_oid: safeGitOid(valueAt(value, 'commit_oid'), objectFormat),
    tree_oid: safeGitOid(valueAt(value, 'tree_oid'), objectFormat),
    parent_oid: safeGitOid(valueAt(value, 'parent_oid'), objectFormat, true),
    candidate_id: safeCandidateId(valueAt(value, 'candidate_id')),
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    resulting_tree_digest: safeDigest(valueAt(value, 'resulting_tree_digest')),
    semantic_identity_digest: safeDigest(valueAt(value, 'semantic_identity_digest')),
    verification_receipt_digest: safeDigest(valueAt(value, 'verification_receipt_digest')),
    selected_at_ms: safeInteger(valueAt(value, 'selected_at_ms')),
  });
}

function sanitizeIdempotency(value) {
  exactObject(value, ['idempotency_key']);
  return freezeDeep({
    idempotency_key: safeIdempotencyKey(valueAt(value, 'idempotency_key')),
  });
}

function sanitizeExpectedCurrent(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function assertRequestBindings(request) {
  const projectId = request.project.project_id;
  const verification = request.git_candidate_verification_receipt;
  const gitReceipt = request.git_candidate_receipt;
  if (
    request.conversation.project_id !== projectId
    || request.task.project_id !== projectId
    || request.task.conversation_id !== request.conversation.conversation_id
    || request.run.project_id !== projectId
    || request.run.task_id !== request.task.task_id
    || request.review.project_id !== projectId
    || request.review.task_id !== request.task.task_id
    || request.review.run_id !== request.run.run_id
    || request.revision.project_id !== projectId
    || verification.project_id !== projectId
    || gitReceipt.project_id !== projectId
    || verification.conversation_id !== request.conversation.conversation_id
    || gitReceipt.conversation_id !== request.conversation.conversation_id
    || verification.task_id !== request.task.task_id
    || gitReceipt.task_id !== request.task.task_id
    || verification.run_id !== request.run.run_id
    || gitReceipt.run_id !== request.run.run_id
    || verification.turn_id !== request.run.turn_id
    || gitReceipt.turn_id !== request.run.turn_id
    || verification.request_id !== request.run.request_id
    || gitReceipt.request_id !== request.run.request_id
    || verification.candidate_id !== request.run.candidate_id
    || gitReceipt.candidate_id !== request.run.candidate_id
    || request.run.status !== 'succeeded'
    || request.run.result_kind !== 'candidate'
    || request.run.result_digest !== verification.candidate_digest
    || gitReceipt.candidate_digest !== verification.candidate_digest
    || request.review.decision !== 'accepted'
    || request.review.subject_kind !== 'git_candidate'
    || request.review.subject_candidate_id !== verification.candidate_id
    || request.review.subject_candidate_digest !== verification.candidate_digest
    || request.review.subject_verification_receipt_digest !== gitReceipt.verification_receipt_digest
    || request.revision.candidate_id !== verification.candidate_id
    || request.revision.candidate_digest !== verification.candidate_digest
    || request.revision.conversation_id !== request.conversation.conversation_id
    || request.revision.turn_id !== request.run.turn_id
    || request.revision.request_id !== request.run.request_id
    || request.revision.resulting_tree_digest !== gitReceipt.resulting_tree_digest
    || request.revision.semantic_identity_digest !== gitReceipt.semantic_identity_digest
    || request.revision.verification_receipt_digest !== gitReceipt.verification_receipt_digest
    || request.revision.object_format !== gitReceipt.object_format
    || request.revision.commit_oid !== gitReceipt.commit_oid
    || request.revision.tree_oid !== gitReceipt.tree_oid
    || request.revision.parent_oid !== gitReceipt.parent_oid
    || verification.repository_version !== gitReceipt.repository_version
    || verification.object_format !== gitReceipt.object_format
    || verification.expected_base_oid !== gitReceipt.expected_base_oid
    || verification.candidate_tree_oid !== gitReceipt.tree_oid
    || verification.resulting_tree_digest !== gitReceipt.resulting_tree_digest
    || verification.semantic_identity_digest !== gitReceipt.semantic_identity_digest
  ) fail();
  const expectedBaseOid = safeGitOid(verification.expected_base_oid, gitReceipt.object_format, true);
  const candidateTreeOid = safeGitOid(verification.candidate_tree_oid, gitReceipt.object_format);
  if (expectedBaseOid !== gitReceipt.parent_oid) fail();
  if (gitReceipt.parent_oid !== gitReceipt.expected_base_oid) fail();
  if (candidateTreeOid !== gitReceipt.tree_oid) fail();
  if (request.expected_current_revision_receipt_digest === null) {
    if (
      request.task.base_commit_oid !== null
      || request.revision.parent_oid !== null
      || verification.expected_base_oid !== null
    ) fail();
  }
  if (request.task.base_commit_oid !== request.revision.parent_oid) fail();
}

function candidateSemanticProjection(receipt) {
  return freezeDeep({
    receipt_version: receipt.receipt_version,
    repository_version: receipt.repository_version,
    project_id: receipt.project_id,
    conversation_id: receipt.conversation_id,
    turn_id: receipt.turn_id,
    task_id: receipt.task_id,
    run_id: receipt.run_id,
    request_id: receipt.request_id,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    resulting_tree_digest: receipt.resulting_tree_digest,
    semantic_identity_digest: receipt.semantic_identity_digest,
    verification_receipt_digest: receipt.verification_receipt_digest,
    object_format: receipt.object_format,
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
    parent_oid: receipt.parent_oid,
    expected_base_oid: receipt.expected_base_oid,
    code_authority: receipt.code_authority,
    product_revision_admission: receipt.product_revision_admission,
  });
}

function createRevisionReceipt(value) {
  exactObject(value, [
    'project_id',
    'revision_number',
    'previous_revision_receipt_digest',
    'title',
    'summary',
    'conversation_id',
    'turn_id',
    'request_id',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'verification_receipt_digest',
    'task_id',
    'run_id',
    'review_id',
    'selected_at_ms',
  ]);
  const objectFormat = valueAt(value, 'object_format');
  if (objectFormat !== 'sha1') fail();
  const body = freezeDeep({
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    candidate_id: safeCandidateId(valueAt(value, 'candidate_id')),
    commit_oid: safeGitOid(valueAt(value, 'commit_oid'), objectFormat),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    object_format: objectFormat,
    parent_oid: safeGitOid(valueAt(value, 'parent_oid'), objectFormat, true),
    previous_revision_receipt_digest: safeNullableDigest(valueAt(value, 'previous_revision_receipt_digest')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    request_id: safeRequestId(valueAt(value, 'request_id')),
    resulting_tree_digest: safeDigest(valueAt(value, 'resulting_tree_digest')),
    review_id: safeReviewId(valueAt(value, 'review_id')),
    revision_number: safeInteger(valueAt(value, 'revision_number')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    selected_at_ms: safeInteger(valueAt(value, 'selected_at_ms')),
    semantic_identity_digest: safeDigest(valueAt(value, 'semantic_identity_digest')),
    summary: safeText(valueAt(value, 'summary'), 400),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    title: safeText(valueAt(value, 'title'), 80),
    tree_oid: safeGitOid(valueAt(value, 'tree_oid'), objectFormat),
    turn_id: safeTurnId(valueAt(value, 'turn_id')),
    verification_receipt_digest: safeDigest(valueAt(value, 'verification_receipt_digest')),
  });
  if (body.revision_number < 1) fail();
  if ((body.revision_number === 1) !== (body.previous_revision_receipt_digest === null)) fail();
  return freezeDeep({ ...body, revision_receipt_digest: sha256Canonical(body) });
}

function sanitizeRecordProjectRevisionRequest(value) {
  exactObject(value, [
    'idempotency',
    'project',
    'conversation',
    'task',
    'run',
    'review',
    'git_candidate_verification_receipt',
    'git_candidate_receipt',
    'project_revision',
    'expected_current_revision_receipt_digest',
  ]);
  const gitReceiptPair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'git_candidate_receipt'),
    valueAt(value, 'git_candidate_verification_receipt'),
  );
  const request = {
    idempotency: sanitizeIdempotency(valueAt(value, 'idempotency')),
    project: sanitizeProject(valueAt(value, 'project')),
    conversation: sanitizeConversation(valueAt(value, 'conversation')),
    task: sanitizeTask(valueAt(value, 'task')),
    run: sanitizeRun(valueAt(value, 'run')),
    review: sanitizeReview(valueAt(value, 'review')),
    git_candidate_verification_receipt: gitReceiptPair.verification_receipt,
    git_candidate_receipt: gitReceiptPair.candidate_receipt,
    revision: sanitizeProjectRevisionInput(valueAt(value, 'project_revision')),
    expected_current_revision_receipt_digest: sanitizeExpectedCurrent(
      valueAt(value, 'expected_current_revision_receipt_digest'),
    ),
  };
  const baseCommitOid = safeGitOid(
    request.task.base_commit_oid,
    request.revision.object_format,
    true,
  );
  if (baseCommitOid !== request.task.base_commit_oid) fail();
  assertRequestBindings(request);
  return freezeDeep({
    ...request,
    receipt_input: {
      candidate_digest: request.revision.candidate_digest,
      candidate_id: request.revision.candidate_id,
      commit_oid: request.revision.commit_oid,
      conversation_id: request.revision.conversation_id,
      object_format: request.revision.object_format,
      parent_oid: request.revision.parent_oid,
      project_id: request.revision.project_id,
      request_id: request.revision.request_id,
      resulting_tree_digest: request.revision.resulting_tree_digest,
      review_id: request.review.review_id,
      run_id: request.run.run_id,
      selected_at_ms: request.revision.selected_at_ms,
      semantic_identity_digest: request.revision.semantic_identity_digest,
      summary: request.revision.summary,
      task_id: request.task.task_id,
      title: request.revision.title,
      tree_oid: request.revision.tree_oid,
      turn_id: request.revision.turn_id,
      verification_receipt_digest: request.revision.verification_receipt_digest,
    },
    semantic_hash: sha256Canonical({
      conversation: request.conversation,
      expected_current_revision_receipt_digest: request.expected_current_revision_receipt_digest,
      git_candidate_receipt: candidateSemanticProjection(request.git_candidate_receipt),
      git_candidate_verification_receipt: request.git_candidate_verification_receipt,
      project: request.project,
      project_revision: request.revision,
      review: request.review,
      run: request.run,
      task: request.task,
    }),
  });
}

function sanitizeLoadCurrentRequest(value) {
  exactObject(value, ['project_id']);
  return freezeDeep({ project_id: safeProjectId(valueAt(value, 'project_id')) });
}

function sanitizeLoadProjectRevisionRequest(value) {
  exactObject(value, ['project_id', 'revision_receipt_digest']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
  });
}

function sanitizeListCurrentProjectRevisionsRequest(value) {
  exactObject(value, ['limit']);
  return freezeDeep({ limit: safeLimit(valueAt(value, 'limit')) });
}

function sanitizeLoadConversationCandidateByDraftRequest(value) {
  exactObject(value, ['draft_id']);
  return freezeDeep({ draft_id: safeDraftId(valueAt(value, 'draft_id')) });
}

function sanitizeReceiptRow(value) {
  exactObject(value, [
    'project_id',
    'revision_receipt_digest',
    'revision_number',
    'previous_revision_receipt_digest',
    'title',
    'summary',
    'conversation_id',
    'turn_id',
    'request_id',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'verification_receipt_digest',
    'task_id',
    'run_id',
    'review_id',
    'selected_at_ms',
  ]);
  const receipt = createRevisionReceipt({
    candidate_digest: valueAt(value, 'candidate_digest'),
    candidate_id: valueAt(value, 'candidate_id'),
    commit_oid: valueAt(value, 'commit_oid'),
    conversation_id: valueAt(value, 'conversation_id'),
    object_format: valueAt(value, 'object_format'),
    parent_oid: valueAt(value, 'parent_oid'),
    previous_revision_receipt_digest: valueAt(value, 'previous_revision_receipt_digest'),
    project_id: valueAt(value, 'project_id'),
    request_id: valueAt(value, 'request_id'),
    resulting_tree_digest: valueAt(value, 'resulting_tree_digest'),
    review_id: valueAt(value, 'review_id'),
    revision_number: valueAt(value, 'revision_number'),
    run_id: valueAt(value, 'run_id'),
    selected_at_ms: valueAt(value, 'selected_at_ms'),
    semantic_identity_digest: valueAt(value, 'semantic_identity_digest'),
    summary: valueAt(value, 'summary'),
    task_id: valueAt(value, 'task_id'),
    title: valueAt(value, 'title'),
    tree_oid: valueAt(value, 'tree_oid'),
    turn_id: valueAt(value, 'turn_id'),
    verification_receipt_digest: valueAt(value, 'verification_receipt_digest'),
  });
  if (safeDigest(valueAt(value, 'revision_receipt_digest')) !== receipt.revision_receipt_digest) fail();
  return receipt;
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderProductMetadataSchemaError) throw error;
      if (error instanceof BuilderGitReceiptContractError) fail();
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION: BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  METADATA_TABLES,
  CREATE_SCHEMA_SQL,
  BuilderProductMetadataSchemaError,
  canonicalJson: safeBoundary(canonicalJson),
  createRevisionReceipt: safeBoundary(createRevisionReceipt),
  sha256Canonical: safeBoundary(sha256Canonical),
  sanitizeLoadCurrentRequest: safeBoundary(sanitizeLoadCurrentRequest),
  sanitizeLoadProjectRevisionRequest: safeBoundary(sanitizeLoadProjectRevisionRequest),
  sanitizeListCurrentProjectRevisionsRequest: safeBoundary(sanitizeListCurrentProjectRevisionsRequest),
  sanitizeLoadConversationCandidateByDraftRequest:
    safeBoundary(sanitizeLoadConversationCandidateByDraftRequest),
  sanitizeReceiptRow: safeBoundary(sanitizeReceiptRow),
  sanitizeRecordProjectRevisionRequest: safeBoundary(sanitizeRecordProjectRevisionRequest),
});
