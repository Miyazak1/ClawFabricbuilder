'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  BuilderGitReceiptContractError,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
} = require('./builder-git-project-repository.cjs');
const {
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  BuilderProductMetadataSchemaError,
  sanitizeListCurrentProjectRevisionsRequest,
  sanitizeLoadCurrentRequest,
  sanitizeLoadProjectRevisionRequest,
  sanitizeReceiptRow,
} = require('./builder-product-metadata-schema.cjs');
const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_PROJECT_READ_AUTHORITY_VERSION = 'builder-project-read-authority.v1';
const BUILDER_PROJECT_READ_RESULT_VERSION = 'builder-project-read-result.v1';
const DATABASE_ID = 'builder-product-metadata-database.v2';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_project_read_invalid: 'The Builder project read request is invalid.',
  builder_project_read_not_found: 'The Builder project is unavailable.',
  builder_project_read_integrity_failed: 'The Builder project could not be verified.',
  builder_project_read_resource_exceeded: 'The Builder project read limits were reached.',
  builder_project_read_unavailable: 'The Builder project could not be read.',
});

class BuilderProjectReadAuthorityError extends Error {
  constructor(code = 'builder_project_read_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_read_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectReadAuthorityError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProjectReadAuthorityError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail('builder_project_read_integrity_failed');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('builder_project_read_integrity_failed');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_project_read_integrity_failed');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_project_read_integrity_failed');
  }
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function assertDenseArray(value, maximum) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) {
    fail('builder_project_read_integrity_failed');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) {
    fail('builder_project_read_integrity_failed');
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_project_read_integrity_failed');
    }
  }
}

function ownMethod(authority, methodName) {
  if (authority === null || typeof authority !== 'object' || utilTypes.isProxy(authority)) {
    fail('builder_project_read_invalid');
  }
  const descriptor = Object.getOwnPropertyDescriptor(authority, methodName);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_project_read_invalid');
  }
  return descriptor.value.bind(authority);
}

function safeProjectId(value) {
  if (typeof value !== 'string' || value.length > 80 || !PROJECT_ID_PATTERN.test(value)) {
    fail('builder_project_read_integrity_failed');
  }
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
  ) fail('builder_project_read_integrity_failed');
  return value;
}

function safePositiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail('builder_project_read_integrity_failed');
  }
  return value;
}

function safeNonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_project_read_integrity_failed');
  }
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('builder_project_read_integrity_failed');
  }
  return value;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !GIT_OID_PATTERN.test(value)) {
    fail('builder_project_read_integrity_failed');
  }
  return value;
}

function sanitizeCurrentSummary(value) {
  assertExactObject(value, [
    'project_id',
    'title',
    'summary',
    'revision_receipt_digest',
    'revision_number',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
  ]);
  if (valueAt(value, 'object_format') !== 'sha1') {
    fail('builder_project_read_integrity_failed');
  }
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    title: safeText(valueAt(value, 'title'), 80),
    summary: safeText(valueAt(value, 'summary'), 400),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    revision_number: safePositiveInteger(valueAt(value, 'revision_number'), 1024),
    object_format: 'sha1',
    commit_oid: safeOid(valueAt(value, 'commit_oid')),
    tree_oid: safeOid(valueAt(value, 'tree_oid')),
    parent_oid: safeOid(valueAt(value, 'parent_oid'), true),
  });
}

function assertSummaryMatchesReceipt(summary, receipt) {
  if (
    summary.project_id !== receipt.project_id
    || summary.title !== receipt.title
    || summary.summary !== receipt.summary
    || summary.revision_receipt_digest !== receipt.revision_receipt_digest
    || summary.revision_number !== receipt.revision_number
    || summary.object_format !== receipt.object_format
    || summary.commit_oid !== receipt.commit_oid
    || summary.tree_oid !== receipt.tree_oid
    || summary.parent_oid !== receipt.parent_oid
  ) fail('builder_project_read_integrity_failed');
}

