'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderWorkCapsuleManifestError,
  createBuilderWorkCapsuleManifest,
} = require('./builder-work-capsule-manifest.cjs');

const SERVICE_VERSION = 'builder-work-capsule-manifest-service.v1';
const RESULT_VERSION = 'builder-work-capsule-manifest-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['metadata_authority', 'session_task_address_store']);
const REQUEST_KEYS = Object.freeze([
  'project_id',
  'revision_receipt_digest',
  'session_id',
  'task_address_id',
  'artifact_refs',
  'public_summary',
  'remix_metadata',
  'created_at_ms',
]);
const REVISION_KEYS = Object.freeze([
  'project_id',
  'revision_receipt_digest',
  'revision_number',
  'previous_revision_receipt_digest',
  'title',
  'summary',
  'conversation_id',
  'turn_id',
  'request_id',
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
const ERROR_MESSAGE = 'Builder Work Capsule manifest service could not verify the requested work.';

class BuilderWorkCapsuleManifestServiceError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderWorkCapsuleManifestServiceError';
    this.code = 'builder_work_capsule_manifest_service_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkCapsuleManifestServiceError();
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

function method(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(value);
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function sanitizeServices(value) {
  exactObject(value, SERVICE_KEYS);
  const metadataAuthority = valueAt(value, 'metadata_authority');
  const addressStore = valueAt(value, 'session_task_address_store');
  return freezeDeep({
    loadProjectRevision: method(metadataAuthority, 'load_project_revision'),
    readSessionAddress: method(addressStore, 'read_session_address'),
    readTaskAddress: method(addressStore, 'read_task_address'),
  });
}

function sanitizeRequest(value) {
  exactObject(value, REQUEST_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    session_id: safeSessionId(valueAt(value, 'session_id')),
    task_address_id: safeTaskAddressId(valueAt(value, 'task_address_id')),
    artifact_refs: valueAt(value, 'artifact_refs'),
    public_summary: valueAt(value, 'public_summary'),
    remix_metadata: valueAt(value, 'remix_metadata'),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeLoadedRevision(value, request) {
  exactObject(value, ['result_version', 'operation', 'receipt', 'current', 'metadata_evidence']);
  if (
    valueAt(value, 'result_version') !== 'builder-product-metadata-result.v4'
    || valueAt(value, 'operation') !== 'revision_loaded'
  ) fail();
  const receipt = valueAt(value, 'receipt');
  if (!isPlainObject(receipt)) fail();
  const revision = {};
  for (const key of REVISION_KEYS) revision[key] = valueAt(receipt, key);
  if (
    revision.project_id !== request.project_id
    || revision.revision_receipt_digest !== request.revision_receipt_digest
  ) fail();
  return freezeDeep(revision);
}

function sanitizeAddressRead(value, key) {
  exactObject(value, ['result_version', 'status', key, 'address_evidence']);
  if (
    valueAt(value, 'result_version') !== 'builder-session-task-address-store-read-result.v1'
    || valueAt(value, 'status') !== 'ready'
  ) fail();
  const record = valueAt(value, key);
  exactObject(record, [key]);
  return valueAt(record, key);
}

function authority() {
  return freezeDeep({
    service_authority: 'main_owned_work_capsule_manifest_service',
    metadata_read: 'project_revision_loaded',
    session_address_read: 'session_address_ready_read',
    task_address_read: 'task_address_ready_read',
    manifest_contract_authority: 'builder-work-capsule-manifest.v1',
    sqlite_write: false,
    git_write: false,
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    permission_grant: false,
    export_materialization: false,
    network_access: false,
    publication: false,
    autonomous_experiment: false,
  });
}

function manifestProjectRevision(revision) {
  return freezeDeep({ ...revision });
}

function createManifest(services, rawRequest) {
  const request = sanitizeRequest(rawRequest);
  const loadedRevision = sanitizeLoadedRevision(Reflect.apply(
    services.loadProjectRevision,
    null,
    [{
      project_id: request.project_id,
      revision_receipt_digest: request.revision_receipt_digest,
    }],
  ), request);
  const sessionAddress = sanitizeAddressRead(Reflect.apply(
    services.readSessionAddress,
    null,
    [{
      project_id: request.project_id,
      session_id: request.session_id,
    }],
  ), 'session_address');
  const taskAddress = sanitizeAddressRead(Reflect.apply(
    services.readTaskAddress,
    null,
    [{
      project_id: request.project_id,
      task_address_id: request.task_address_id,
    }],
  ), 'task_address');
  const manifest = createBuilderWorkCapsuleManifest({
    project_revision: manifestProjectRevision(loadedRevision),
    artifact_refs: request.artifact_refs,
    review_decision: {
      review_id: loadedRevision.review_id,
      decision: 'accepted',
      reviewed_at_ms: loadedRevision.selected_at_ms,
      decision_summary: 'Owner accepted this saved result.',
    },
    verification_summary: {
      verification_receipt_digest: loadedRevision.verification_receipt_digest,
      status: 'verified',
      summary: 'Saved revision Git and product metadata evidence is recorded.',
    },
    public_summary: request.public_summary,
    remix_metadata: request.remix_metadata,
    session_address: sessionAddress,
    task_address: taskAddress,
    created_at_ms: request.created_at_ms,
  });
  return freezeDeep({
    result_version: RESULT_VERSION,
    service_version: SERVICE_VERSION,
    operation: 'local_work_capsule_manifest_created',
    status: 'ready',
    project_id: manifest.project_id,
    session_id: manifest.session_id,
    task_address_id: manifest.task_address_id,
    revision_receipt_digest: manifest.revision_receipt_digest,
    capsule_id: manifest.capsule_id,
    manifest,
    authority: authority(),
  });
}

function normalizeError(error) {
  if (
    error instanceof BuilderWorkCapsuleManifestServiceError
    || error instanceof BuilderWorkCapsuleManifestError
  ) return new BuilderWorkCapsuleManifestServiceError();
  return new BuilderWorkCapsuleManifestServiceError();
}

function createBuilderWorkCapsuleManifestService(rawServices) {
  const services = sanitizeServices(rawServices);
  return freezeDeep({
    service_version: SERVICE_VERSION,
    create_local_manifest(rawRequest) {
      try { return createManifest(services, rawRequest); } catch (error) {
        throw normalizeError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_WORK_CAPSULE_MANIFEST_SERVICE_RESULT_VERSION: RESULT_VERSION,
  BUILDER_WORK_CAPSULE_MANIFEST_SERVICE_VERSION: SERVICE_VERSION,
  BuilderWorkCapsuleManifestServiceError,
  createBuilderWorkCapsuleManifestService,
});
