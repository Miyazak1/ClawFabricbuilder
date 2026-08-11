'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
} = require('./builder-draft-checkpoint-store.cjs');
const {
  BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,
} = require('./builder-draft-checkpoint-recording-service.cjs');
const {
  BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
} = require('./builder-session-task-address-store.cjs');
const {
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');
const {
  projectBuilderDraftCheckpointStatus,
} = require('./builder-draft-checkpoint-status-projection.cjs');

const BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION =
  'builder-automatic-draft-checkpoint-service.v1';
const BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION =
  'builder-automatic-draft-checkpoint-result.v1';
const OPTION_KEYS = Object.freeze([
  'address_store',
  'draft_checkpoint_store',
  'draft_checkpoint_recording_service',
  'now_ms',
]);
const RECORD_KEYS = Object.freeze([
  'candidate_receipt',
  'candidate_verification',
  'base_revision_ref',
  'summary',
  'changed_file_count',
  'edit_attempt_ref',
]);
const READ_STATUS_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'candidate_id',
]);
const VERIFY_CANDIDATE_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_CHECKPOINT_SEQUENCE = 1_000_000;

class BuilderAutomaticDraftCheckpointServiceError extends Error {
  constructor() {
    super('Automatic draft checkpoint could not be recorded.');
    this.name = 'BuilderAutomaticDraftCheckpointServiceError';
    this.code = 'builder_automatic_draft_checkpoint_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAutomaticDraftCheckpointServiceError();
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function ownMethod(value, expectedVersion, versionKey, method) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const selected = Object.getOwnPropertyDescriptor(value, method);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !selected
    || !Object.hasOwn(selected, 'value')
    || typeof selected.value !== 'function'
  ) fail();
  return selected.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50_000) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function currentAddress(readCurrentAddress, addressStore, projectId, conversationId) {
  const result = Reflect.apply(readCurrentAddress, addressStore, [{
    project_id: projectId,
    conversation_id: conversationId,
  }]);
  if (!isPlainObject(result) || valueAt(result, 'status') !== 'ready') fail();
  const sessionEntry = valueAt(result, 'session_address');
  const taskEntry = valueAt(result, 'task_address');
  exactObject(sessionEntry, ['session_address']);
  exactObject(taskEntry, ['task_address']);
  const sessionAddress = sanitizeBuilderSessionAddress(valueAt(sessionEntry, 'session_address'));
  const taskAddress = sanitizeBuilderTaskAddress(valueAt(taskEntry, 'task_address'));
  if (
    sessionAddress.project_id !== projectId
    || taskAddress.project_id !== projectId
    || taskAddress.conversation_id !== conversationId
    || taskAddress.session_id !== sessionAddress.session_id
    || sessionAddress.current_task_id !== taskAddress.task_address_id
  ) fail();
  return freezeDeep({ session_address: sessionAddress, task_address: taskAddress });
}

function absentStatus() {
  return freezeDeep({
    result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
    service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
    operation: 'current_draft_checkpoint_status_read',
    status: 'absent',
    draft_checkpoint_status_projection: null,
  });
}