function sanitizeMetadataEvidence(value, operation) {
  assertExactObject(value, [
    'database_id',
    'schema_fingerprint_digest',
    'schema_version',
    'user_version',
    'runtime_pragmas',
    'transaction',
    'git_object_verification',
    'source_bytes_stored',
    'credential_storage',
    'ui_state_storage',
  ]);
  const pragmas = valueAt(value, 'runtime_pragmas');
  assertExactObject(pragmas, ['foreign_keys', 'journal_mode', 'synchronous', 'trusted_schema']);
  const expectedTransaction = operation === 'current_listed'
    ? 'current_list_full_chain_readback'
    : 'current_readback';
  if (
    valueAt(value, 'database_id') !== DATABASE_ID
    || valueAt(value, 'schema_version') !== BUILDER_PRODUCT_METADATA_SCHEMA_VERSION
    || valueAt(value, 'user_version') !== BUILDER_PRODUCT_METADATA_USER_VERSION
    || valueAt(value, 'transaction') !== expectedTransaction
    || valueAt(value, 'git_object_verification') !== 'not_performed_by_metadata_database'
    || valueAt(value, 'source_bytes_stored') !== false
    || valueAt(value, 'credential_storage') !== 'not_present'
    || valueAt(value, 'ui_state_storage') !== 'not_present'
    || valueAt(pragmas, 'foreign_keys') !== 'on'
    || valueAt(pragmas, 'journal_mode') !== 'wal'
    || valueAt(pragmas, 'synchronous') !== 'full'
    || valueAt(pragmas, 'trusted_schema') !== 'off'
  ) fail('builder_project_read_integrity_failed');
  safeDigest(valueAt(value, 'schema_fingerprint_digest'));
}

function sanitizeMetadataReadResult(value, expectedOperation) {
  assertExactObject(value, ['result_version', 'operation', 'receipt', 'current', 'metadata_evidence']);
  if (
    valueAt(value, 'result_version') !== BUILDER_PRODUCT_METADATA_RESULT_VERSION
    || valueAt(value, 'operation') !== expectedOperation
  ) fail('builder_project_read_integrity_failed');
  let receipt;
  try {
    receipt = sanitizeReceiptRow(valueAt(value, 'receipt'));
  } catch {
    fail('builder_project_read_integrity_failed');
  }
  const current = sanitizeCurrentSummary(valueAt(value, 'current'));
  sanitizeMetadataEvidence(valueAt(value, 'metadata_evidence'), expectedOperation);
  if (expectedOperation === 'current_loaded') assertSummaryMatchesReceipt(current, receipt);
  if (current.project_id !== receipt.project_id) fail('builder_project_read_integrity_failed');
  return freezeDeep({ receipt, current });
}

function sanitizeCatalogSummary(value) {
  assertExactObject(value, [
    'project_id',
    'title',
    'summary',
    'revision_number',
    'revision_receipt_digest',
    'commit_oid',
    'tree_oid',
    'selected_at_ms',
  ]);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    title: safeText(valueAt(value, 'title'), 80),
    summary: safeText(valueAt(value, 'summary'), 400),
    revision_number: safePositiveInteger(valueAt(value, 'revision_number'), 1024),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    commit_oid: safeOid(valueAt(value, 'commit_oid')),
    tree_oid: safeOid(valueAt(value, 'tree_oid')),
    selected_at_ms: safeNonNegativeInteger(valueAt(value, 'selected_at_ms')),
  });
}

