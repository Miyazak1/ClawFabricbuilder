'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderDraftContinuationAdmission,
} = require('./builder-draft-continuation-admission.cjs');
const {
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_DRAFT_CONTINUATION_BASE_VERSION = 'builder-draft-continuation-base.v1';
const DRAFT_CONTINUATION_BASE_KIND = 'pending_candidate_git_base';
const INPUT_KEYS = Object.freeze(['admission', 'verified_candidate']);
const VERIFIED_CANDIDATE_KEYS = Object.freeze([
  'result_version',
  'candidate_receipt',
  'verification_receipt',
  'source_tree',
  'code_authority',
  'read_admission',
]);
const BASE_KEYS = Object.freeze([
  'base_version',
  'base_kind',
  'admission_digest',
  'project_id',
  'conversation_id',
  'draft_id',
  'previous_turn_id',
  'previous_task_id',
  'previous_run_id',
  'previous_candidate_id',
  'previous_candidate_digest',
  'previous_resulting_tree_digest',
  'parent_candidate_request_id',
  'parent_candidate_commit_oid',
  'parent_candidate_tree_oid',
  'parent_candidate_expected_base_oid',
  'base_source_tree',
  'base_source_tree_digest',
  'authority',
  'base_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'base_authority',
  'admission_authority',
  'code_authority',
  'renderer_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_mutation',
  'git_parent_authority',
  'project_revision_authority',
  'save_authority',
  'base_revision_semantics',
]);
const AUTHORITY = Object.freeze({
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
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const GIT_REQUEST_ID_PATTERN =
  new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;

class BuilderDraftContinuationBaseError extends Error {
  constructor() {
    super('The draft continuation base could not be verified.');
    this.name = 'BuilderDraftContinuationBaseError';
    this.code = 'builder_draft_continuation_base_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDraftContinuationBaseError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail();
  return value;
}

function safeGitRequestId(value) {
  return safePattern(value, GIT_REQUEST_ID_PATTERN);
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (descriptors[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function sanitizeVerifiedCandidate(value) {
  const descriptors = exactObject(value, VERIFIED_CANDIDATE_KEYS);
  if (
    descriptors.result_version.value !== 'builder-git-verified-candidate-read-result.v1'
    || descriptors.code_authority.value !== 'git_commit_tree'
    || descriptors.read_admission.value !== 'verified'
  ) fail();
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    descriptors.candidate_receipt.value,
    descriptors.verification_receipt.value,
  );
  const sourceTree = sanitizeBuilderProjectSourceTree(descriptors.source_tree.value);
  if (sourceTree.source_tree_digest !== pair.candidate_receipt.resulting_tree_digest) fail();
  return freezeDeep({
    candidate_receipt: pair.candidate_receipt,
    verification_receipt: pair.verification_receipt,
    source_tree: sourceTree,
  });
}

function baseDigestBody(value) {
  return {
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
  };
}

function unsignedBase(admission, verified) {
  const receipt = verified.candidate_receipt;
  if (
    receipt.project_id !== admission.project_id
    || receipt.conversation_id !== admission.conversation_id
    || receipt.turn_id !== admission.previous_turn_id
    || receipt.task_id !== admission.previous_task_id
    || receipt.run_id !== admission.previous_run_id
    || receipt.candidate_id !== admission.candidate_id
    || receipt.candidate_digest !== admission.candidate_digest
    || receipt.resulting_tree_digest !== admission.resulting_tree_digest
    || verified.source_tree.source_tree_digest !== admission.resulting_tree_digest
  ) fail();
  return freezeDeep({
    base_version: BUILDER_DRAFT_CONTINUATION_BASE_VERSION,
    base_kind: DRAFT_CONTINUATION_BASE_KIND,
    admission_digest: admission.admission_digest,
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    draft_id: admission.draft_id,
    previous_turn_id: admission.previous_turn_id,
    previous_task_id: admission.previous_task_id,
    previous_run_id: admission.previous_run_id,
    previous_candidate_id: admission.candidate_id,
    previous_candidate_digest: admission.candidate_digest,
    previous_resulting_tree_digest: admission.resulting_tree_digest,
    parent_candidate_request_id: receipt.request_id,
    parent_candidate_commit_oid: receipt.commit_oid,
    parent_candidate_tree_oid: receipt.tree_oid,
    parent_candidate_expected_base_oid: receipt.expected_base_oid,
    base_source_tree: verified.source_tree,
    base_source_tree_digest: verified.source_tree.source_tree_digest,
    authority: { ...AUTHORITY },
  });
}

function createBuilderDraftContinuationBase(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const base = unsignedBase(
      sanitizeBuilderDraftContinuationAdmission(descriptors.admission.value),
      sanitizeVerifiedCandidate(descriptors.verified_candidate.value),
    );
    return freezeDeep({
      ...base,
      base_digest: sha256Canonical(baseDigestBody(base)),
    });
  } catch (error) {
    if (error instanceof BuilderDraftContinuationBaseError) throw error;
    fail();
  }
}

function sanitizeBuilderDraftContinuationBase(rawBase) {
  try {
    const descriptors = exactObject(rawBase, BASE_KEYS);
    const baseSourceTree = sanitizeBuilderProjectSourceTree(descriptors.base_source_tree.value);
    const projectId = safeProjectId(descriptors.project_id.value);
    const base = freezeDeep({
      base_version: descriptors.base_version.value,
      base_kind: descriptors.base_kind.value,
      admission_digest: safeDigest(descriptors.admission_digest.value),
      project_id: projectId,
      conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
      draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
      previous_turn_id: safePattern(descriptors.previous_turn_id.value, TURN_ID_PATTERN),
      previous_task_id: safePattern(descriptors.previous_task_id.value, TASK_ID_PATTERN),
      previous_run_id: safePattern(descriptors.previous_run_id.value, RUN_ID_PATTERN),
      previous_candidate_id: safePattern(descriptors.previous_candidate_id.value, CANDIDATE_ID_PATTERN),
      previous_candidate_digest: safeDigest(descriptors.previous_candidate_digest.value),
      previous_resulting_tree_digest: safeDigest(descriptors.previous_resulting_tree_digest.value),
      parent_candidate_request_id: safeGitRequestId(descriptors.parent_candidate_request_id.value),
      parent_candidate_commit_oid: safeOid(descriptors.parent_candidate_commit_oid.value),
      parent_candidate_tree_oid: safeOid(descriptors.parent_candidate_tree_oid.value),
      parent_candidate_expected_base_oid: safeOid(descriptors.parent_candidate_expected_base_oid.value, true),
      base_source_tree: baseSourceTree,
      base_source_tree_digest: safeDigest(descriptors.base_source_tree_digest.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      base.base_version !== BUILDER_DRAFT_CONTINUATION_BASE_VERSION
      || base.base_kind !== DRAFT_CONTINUATION_BASE_KIND
      || base.base_source_tree.source_tree_digest !== base.base_source_tree_digest
      || base.base_source_tree_digest !== base.previous_resulting_tree_digest
    ) fail();
    const digest = safeDigest(descriptors.base_digest.value);
    if (digest !== sha256Canonical(baseDigestBody(base))) fail();
    return freezeDeep({
      ...base,
      base_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderDraftContinuationBaseError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DRAFT_CONTINUATION_BASE_VERSION,
  DRAFT_CONTINUATION_BASE_KIND,
  BuilderDraftContinuationBaseError,
  createBuilderDraftContinuationBase,
  sanitizeBuilderDraftContinuationBase,
});
