'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  BuilderProjectUnderstandingError,
  createBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');
const {
  BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION,
  BuilderProjectUnderstandingStoreError,
} = require('./builder-project-understanding-store.cjs');

const BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION =
  'builder-project-understanding-service.v1';
const BUILDER_PROJECT_UNDERSTANDING_SERVICE_RESULT_VERSION =
  'builder-project-understanding-service-result.v1';
const SERVICE_KEYS = Object.freeze(['project_read_authority', 'project_understanding_store', 'now_ms']);
const REFRESH_KEYS = Object.freeze(['project_id']);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;

const ERROR_MESSAGES = Object.freeze({
  builder_project_understanding_service_invalid:
    'Builder project understanding refresh could not be verified.',
  builder_project_understanding_service_conflict:
    'Builder project understanding changed before it could be recorded.',
  builder_project_understanding_service_unavailable:
    'Builder project understanding refresh is unavailable.',
});

class BuilderProjectUnderstandingServiceError extends Error {
  constructor(code = 'builder_project_understanding_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_understanding_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectUnderstandingServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_project_understanding_service_invalid') {
  throw new BuilderProjectUnderstandingServiceError(code);
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
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || value.length !== 52 || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeOid(value) {
  if (typeof value !== 'string' || value.length !== 40 || !OID_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function method(target, name) {
  if (target === null || typeof target !== 'object' || utilTypes.isProxy(target)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(target);
}

function safeStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION
  ) fail();
  return freezeDeep({
    store_version: BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION,
    record_project_understanding_snapshot: method(value, 'record_project_understanding_snapshot'),
    read_latest_project_understanding_snapshot: method(value, 'read_latest_project_understanding_snapshot'),
  });
}

function safeReadAuthority(value) {
  return freezeDeep({
    load_current: method(value, 'load_current'),
  });
}

function safeOptions(rawOptions) {
  exactObject(rawOptions, SERVICE_KEYS);
  const nowMs = valueAt(rawOptions, 'now_ms');
  if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) fail();
  return freezeDeep({
    project_read_authority: safeReadAuthority(valueAt(rawOptions, 'project_read_authority')),
    project_understanding_store: safeStore(valueAt(rawOptions, 'project_understanding_store')),
    now_ms: nowMs,
  });
}

function currentSourceTreeFromSavedRead(value, expectedProjectId) {
  exactObject(value, [
    'result_version',
    'operation',
    'product_revision_receipt',
    'current',
    'source_tree',
    'git_candidate_receipt',
    'git_verification_receipt',
    'authority_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-read-result.v1'
    || valueAt(value, 'operation') !== 'current_loaded'
  ) fail();
  const receipt = valueAt(value, 'product_revision_receipt');
  if (!isPlainObject(receipt)) fail();
  if (safeProjectId(valueAt(receipt, 'project_id')) !== expectedProjectId) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (safeDigest(valueAt(receipt, 'resulting_tree_digest')) !== sourceTree.source_tree_digest) fail();
  return freezeDeep({
    source_tree: sourceTree,
    read_source: 'saved_project_revision',
    base_revision_ref: {
      revision_receipt_digest: safeDigest(valueAt(receipt, 'revision_receipt_digest')),
      commit_oid: safeOid(valueAt(receipt, 'commit_oid')),
    },
  });
}

function currentSourceTreeFromLocalWorkspaceRead(value, expectedProjectId) {
  exactObject(value, [
    'result_version',
    'operation',
    'project_id',
    'source_tree',
    'authority_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-local-workspace-read-result.v1'
    || valueAt(value, 'operation') !== 'local_workspace_loaded'
    || safeProjectId(valueAt(value, 'project_id')) !== expectedProjectId
  ) fail();
  return freezeDeep({
    source_tree: sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree')),
    read_source: 'selected_local_workspace',
    base_revision_ref: null,
  });
}

function currentSourceTreeFromReadResult(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'result_version');
  if (!version || !Object.hasOwn(version, 'value')) fail();
  if (version.value === 'builder-project-local-workspace-read-result.v1') {
    return currentSourceTreeFromLocalWorkspaceRead(value, expectedProjectId);
  }
  return currentSourceTreeFromSavedRead(value, expectedProjectId);
}

function rootDigestForCurrentSource(projectId, current) {
  return sha256Canonical({
    project_id: projectId,
    source_tree_digest: current.source_tree.source_tree_digest,
    read_source: current.read_source,
    base_revision_ref: current.base_revision_ref,
  });
}

function normalizeError(error) {
  if (error instanceof BuilderProjectUnderstandingServiceError) {
    return new BuilderProjectUnderstandingServiceError(error.code);
  }
  if (
    error instanceof BuilderProjectUnderstandingError
    || error instanceof BuilderProjectSourceTreeError
  ) {
    return new BuilderProjectUnderstandingServiceError('builder_project_understanding_service_invalid');
  }
  if (error instanceof BuilderProjectUnderstandingStoreError) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderProjectUnderstandingServiceError('builder_project_understanding_service_conflict');
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderProjectUnderstandingServiceError('builder_project_understanding_service_unavailable');
    }
    return new BuilderProjectUnderstandingServiceError('builder_project_understanding_service_invalid');
  }
  return new BuilderProjectUnderstandingServiceError('builder_project_understanding_service_unavailable');
}

function serviceEvidence(current) {
  return freezeDeep({
    service_authority: 'main_owned_project_understanding_service',
    understanding_contract_authority: 'main_owned_project_understanding_contract_v1',
    understanding_store_authority: 'main_owned_project_understanding_store',
    project_read_authority: 'main_project_read_authority_load_current',
    source_read: current.read_source,
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    revision_authority: false,
    save_authority: false,
    secret_access: 'not_present',
    network_access: false,
  });
}

async function refreshProjectUnderstanding(options, rawRequest) {
  exactObject(rawRequest, REFRESH_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const current = currentSourceTreeFromReadResult(
    await options.project_read_authority.load_current({ project_id: projectId }),
    projectId,
  );
  const snapshot = createBuilderProjectUnderstandingSnapshot({
    project_id: projectId,
    root_digest: rootDigestForCurrentSource(projectId, current),
    source_tree: current.source_tree,
    previous_successful_check_runs: [],
    updated_at_ms: safeTimestamp(Reflect.apply(options.now_ms, undefined, [])),
  });
  const record = options.project_understanding_store.record_project_understanding_snapshot({
    project_understanding_snapshot: snapshot,
  });
  const latest = options.project_understanding_store.read_latest_project_understanding_snapshot({
    project_id: projectId,
  });
  if (
    latest.operation !== 'project_understanding_latest_ready_read'
    || latest.project_understanding.snapshot_digest !== record.project_understanding.snapshot_digest
  ) fail('builder_project_understanding_service_conflict');

  return freezeDeep({
    result_version: BUILDER_PROJECT_UNDERSTANDING_SERVICE_RESULT_VERSION,
    service_version: BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION,
    operation: record.operation === 'project_understanding_snapshot_replayed'
      ? 'project_understanding_refresh_replayed'
      : 'project_understanding_refreshed',
    status: 'ready',
    project_id: projectId,
    project_understanding: record.project_understanding,
    latest_project_understanding_read: latest,
    evidence: serviceEvidence(current),
  });
}

function createBuilderProjectUnderstandingService(rawOptions) {
  const options = safeOptions(rawOptions);
  return freezeDeep({
    service_version: BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION,

    async refresh_project_understanding(rawRequest) {
      try { return await refreshProjectUnderstanding(options, rawRequest); } catch (error) {
        throw normalizeError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROJECT_UNDERSTANDING_SERVICE_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION,
  BuilderProjectUnderstandingServiceError,
  createBuilderProjectUnderstandingService,
});