function sanitizeMetadataListResult(value, limit) {
  assertExactObject(value, ['result_version', 'operation', 'projects', 'metadata_evidence']);
  if (
    valueAt(value, 'result_version') !== BUILDER_PRODUCT_METADATA_RESULT_VERSION
    || valueAt(value, 'operation') !== 'current_listed'
  ) fail('builder_project_read_integrity_failed');
  const rawProjects = valueAt(value, 'projects');
  assertDenseArray(rawProjects, limit);
  const projects = rawProjects.map(sanitizeCatalogSummary);
  for (let index = 1; index < projects.length; index += 1) {
    if (projects[index - 1].project_id >= projects[index].project_id) {
      fail('builder_project_read_integrity_failed');
    }
  }
  sanitizeMetadataEvidence(valueAt(value, 'metadata_evidence'), 'current_listed');
  return freezeDeep(projects);
}

function candidateReceiptFromProductReceipt(receipt) {
  try {
    return sanitizeBuilderGitCandidateReceipt({
      receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
      repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
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
      expected_base_oid: receipt.parent_oid,
      code_authority: CODE_AUTHORITY,
      product_revision_admission: PRODUCT_REVISION_ADMISSION,
      replay: false,
    });
  } catch {
    fail('builder_project_read_integrity_failed');
  }
}

function sanitizeGitReadResult(value, expectedCandidate) {
  assertExactObject(value, [
    'result_version',
    'candidate_receipt',
    'verification_receipt',
    'source_tree',
    'code_authority',
    'read_admission',
  ]);
  if (
    valueAt(value, 'result_version') !== BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION
    || valueAt(value, 'code_authority') !== 'git_commit_tree'
    || valueAt(value, 'read_admission') !== 'verified'
  ) fail('builder_project_read_integrity_failed');
  let pair;
  let sourceTree;
  try {
    pair = sanitizeBuilderGitCandidateReceiptPair(
      valueAt(value, 'candidate_receipt'),
      valueAt(value, 'verification_receipt'),
    );
    sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  } catch {
    fail('builder_project_read_integrity_failed');
  }
  if (
    JSON.stringify(pair.candidate_receipt) !== JSON.stringify(expectedCandidate)
    || sourceTree.source_tree_digest !== expectedCandidate.resulting_tree_digest
  ) fail('builder_project_read_integrity_failed');
  return freezeDeep({
    candidate_receipt: pair.candidate_receipt,
    verification_receipt: pair.verification_receipt,
    source_tree: sourceTree,
  });
}

function projectSnapshot(metadata, git) {
  const receipt = metadata.receipt;
  if (
    receipt.project_id !== git.candidate_receipt.project_id
    || receipt.commit_oid !== git.candidate_receipt.commit_oid
    || receipt.tree_oid !== git.candidate_receipt.tree_oid
    || receipt.resulting_tree_digest !== git.source_tree.source_tree_digest
  ) fail('builder_project_read_integrity_failed');
  return freezeDeep({
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    product_revision_receipt: receipt,
    current: metadata.current,
    source_tree: git.source_tree,
    git_candidate_receipt: git.candidate_receipt,
    git_verification_receipt: git.verification_receipt,
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
    },
  });
}

function normalizeError(error) {
  if (error && typeof error === 'object' && utilTypes.isProxy(error)) {
    return new BuilderProjectReadAuthorityError('builder_project_read_unavailable');
  }
  if (error instanceof BuilderProjectReadAuthorityError) {
    return new BuilderProjectReadAuthorityError(error.code);
  }
  if (
    error instanceof BuilderProductMetadataSchemaError
    || error instanceof BuilderGitReceiptContractError
    || error instanceof BuilderProjectSourceTreeError
  ) return new BuilderProjectReadAuthorityError('builder_project_read_invalid');
  const codeDescriptor = error && typeof error === 'object' && !utilTypes.isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, 'code')
    : null;
  const code = codeDescriptor && Object.hasOwn(codeDescriptor, 'value')
    ? codeDescriptor.value
    : null;
  if (code === 'builder_product_metadata_not_found') {
    return new BuilderProjectReadAuthorityError('builder_project_read_not_found');
  }
  if (code === 'builder_product_metadata_resource_exceeded') {
    return new BuilderProjectReadAuthorityError('builder_project_read_resource_exceeded');
  }
  if (
    code === 'builder_product_metadata_integrity_failed'
    || code === 'builder_git_project_integrity_failed'
    || code === 'builder_git_project_conflict'
    || code === 'builder_git_project_dirty'
    || code === 'builder_git_project_invalid'
  ) return new BuilderProjectReadAuthorityError('builder_project_read_integrity_failed');
  return new BuilderProjectReadAuthorityError('builder_project_read_unavailable');
}

