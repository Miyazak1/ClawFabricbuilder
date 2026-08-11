'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');

const BUILDER_DRAFT_CHECKPOINT_VERSION = 'builder-draft-checkpoint.v1';
const DRAFT_CHECKPOINT_KIND = 'local_draft_checkpoint';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const INPUT_KEYS = Object.freeze([
  'candidate_receipt',
  'candidate_verification',
  'session_id',
  'task_address_id',
  'checkpoint_sequence',
  'base_revision_ref',
  'created_at_ms',
  'summary',
  'source_scope',
  'verification_summary',
]);
const BASE_REVISION_REF_KEYS = Object.freeze([
  'revision_receipt_digest',
  'commit_oid',
]);
const SOURCE_SCOPE_KEYS = Object.freeze([
  'scope_kind',
  'changed_file_count',
  'resulting_tree_digest',
]);
const VERIFICATION_SUMMARY_KEYS = Object.freeze([
  'status',
  'summary',
  'edit_attempt_ref',
]);
const EDIT_ATTEMPT_REF_KEYS = Object.freeze([
  'edit_attempt_id',
  'edit_attempt_digest',
  'status',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);
const CHECKPOINT_KEYS = Object.freeze([
  'checkpoint_version',
  'checkpoint_kind',
  'checkpoint_id',
  'project_id',
  'session_id',
  'task_address_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'request_id',
  'checkpoint_sequence',
  'candidate_ref',
  'base_revision_ref',
  'source_scope',
  'verification_summary',
  'created_at_ms',
  'summary',
  'checkpoint_state',
  'restore_eligibility',
  'lifecycle',
]);
const CANDIDATE_REF_KEYS = Object.freeze([
  'ref_kind',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'semantic_identity_digest',
  'verification_receipt_digest',
  'object_format',
  'commit_oid',
  'tree_oid',
  'parent_oid',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'checkpoint_authority',
  'candidate_authority',
  'sqlite_read',
  'sqlite_write',
  'git_read',
  'git_write',
  'renderer_authority',
  'provider_dispatch',
  'source_mutation',
  'revision_admission',
  'save_admission',
  'permission_grant',
  'publication',
  'autonomous_experiment',
  'retention_cleanup',
]);
const LIFECYCLE = Object.freeze({
  checkpoint_authority: 'main_draft_checkpoint_contract_v1',
  candidate_authority: 'verified_git_candidate_receipt_pair',
  sqlite_read: 'provided_by_caller',
  sqlite_write: 'not_performed',
  git_read: 'provided_by_caller_verified_candidate',
  git_write: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
  permission_grant: 'not_performed',
  publication: 'not_performed',
  autonomous_experiment: 'not_performed',
  retention_cleanup: 'not_performed',
});
const ERROR_MESSAGE = 'Builder draft checkpoint could not be verified.';

class BuilderDraftCheckpointError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderDraftCheckpointError';
    this.code = 'builder_draft_checkpoint_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDraftCheckpointError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function checkpointIdFor(body) {
  return `builder-draft-checkpoint:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeSessionId(value) {
  return safePattern(value, SESSION_ID_PATTERN, 96);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN, 96);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeNullableOid(value) {
  if (value === null) return null;
  return safePattern(value, OID_PATTERN, 40);
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
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
    || value.length > maximum
    || value.trim() !== value
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function safeFileCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 50_000) fail();
  return value;
}

function sanitizeBaseRevisionRef(value, expectedBaseOid) {
  const descriptors = exactObject(value, BASE_REVISION_REF_KEYS);
  const revisionReceiptDigest = safeNullableDigest(descriptors.revision_receipt_digest.value);
  const commitOid = safeNullableOid(descriptors.commit_oid.value);
  if (
    (revisionReceiptDigest === null) !== (commitOid === null)
    || commitOid !== expectedBaseOid
  ) fail();
  return freezeDeep({
    revision_receipt_digest: revisionReceiptDigest,
    commit_oid: commitOid,
  });
}

function sanitizeSourceScope(value, resultingTreeDigest) {
  const descriptors = exactObject(value, SOURCE_SCOPE_KEYS);
  if (descriptors.scope_kind.value !== 'project_candidate') fail();
  const sourceTreeDigest = safeDigest(descriptors.resulting_tree_digest.value);
  if (sourceTreeDigest !== resultingTreeDigest) fail();
  return freezeDeep({
    scope_kind: 'project_candidate',
    changed_file_count: safeFileCount(descriptors.changed_file_count.value),
    resulting_tree_digest: sourceTreeDigest,
  });
}

function sanitizeEditAttemptRef(value, expectedCandidate) {
  const descriptors = exactObject(value, EDIT_ATTEMPT_REF_KEYS);
  const editAttemptId = safePattern(
    descriptors.edit_attempt_id.value,
    /^builder-edit-attempt:[0-9a-f]{64}$/u,
    85,
  );
  const editAttemptDigest = safeDigest(descriptors.edit_attempt_digest.value);
  const candidateId = safePattern(
    descriptors.candidate_id.value,
    /^builder-code-change-candidate:[0-9a-f]{64}$/u,
    94,
  );
  const candidateDigest = safeDigest(descriptors.candidate_digest.value);
  const resultingTreeDigest = safeDigest(descriptors.resulting_tree_digest.value);
  if (
    descriptors.status.value !== 'succeeded'
    || editAttemptId !== `builder-edit-attempt:${editAttemptDigest.slice('sha256:'.length)}`
    || candidateId !== expectedCandidate.candidate_id
    || candidateDigest !== expectedCandidate.candidate_digest
    || resultingTreeDigest !== expectedCandidate.resulting_tree_digest
  ) fail();
  return freezeDeep({
    edit_attempt_id: editAttemptId,
    edit_attempt_digest: editAttemptDigest,
    status: 'succeeded',
    candidate_id: candidateId,
    candidate_digest: candidateDigest,
    resulting_tree_digest: resultingTreeDigest,
  });
}

function sanitizeVerificationSummary(value, expectedCandidate) {
  const descriptors = exactObject(value, VERIFICATION_SUMMARY_KEYS);
  const status = descriptors.status.value;
  if (!['candidate_verified', 'candidate_verified_with_warnings'].includes(status)) fail();
  return freezeDeep({
    status,
    summary: safeText(descriptors.summary.value, 400),
    edit_attempt_ref: sanitizeEditAttemptRef(
      descriptors.edit_attempt_ref.value,
      expectedCandidate,
    ),
  });
}

function sanitizeLifecycle(value) {
  const descriptors = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (descriptors[key].value !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function checkpointBody(value) {
  return freezeDeep({
    project_id: value.project_id,
    session_id: value.session_id,
    task_address_id: value.task_address_id,
    conversation_id: value.conversation_id,
    turn_id: value.turn_id,
    task_id: value.task_id,
    run_id: value.run_id,
    request_id: value.request_id,
    checkpoint_sequence: value.checkpoint_sequence,
    candidate_ref: value.candidate_ref,
    base_revision_ref: value.base_revision_ref,
    source_scope: value.source_scope,
    verification_summary: value.verification_summary,
    created_at_ms: value.created_at_ms,
    summary: value.summary,
    checkpoint_state: value.checkpoint_state,
    restore_eligibility: value.restore_eligibility,
    lifecycle: value.lifecycle,
  });
}

function createBuilderDraftCheckpoint(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const pair = sanitizeBuilderGitCandidateReceiptPair(
      descriptors.candidate_receipt.value,
      descriptors.candidate_verification.value,
    );
    const receipt = pair.candidate_receipt;
    const candidateRef = freezeDeep({
      ref_kind: 'git_candidate_commit',
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
      semantic_identity_digest: receipt.semantic_identity_digest,
      verification_receipt_digest: receipt.verification_receipt_digest,
      object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
      commit_oid: receipt.commit_oid,
      tree_oid: receipt.tree_oid,
      parent_oid: receipt.parent_oid,
    });
    const body = checkpointBody({
      project_id: receipt.project_id,
      session_id: safeSessionId(descriptors.session_id.value),
      task_address_id: safeTaskAddressId(descriptors.task_address_id.value),
      conversation_id: receipt.conversation_id,
      turn_id: receipt.turn_id,
      task_id: receipt.task_id,
      run_id: receipt.run_id,
      request_id: receipt.request_id,
      checkpoint_sequence: safeSequence(descriptors.checkpoint_sequence.value),
      candidate_ref: candidateRef,
      base_revision_ref: sanitizeBaseRevisionRef(descriptors.base_revision_ref.value, receipt.expected_base_oid),
      source_scope: sanitizeSourceScope(descriptors.source_scope.value, receipt.resulting_tree_digest),
      verification_summary: sanitizeVerificationSummary(
        descriptors.verification_summary.value,
        receipt,
      ),
      created_at_ms: safeTimestamp(descriptors.created_at_ms.value),
      summary: safeText(descriptors.summary.value, 400),
      checkpoint_state: 'active',
      restore_eligibility: 'candidate_ref_verified',
      lifecycle: { ...LIFECYCLE },
    });
    return freezeDeep({
      checkpoint_version: BUILDER_DRAFT_CHECKPOINT_VERSION,
      checkpoint_kind: DRAFT_CHECKPOINT_KIND,
      checkpoint_id: checkpointIdFor(body),
      ...body,
    });
  } catch (error) {
    if (error instanceof BuilderDraftCheckpointError) throw error;
    fail();
  }
}

function sanitizeCandidateRef(value) {
  const descriptors = exactObject(value, CANDIDATE_REF_KEYS);
  if (
    descriptors.ref_kind.value !== 'git_candidate_commit'
    || descriptors.object_format.value !== BUILDER_GIT_RECEIPT_OBJECT_FORMAT
  ) fail();
  return freezeDeep({
    ref_kind: 'git_candidate_commit',
    candidate_id: safePattern(descriptors.candidate_id.value, /^builder-code-change-candidate:[0-9a-f]{64}$/u, 94),
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
    semantic_identity_digest: safeDigest(descriptors.semantic_identity_digest.value),
    verification_receipt_digest: safeDigest(descriptors.verification_receipt_digest.value),
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: safePattern(descriptors.commit_oid.value, OID_PATTERN, 40),
    tree_oid: safePattern(descriptors.tree_oid.value, OID_PATTERN, 40),
    parent_oid: safeNullableOid(descriptors.parent_oid.value),
  });
}

function sanitizeBuilderDraftCheckpoint(value) {
  try {
    const descriptors = exactObject(value, CHECKPOINT_KEYS);
    if (
      descriptors.checkpoint_version.value !== BUILDER_DRAFT_CHECKPOINT_VERSION
      || descriptors.checkpoint_kind.value !== DRAFT_CHECKPOINT_KIND
      || descriptors.checkpoint_state.value !== 'active'
      || descriptors.restore_eligibility.value !== 'candidate_ref_verified'
    ) fail();
    const candidateRef = sanitizeCandidateRef(descriptors.candidate_ref.value);
    const body = checkpointBody({
      project_id: safePattern(
        descriptors.project_id.value,
        new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
        64,
      ),
      session_id: safeSessionId(descriptors.session_id.value),
      task_address_id: safeTaskAddressId(descriptors.task_address_id.value),
      conversation_id: safePattern(
        descriptors.conversation_id.value,
        new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
        96,
      ),
      turn_id: safePattern(descriptors.turn_id.value, new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'), 80),
      task_id: safePattern(descriptors.task_id.value, new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'), 80),
      run_id: safePattern(descriptors.run_id.value, new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'), 80),
      request_id: safePattern(
        descriptors.request_id.value,
        new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u'),
        88,
      ),
      checkpoint_sequence: safeSequence(descriptors.checkpoint_sequence.value),
      candidate_ref: candidateRef,
      base_revision_ref: sanitizeBaseRevisionRef(descriptors.base_revision_ref.value, candidateRef.parent_oid),
      source_scope: sanitizeSourceScope(descriptors.source_scope.value, candidateRef.resulting_tree_digest),
      verification_summary: sanitizeVerificationSummary(
        descriptors.verification_summary.value,
        candidateRef,
      ),
      created_at_ms: safeTimestamp(descriptors.created_at_ms.value),
      summary: safeText(descriptors.summary.value, 400),
      checkpoint_state: 'active',
      restore_eligibility: 'candidate_ref_verified',
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
    });
    const checkpointId = safePattern(
      descriptors.checkpoint_id.value,
      /^builder-draft-checkpoint:[0-9a-f]{64}$/u,
      89,
    );
    if (checkpointId !== checkpointIdFor(body)) fail();
    return freezeDeep({
      checkpoint_version: BUILDER_DRAFT_CHECKPOINT_VERSION,
      checkpoint_kind: DRAFT_CHECKPOINT_KIND,
      checkpoint_id: checkpointId,
      ...body,
    });
  } catch (error) {
    if (error instanceof BuilderDraftCheckpointError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DRAFT_CHECKPOINT_VERSION,
  DRAFT_CHECKPOINT_KIND,
  BuilderDraftCheckpointError,
  createBuilderDraftCheckpoint,
  sanitizeBuilderDraftCheckpoint,
});
