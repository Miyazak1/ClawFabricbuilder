'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderDraftCheckpointError,
  createBuilderDraftCheckpoint,
} = require('./builder-draft-checkpoint.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
  BuilderDraftCheckpointStoreError,
} = require('./builder-draft-checkpoint-store.cjs');

const BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION =
  'builder-draft-checkpoint-recording-service.v1';
const BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_RESULT_VERSION =
  'builder-draft-checkpoint-recording-service-result.v1';
const SERVICE_KEYS = Object.freeze(['draft_checkpoint_store']);
const RECORD_KEYS = Object.freeze([
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
const ERROR_MESSAGES = Object.freeze({
  builder_draft_checkpoint_recording_service_invalid:
    'Builder draft checkpoint recording could not be verified.',
  builder_draft_checkpoint_recording_service_conflict:
    'Builder draft checkpoint changed before it could be recorded.',
  builder_draft_checkpoint_recording_service_unavailable:
    'Builder draft checkpoint recording service is unavailable.',
});

class BuilderDraftCheckpointRecordingServiceError extends Error {
  constructor(code = 'builder_draft_checkpoint_recording_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_draft_checkpoint_recording_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderDraftCheckpointRecordingServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderDraftCheckpointRecordingServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_draft_checkpoint_recording_service_invalid');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_draft_checkpoint_recording_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_draft_checkpoint_recording_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_draft_checkpoint_recording_service_invalid');
  }
  return descriptor.value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_draft_checkpoint_recording_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_draft_checkpoint_recording_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_draft_checkpoint_recording_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    draft_checkpoint_store: safeStore(
      valueAt(rawStores, 'draft_checkpoint_store'),
      BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
      [
        'record_draft_checkpoint',
        'read_draft_checkpoint',
        'read_latest_draft_checkpoint_for_task',
        'list_draft_checkpoints_for_task',
      ],
    ),
  });
}

function checkpointInput(rawRequest) {
  exactObject(rawRequest, RECORD_KEYS);
  return freezeDeep(Object.fromEntries(
    RECORD_KEYS.map((key) => [key, valueAt(rawRequest, key)]),
  ));
}

function normalizeOperationError(error) {
  if (error instanceof BuilderDraftCheckpointRecordingServiceError) {
    return new BuilderDraftCheckpointRecordingServiceError(error.code);
  }
  if (error instanceof BuilderDraftCheckpointError) {
    return new BuilderDraftCheckpointRecordingServiceError(
      'builder_draft_checkpoint_recording_service_invalid',
    );
  }
  if (error instanceof BuilderDraftCheckpointStoreError) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderDraftCheckpointRecordingServiceError(
        'builder_draft_checkpoint_recording_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderDraftCheckpointRecordingServiceError(
        'builder_draft_checkpoint_recording_service_unavailable',
      );
    }
    return new BuilderDraftCheckpointRecordingServiceError(
      'builder_draft_checkpoint_recording_service_invalid',
    );
  }
  return new BuilderDraftCheckpointRecordingServiceError(
    'builder_draft_checkpoint_recording_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_draft_checkpoint_recording_service',
    checkpoint_contract_authority: 'main_draft_checkpoint_contract_v1',
    checkpoint_store_authority: 'main_owned_draft_checkpoint_store',
    candidate_authority: 'verified_git_candidate_receipt_pair',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    conversation_append: false,
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    credential_storage: 'not_present',
    source_read: 'provided_by_verified_candidate_evidence',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    review_authority: false,
    revision_authority: false,
    save_authority: false,
    artifact_authority: false,
    command_execution: false,
    network_access: false,
    publication: false,
    work_capsule_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function recordDraftCheckpointFromCandidate(stores, rawRequest) {
  const draftCheckpoint = createBuilderDraftCheckpoint(checkpointInput(rawRequest));
  const recordResult = stores.draft_checkpoint_store.record_draft_checkpoint({
    draft_checkpoint: draftCheckpoint,
  });
  const checkpointRead = stores.draft_checkpoint_store.read_draft_checkpoint({
    project_id: draftCheckpoint.project_id,
    checkpoint_id: draftCheckpoint.checkpoint_id,
  });
  const latestRead = stores.draft_checkpoint_store.read_latest_draft_checkpoint_for_task({
    project_id: draftCheckpoint.project_id,
    task_address_id: draftCheckpoint.task_address_id,
  });
  const taskList = stores.draft_checkpoint_store.list_draft_checkpoints_for_task({
    project_id: draftCheckpoint.project_id,
    task_address_id: draftCheckpoint.task_address_id,
  });
  if (
    checkpointRead.status !== 'ready'
    || latestRead.status !== 'ready'
    || checkpointRead.draft_checkpoint.draft_checkpoint.checkpoint_id !== draftCheckpoint.checkpoint_id
    || latestRead.draft_checkpoint.draft_checkpoint.checkpoint_id !== draftCheckpoint.checkpoint_id
    || taskList.status !== 'ready'
    || !taskList.draft_checkpoints.some(
      (entry) => entry.draft_checkpoint.checkpoint_id === draftCheckpoint.checkpoint_id,
    )
  ) fail('builder_draft_checkpoint_recording_service_conflict');

  return freezeDeep({
    result_version: BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_RESULT_VERSION,
    service_version: BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,
    operation: 'draft_checkpoint_recorded_from_candidate',
    status: 'ready',
    draft_checkpoint: recordResult.draft_checkpoint,
    checkpoint_read: checkpointRead,
    latest_checkpoint_read: latestRead,
    checkpoint_count_for_task: taskList.draft_checkpoints.length,
    store_operation: recordResult.operation,
    evidence: serviceEvidence(),
  });
}

function createBuilderDraftCheckpointRecordingService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,

    record_draft_checkpoint_from_candidate(rawRequest) {
      try { return recordDraftCheckpointFromCandidate(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = {
  BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,
  BuilderDraftCheckpointRecordingServiceError,
  createBuilderDraftCheckpointRecordingService,
};