function createBuilderProjectReadAuthority(rawOptions) {
  if (!isPlainObject(rawOptions)) fail('builder_project_read_invalid');
  const optionKeys = Reflect.ownKeys(rawOptions);
  if (
    optionKeys.length !== 2
    || !optionKeys.includes('metadata_database')
    || !optionKeys.includes('git_repository')
  ) fail('builder_project_read_invalid');
  const metadata = valueAt(rawOptions, 'metadata_database');
  const git = valueAt(rawOptions, 'git_repository');
  const loadCurrentMetadata = ownMethod(metadata, 'load_current_project_revision');
  const loadRevisionMetadata = ownMethod(metadata, 'load_project_revision');
  const listCurrentMetadata = ownMethod(metadata, 'list_current_project_revisions');
  const readVerifiedCandidate = ownMethod(git, 'read_verified_candidate');

  async function loadCurrent(rawRequest) {
    try {
      const request = sanitizeLoadCurrentRequest(rawRequest);
      const metadataResult = sanitizeMetadataReadResult(
        await loadCurrentMetadata(request),
        'current_loaded',
      );
      if (metadataResult.receipt.project_id !== request.project_id) {
        fail('builder_project_read_integrity_failed');
      }
      const candidate = candidateReceiptFromProductReceipt(metadataResult.receipt);
      const gitResult = sanitizeGitReadResult(
        await readVerifiedCandidate(candidate),
        candidate,
      );
      return freezeDeep({
        ...projectSnapshot(metadataResult, gitResult),
        operation: 'current_loaded',
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function loadRevision(rawRequest) {
    try {
      const request = sanitizeLoadProjectRevisionRequest(rawRequest);
      const metadataResult = sanitizeMetadataReadResult(
        await loadRevisionMetadata(request),
        'revision_loaded',
      );
      if (
        metadataResult.receipt.project_id !== request.project_id
        || metadataResult.receipt.revision_receipt_digest !== request.revision_receipt_digest
      ) fail('builder_project_read_integrity_failed');
      const candidate = candidateReceiptFromProductReceipt(metadataResult.receipt);
      const gitResult = sanitizeGitReadResult(
        await readVerifiedCandidate(candidate),
        candidate,
      );
      return freezeDeep({
        ...projectSnapshot(metadataResult, gitResult),
        operation: 'revision_loaded',
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function listCurrent(rawRequest) {
    try {
      const request = sanitizeListCurrentProjectRevisionsRequest(rawRequest);
      const projects = sanitizeMetadataListResult(
        await listCurrentMetadata(request),
        request.limit,
      );
      return freezeDeep({
        result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
        operation: 'current_listed',
        projects,
        authority_evidence: {
          product_authority: 'sqlite_product_revision_receipt',
          code_authority: 'not_read_for_catalog',
          source_read_admission: 'not_requested',
          current_selection: 'sqlite_current_project_revision',
        },
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return freezeDeep({
    authority_version: BUILDER_PROJECT_READ_AUTHORITY_VERSION,
    load_current: loadCurrent,
    load_revision: loadRevision,
    list_current: listCurrent,
  });
}

module.exports = Object.freeze({
  BUILDER_PROJECT_READ_AUTHORITY_VERSION,
  BUILDER_PROJECT_READ_RESULT_VERSION,
  BuilderProjectReadAuthorityError,
  createBuilderProjectReadAuthority,
});
