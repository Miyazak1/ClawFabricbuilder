'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderConversationRecordError,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  BuilderConversationReplayError,
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');
const {
  BuilderTaskCapsuleContractError,
  createBuilderTaskCapsuleUpdate,
} = require('./builder-task-capsule-contract.cjs');
const {
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  BuilderTaskCapsuleStoreError,
} = require('./builder-task-capsule-store.cjs');

const BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION = 'builder-task-capsule-recording-service.v1';
const BUILDER_TASK_CAPSULE_RECORDING_RESULT_VERSION = 'builder-task-capsule-recording-result.v1';
const MAX_EVENTS = 1_024;
const SERVICE_KEYS = Object.freeze(['task_capsule_store']);
const REQUEST_KEYS = Object.freeze(['events', 'target_sequence']);
const ERROR_MESSAGES = Object.freeze({
  builder_task_capsule_recording_service_invalid: 'Builder task capsule recording request could not be verified.',
  builder_task_capsule_recording_service_conflict: 'Builder task capsule recording is not current.',
  builder_task_capsule_recording_service_unavailable: 'Builder task capsule recording is unavailable.',
});

class BuilderTaskCapsuleRecordingServiceError extends Error {
  constructor(code = 'builder_task_capsule_recording_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_task_capsule_recording_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderTaskCapsuleRecordingServiceError';
    this.code = selected;
    this.retryable = selected === 'builder_task_capsule_recording_service_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_task_capsule_recording_service_invalid') {
  throw new BuilderTaskCapsuleRecordingServiceError(code);
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

function method(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail();
  }
  return descriptor.value.bind(value);
}

function safeStore(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (!version || !Object.hasOwn(version, 'value') || version.value !== BUILDER_TASK_CAPSULE_STORE_VERSION) {
    fail();
  }
  return freezeDeep({
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    record_task_capsule_update: method(value, 'record_task_capsule_update'),
    read_task_capsule_update: method(value, 'read_task_capsule_update'),
    read_latest_task_capsule: method(value, 'read_latest_task_capsule'),
  });
}

function safeServices(rawServices) {
  exactObject(rawServices, SERVICE_KEYS);
  return freezeDeep({
    task_capsule_store: safeStore(valueAt(rawServices, 'task_capsule_store')),
  });
}

function denseEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > MAX_EVENTS
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    events.push(sanitizeBuilderConversationEvent(descriptor.value));
  }
  return freezeDeep(events);
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENTS) fail();
  return value;
}

function safeRequest(rawRequest) {
  exactObject(rawRequest, REQUEST_KEYS);
  return freezeDeep({
    events: denseEvents(valueAt(rawRequest, 'events')),
    target_sequence: safeSequence(valueAt(rawRequest, 'target_sequence')),
  });
}

function evidence(storeOperation) {
  return freezeDeep({
    service_authority: 'main_owned_task_capsule_recording_service',
    conversation_replay_authority: 'builder_conversation_replay_v2',
    task_capsule_contract_authority: 'main_task_capsule_contract_v1',
    task_capsule_store_authority: 'main_owned_task_capsule_store',
    task_capsule_store_operation: storeOperation,
    conversation_append: false,
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    review_authority: false,
    revision_authority: false,
    artifact_authority: false,
    command_execution: false,
    network_access: false,
    credential_storage: 'not_present',
    recovery_model: 'idempotent_store_replay',
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderTaskCapsuleRecordingServiceError) {
    return new BuilderTaskCapsuleRecordingServiceError(error.code);
  }
  if (
    error instanceof BuilderConversationRecordError
    || error instanceof BuilderConversationReplayError
    || error instanceof BuilderTaskCapsuleContractError
  ) {
    return new BuilderTaskCapsuleRecordingServiceError(
      'builder_task_capsule_recording_service_invalid',
    );
  }
  if (error instanceof BuilderTaskCapsuleStoreError) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderTaskCapsuleRecordingServiceError(
        'builder_task_capsule_recording_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderTaskCapsuleRecordingServiceError(
        'builder_task_capsule_recording_service_unavailable',
      );
    }
    return new BuilderTaskCapsuleRecordingServiceError(
      'builder_task_capsule_recording_service_invalid',
    );
  }
  return new BuilderTaskCapsuleRecordingServiceError(
    'builder_task_capsule_recording_service_unavailable',
  );
}

function targetTaskBriefEvent(events, sequence) {
  const event = events[sequence - 1] ?? null;
  if (event === null || event.sequence !== sequence || event.event_type !== 'task_brief_updated') {
    fail('builder_task_capsule_recording_service_conflict');
  }
  return event;
}

function taskCapsuleUpdateFromEvent(event) {
  const payload = event.payload;
  return createBuilderTaskCapsuleUpdate({
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    turn_id: payload.turn_id,
    run_id: payload.run_id,
    message_id: payload.message_id,
    route_decision_id: payload.task_capsule.last_route_decision_id,
    task_capsule: payload.task_capsule,
    updated_at_ms: payload.task_capsule.updated_at_ms,
  });
}

function recordTaskCapsuleFromConversation(services, rawRequest) {
  const request = safeRequest(rawRequest);
  const replay = replayBuilderConversation(request.events);
  if (replay.event_count < request.target_sequence) {
    fail('builder_task_capsule_recording_service_conflict');
  }
  const event = targetTaskBriefEvent(request.events, request.target_sequence);
  const update = taskCapsuleUpdateFromEvent(event);
  const storeResult = services.task_capsule_store.record_task_capsule_update({
    task_capsule_update: update,
  });
  const readback = services.task_capsule_store.read_task_capsule_update({
    project_id: update.project_id,
    update_id: update.update_id,
  });
  const latest = services.task_capsule_store.read_latest_task_capsule({
    project_id: update.project_id,
  });
  if (
    readback.status !== 'ready'
    || readback.task_capsule_update.task_capsule_update.update_id !== update.update_id
    || latest.status !== 'ready'
    || latest.task_capsule_update.task_capsule_update.project_id !== update.project_id
  ) fail('builder_task_capsule_recording_service_conflict');
  return freezeDeep({
    result_version: BUILDER_TASK_CAPSULE_RECORDING_RESULT_VERSION,
    service_version: BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION,
    operation: 'task_capsule_update_recorded_from_conversation',
    status: 'ready',
    project_id: update.project_id,
    conversation_id: update.conversation_id,
    target_sequence: request.target_sequence,
    task_id: update.task_capsule.task_id,
    update_id: update.update_id,
    task_capsule_update: update,
    store_result: {
      result_version: storeResult.result_version,
      operation: storeResult.operation,
    },
    readback,
    latest,
    evidence: evidence(storeResult.operation),
  });
}

function createBuilderTaskCapsuleRecordingService(rawServices) {
  const services = safeServices(rawServices);
  return freezeDeep({
    service_version: BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION,

    record_task_capsule_from_conversation(rawRequest) {
      try { return recordTaskCapsuleFromConversation(services, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_TASK_CAPSULE_RECORDING_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_RECORDING_SERVICE_VERSION,
  BuilderTaskCapsuleRecordingServiceError,
  createBuilderTaskCapsuleRecordingService,
});
