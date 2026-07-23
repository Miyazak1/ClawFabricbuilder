'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_GIT_PROJECT_REPOSITORY_VERSION = 'builder-git-project-repository.v1';
const BUILDER_GIT_CANDIDATE_RECEIPT_VERSION = 'builder-git-candidate-receipt.v1';
const BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION =
  'builder-git-candidate-verification-receipt.v1';
const BUILDER_GIT_RECEIPT_OBJECT_FORMAT = 'sha1';
const CODE_AUTHORITY = 'git_commit_candidate';
const PRODUCT_REVISION_ADMISSION = 'not_recorded';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BUILDER_ID_PATTERNS = Object.freeze({
  project_id: new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
  conversation_id: new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
  turn_id: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  task_id: new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'),
  run_id: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  request_id: new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u'),
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
});
const CANDIDATE_RECEIPT_KEYS = Object.freeze([
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
const VERIFICATION_RECEIPT_KEYS = Object.freeze([
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

class BuilderGitReceiptContractError extends Error {
  constructor() {
    super('The Git candidate receipt could not be verified.');
    this.name = 'BuilderGitReceiptContractError';
    this.code = 'builder_git_receipt_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderGitReceiptContractError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  for (const key of keys) {
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

function assertCanonicalArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail();
  if (keys.length !== value.length + 1 || !keys.includes('length')) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function assertCanonicalObject(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    assertCanonicalArray(value);
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(canonicalJson(Object.getOwnPropertyDescriptor(value, String(index)).value));
    }
    return `[${items.join(',')}]`;
  }
  if (isPlainObject(value)) {
    assertCanonicalObject(value);
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Hex(value) {
  return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Canonical(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeBuilderId(value, key) {
  if (typeof value !== 'string' || !BUILDER_ID_PATTERNS[key].test(value)) fail();
  return value;
}

function sanitizeBuilderGitCandidateReceipt(value) {
  assertExactObject(value, CANDIDATE_RECEIPT_KEYS);
  const receipt = {
    receipt_version: valueAt(value, 'receipt_version'),
    repository_version: valueAt(value, 'repository_version'),
    project_id: valueAt(value, 'project_id'),
    conversation_id: valueAt(value, 'conversation_id'),
    turn_id: valueAt(value, 'turn_id'),
    task_id: valueAt(value, 'task_id'),
    run_id: valueAt(value, 'run_id'),
    request_id: valueAt(value, 'request_id'),
    candidate_id: valueAt(value, 'candidate_id'),
    candidate_digest: valueAt(value, 'candidate_digest'),
    resulting_tree_digest: valueAt(value, 'resulting_tree_digest'),
    semantic_identity_digest: valueAt(value, 'semantic_identity_digest'),
    verification_receipt_digest: valueAt(value, 'verification_receipt_digest'),
    object_format: valueAt(value, 'object_format'),
    commit_oid: valueAt(value, 'commit_oid'),
    tree_oid: valueAt(value, 'tree_oid'),
    parent_oid: valueAt(value, 'parent_oid'),
    expected_base_oid: valueAt(value, 'expected_base_oid'),
    code_authority: valueAt(value, 'code_authority'),
    product_revision_admission: valueAt(value, 'product_revision_admission'),
    replay: valueAt(value, 'replay'),
  };
  if (
    receipt.receipt_version !== BUILDER_GIT_CANDIDATE_RECEIPT_VERSION
    || receipt.repository_version !== BUILDER_GIT_PROJECT_REPOSITORY_VERSION
    || receipt.object_format !== BUILDER_GIT_RECEIPT_OBJECT_FORMAT
    || receipt.code_authority !== CODE_AUTHORITY
    || receipt.product_revision_admission !== PRODUCT_REVISION_ADMISSION
    || typeof receipt.replay !== 'boolean'
    || receipt.parent_oid !== receipt.expected_base_oid
  ) fail();
  safeBuilderId(receipt.project_id, 'project_id');
  safeBuilderId(receipt.conversation_id, 'conversation_id');
  safeBuilderId(receipt.turn_id, 'turn_id');
  safeBuilderId(receipt.task_id, 'task_id');
  safeBuilderId(receipt.run_id, 'run_id');
  safeBuilderId(receipt.request_id, 'request_id');
  safeBuilderId(receipt.candidate_id, 'candidate_id');
  safeDigest(receipt.candidate_digest);
  safeDigest(receipt.resulting_tree_digest);
  safeDigest(receipt.semantic_identity_digest);
  safeDigest(receipt.verification_receipt_digest);
  safeOid(receipt.commit_oid);
  safeOid(receipt.tree_oid);
  safeOid(receipt.expected_base_oid, true);
  return freezeDeep(receipt);
}

function sanitizeBuilderGitCandidateVerificationReceipt(value) {
  assertExactObject(value, VERIFICATION_RECEIPT_KEYS);
  const verification = {
    receipt_version: valueAt(value, 'receipt_version'),
    repository_version: valueAt(value, 'repository_version'),
    project_id: valueAt(value, 'project_id'),
    conversation_id: valueAt(value, 'conversation_id'),
    turn_id: valueAt(value, 'turn_id'),
    task_id: valueAt(value, 'task_id'),
    run_id: valueAt(value, 'run_id'),
    request_id: valueAt(value, 'request_id'),
    candidate_id: valueAt(value, 'candidate_id'),
    candidate_digest: valueAt(value, 'candidate_digest'),
    expected_base_oid: valueAt(value, 'expected_base_oid'),
    commit_oid: valueAt(value, 'commit_oid'),
    candidate_tree_oid: valueAt(value, 'candidate_tree_oid'),
    resulting_tree_digest: valueAt(value, 'resulting_tree_digest'),
    semantic_identity_digest: valueAt(value, 'semantic_identity_digest'),
    object_format: valueAt(value, 'object_format'),
    commit_ref_admission: valueAt(value, 'commit_ref_admission'),
    request_ref_admission: valueAt(value, 'request_ref_admission'),
    commit_object_admission: valueAt(value, 'commit_object_admission'),
    verification_admission: valueAt(value, 'verification_admission'),
  };
  if (
    verification.receipt_version !== BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION
    || verification.repository_version !== BUILDER_GIT_PROJECT_REPOSITORY_VERSION
    || verification.object_format !== BUILDER_GIT_RECEIPT_OBJECT_FORMAT
    || verification.commit_ref_admission !== 'verified'
    || verification.request_ref_admission !== 'verified'
    || verification.commit_object_admission !== 'verified'
    || verification.verification_admission !== 'accepted'
  ) fail();
  safeBuilderId(verification.project_id, 'project_id');
  safeBuilderId(verification.conversation_id, 'conversation_id');
  safeBuilderId(verification.turn_id, 'turn_id');
  safeBuilderId(verification.task_id, 'task_id');
  safeBuilderId(verification.run_id, 'run_id');
  safeBuilderId(verification.request_id, 'request_id');
  safeBuilderId(verification.candidate_id, 'candidate_id');
  safeDigest(verification.candidate_digest);
  safeOid(verification.expected_base_oid, true);
  safeOid(verification.commit_oid);
  safeOid(verification.candidate_tree_oid);
  safeDigest(verification.resulting_tree_digest);
  safeDigest(verification.semantic_identity_digest);
  return freezeDeep(verification);
}

function sanitizeBuilderGitCandidateReceiptPair(rawCandidate, rawVerification) {
  const candidate = sanitizeBuilderGitCandidateReceipt(rawCandidate);
  const verification = sanitizeBuilderGitCandidateVerificationReceipt(rawVerification);
  if (
    verification.project_id !== candidate.project_id
    || verification.conversation_id !== candidate.conversation_id
    || verification.turn_id !== candidate.turn_id
    || verification.task_id !== candidate.task_id
    || verification.run_id !== candidate.run_id
    || verification.request_id !== candidate.request_id
    || verification.candidate_id !== candidate.candidate_id
    || verification.candidate_digest !== candidate.candidate_digest
    || verification.expected_base_oid !== candidate.expected_base_oid
    || verification.commit_oid !== candidate.commit_oid
    || verification.candidate_tree_oid !== candidate.tree_oid
    || verification.resulting_tree_digest !== candidate.resulting_tree_digest
    || verification.semantic_identity_digest !== candidate.semantic_identity_digest
    || sha256Canonical(verification) !== candidate.verification_receipt_digest
  ) fail();
  return freezeDeep({
    candidate_receipt: candidate,
    verification_receipt: verification,
  });
}

function createBuilderGitCandidateVerificationReceipt(rawReceipt) {
  const receipt = sanitizeBuilderGitCandidateReceipt(rawReceipt);
  const verification = {
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: receipt.project_id,
    conversation_id: receipt.conversation_id,
    turn_id: receipt.turn_id,
    task_id: receipt.task_id,
    run_id: receipt.run_id,
    request_id: receipt.request_id,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    expected_base_oid: receipt.expected_base_oid,
    commit_oid: receipt.commit_oid,
    candidate_tree_oid: receipt.tree_oid,
    resulting_tree_digest: receipt.resulting_tree_digest,
    semantic_identity_digest: receipt.semantic_identity_digest,
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
  assertExactObject(verification, VERIFICATION_RECEIPT_KEYS);
  return freezeDeep(verification);
}

module.exports = Object.freeze({
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  CANDIDATE_RECEIPT_KEYS,
  VERIFICATION_RECEIPT_KEYS,
  BuilderGitReceiptContractError,
  canonicalJson,
  sha256Canonical,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateVerificationReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
  createBuilderGitCandidateVerificationReceipt,
});