function createBuilderAutomaticDraftCheckpointService(rawOptions) {
  exactObject(rawOptions, OPTION_KEYS);
  const addressStore = valueAt(rawOptions, 'address_store');
  const checkpointStore = valueAt(rawOptions, 'draft_checkpoint_store');
  const recordingService = valueAt(rawOptions, 'draft_checkpoint_recording_service');
  const nowMs = valueAt(rawOptions, 'now_ms');
  if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) fail();
  const readCurrentAddress = ownMethod(
    addressStore,
    BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
    'store_version',
    'read_current_session_task_for_conversation',
  );
  const readLatestCheckpoint = ownMethod(
    checkpointStore,
    BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
    'store_version',
    'read_latest_draft_checkpoint_for_task',
  );
  const recordCheckpoint = ownMethod(
    recordingService,
    BUILDER_DRAFT_CHECKPOINT_RECORDING_SERVICE_VERSION,
    'service_version',
    'record_draft_checkpoint_from_candidate',
  );

  function readLatest(projectId, taskAddressId) {
    const result = Reflect.apply(readLatestCheckpoint, checkpointStore, [{
      project_id: projectId,
      task_address_id: taskAddressId,
    }]);
    if (!isPlainObject(result)) fail();
    const status = valueAt(result, 'status');
    if (status !== 'absent' && status !== 'ready') fail();
    return result;
  }

  return freezeDeep({
    service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,

    record_verified_candidate_checkpoint(rawRequest) {
      try {
        exactObject(rawRequest, RECORD_KEYS);
        const pair = sanitizeBuilderGitCandidateReceiptPair(
          valueAt(rawRequest, 'candidate_receipt'),
          valueAt(rawRequest, 'candidate_verification'),
        );
        const receipt = pair.candidate_receipt;
        const changedFileCount = safeCount(valueAt(rawRequest, 'changed_file_count'));
        const address = currentAddress(
          readCurrentAddress,
          addressStore,
          receipt.project_id,
          receipt.conversation_id,
        );
        const latest = readLatest(receipt.project_id, address.task_address.task_address_id);
        if (
          latest.status === 'ready'
          && latest.draft_checkpoint.draft_checkpoint.candidate_ref.candidate_id === receipt.candidate_id
        ) {
          return freezeDeep({
            result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
            service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
            operation: 'draft_checkpoint_replayed',
            status: 'ready',
            draft_checkpoint: latest.draft_checkpoint,
            draft_checkpoint_status_projection: projectBuilderDraftCheckpointStatus({
              latest_draft_checkpoint_read_result: latest,
            }),
          });
        }
        const previousSequence = latest.status === 'ready'
          ? latest.draft_checkpoint.draft_checkpoint.checkpoint_sequence
          : 0;
        if (previousSequence >= MAX_CHECKPOINT_SEQUENCE) fail();
        const recordedAtMs = safeTimestamp(Reflect.apply(nowMs, undefined, []));
        const recorded = Reflect.apply(recordCheckpoint, recordingService, [{
          candidate_receipt: pair.candidate_receipt,
          candidate_verification: pair.verification_receipt,
          session_id: address.session_address.session_id,
          task_address_id: address.task_address.task_address_id,
          checkpoint_sequence: previousSequence + 1,
          base_revision_ref: valueAt(rawRequest, 'base_revision_ref'),
          created_at_ms: recordedAtMs,
          summary: valueAt(rawRequest, 'summary'),
          source_scope: {
            scope_kind: 'project_candidate',
            changed_file_count: changedFileCount,
            resulting_tree_digest: receipt.resulting_tree_digest,
          },
          verification_summary: {
            status: 'candidate_verified',
            summary: 'Candidate source was verified for local draft recovery.',
            edit_attempt_ref: valueAt(rawRequest, 'edit_attempt_ref'),
          },
        }]);
        if (!isPlainObject(recorded) || valueAt(recorded, 'status') !== 'ready') fail();
        return freezeDeep({
          result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
          service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
          operation: 'draft_checkpoint_recorded',
          status: 'ready',
          draft_checkpoint: valueAt(recorded, 'draft_checkpoint'),
          draft_checkpoint_status_projection: projectBuilderDraftCheckpointStatus({
            latest_draft_checkpoint_read_result: valueAt(recorded, 'latest_checkpoint_read'),
          }),
        });
      } catch (error) {
        if (error instanceof BuilderAutomaticDraftCheckpointServiceError) throw error;
        fail();
      }
    },

    read_current_checkpoint_status(rawRequest) {
      try {
        exactObject(rawRequest, READ_STATUS_KEYS);
        const projectId = safePattern(valueAt(rawRequest, 'project_id'), PROJECT_ID_PATTERN);
        const conversationId = safePattern(
          valueAt(rawRequest, 'conversation_id'),
          CONVERSATION_ID_PATTERN,
        );
        const candidateId = safePattern(valueAt(rawRequest, 'candidate_id'), CANDIDATE_ID_PATTERN);
        let address;
        try {
          address = currentAddress(readCurrentAddress, addressStore, projectId, conversationId);
        } catch {
          return absentStatus();
        }
        const latest = readLatest(projectId, address.task_address.task_address_id);
        if (
          latest.status !== 'ready'
          || latest.draft_checkpoint.draft_checkpoint.candidate_ref.candidate_id !== candidateId
        ) return absentStatus();
        return freezeDeep({
          result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
          service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
          operation: 'current_draft_checkpoint_status_read',
          status: 'ready',
          draft_checkpoint_status_projection: projectBuilderDraftCheckpointStatus({
            latest_draft_checkpoint_read_result: latest,
          }),
        });
      } catch (error) {
        if (error instanceof BuilderAutomaticDraftCheckpointServiceError) throw error;
        fail();
      }
    },

    verify_current_candidate_checkpoint(rawRequest) {
      try {
        exactObject(rawRequest, VERIFY_CANDIDATE_KEYS);
        const projectId = safePattern(valueAt(rawRequest, 'project_id'), PROJECT_ID_PATTERN);
        const conversationId = safePattern(
          valueAt(rawRequest, 'conversation_id'),
          CONVERSATION_ID_PATTERN,
        );
        const taskId = safePattern(valueAt(rawRequest, 'task_id'), TASK_ID_PATTERN);
        const runId = safePattern(valueAt(rawRequest, 'run_id'), RUN_ID_PATTERN);
        const candidateId = safePattern(valueAt(rawRequest, 'candidate_id'), CANDIDATE_ID_PATTERN);
        const candidateDigest = safePattern(valueAt(rawRequest, 'candidate_digest'), DIGEST_PATTERN);
        const resultingTreeDigest = safePattern(
          valueAt(rawRequest, 'resulting_tree_digest'),
          DIGEST_PATTERN,
        );
        const address = currentAddress(readCurrentAddress, addressStore, projectId, conversationId);
        const latest = readLatest(projectId, address.task_address.task_address_id);
        if (latest.status !== 'ready') fail();
        const checkpoint = latest.draft_checkpoint.draft_checkpoint;
        if (
          checkpoint.project_id !== projectId
          || checkpoint.conversation_id !== conversationId
          || checkpoint.task_id !== taskId
          || checkpoint.run_id !== runId
          || checkpoint.task_address_id !== address.task_address.task_address_id
          || checkpoint.checkpoint_state !== 'active'
          || checkpoint.restore_eligibility !== 'candidate_ref_verified'
          || checkpoint.candidate_ref.candidate_id !== candidateId
          || checkpoint.candidate_ref.candidate_digest !== candidateDigest
          || checkpoint.candidate_ref.resulting_tree_digest !== resultingTreeDigest
        ) fail();
        return freezeDeep({
          result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
          service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
          operation: 'current_candidate_checkpoint_verified',
          status: 'verified',
          checkpoint_ref: {
            checkpoint_id: checkpoint.checkpoint_id,
            checkpoint_sequence: checkpoint.checkpoint_sequence,
            candidate_id: checkpoint.candidate_ref.candidate_id,
            candidate_digest: checkpoint.candidate_ref.candidate_digest,
            resulting_tree_digest: checkpoint.candidate_ref.resulting_tree_digest,
          },
          verification_admission: 'main_owned_latest_checkpoint_verified',
        });
      } catch (error) {
        if (error instanceof BuilderAutomaticDraftCheckpointServiceError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
  BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
  BuilderAutomaticDraftCheckpointServiceError,
  createBuilderAutomaticDraftCheckpointService,
});
