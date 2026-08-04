'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,
  BuilderAgentStepProgressReadServiceError,
} = require('./builder-agent-step-progress-read-service.cjs');
const {
  BuilderAgentStepProgressConversationAdmissionError,
  createBuilderAgentStepProgressConversationAdmission,
} = require('./builder-agent-step-progress-conversation-admission.cjs');
const {
  BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
  BuilderConversationMainServiceError,
} = require('./builder-conversation-main-service.cjs');

const BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION =
  'builder-agent-step-progress-conversation-recording-service.v1';
const BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_RESULT_VERSION =
  'builder-agent-step-progress-conversation-recording-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const SERVICE_KEYS = Object.freeze([
  'conversation_service',
  'step_progress_read_service',
]);
const REQUEST_KEYS = Object.freeze([
  'context',
  'owner_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'step_index',
  'recorded_state',
  'admitted_at_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_progress_conversation_recording_service_invalid:
    'Builder agent progress could not be recorded.',
  builder_agent_step_progress_conversation_recording_service_conflict:
    'Builder agent progress is not current.',
  builder_agent_step_progress_conversation_recording_service_unavailable:
    'Builder agent progress recording is unavailable.',
});

class BuilderAgentStepProgressConversationRecordingServiceError extends Error {
  constructor(code = 'builder_agent_step_progress_conversation_recording_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_step_progress_conversation_recording_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentStepProgressConversationRecordingServiceError';
    this.code = selected;
    this.retryable = selected === 'builder_agent_step_progress_conversation_recording_service_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_agent_step_progress_conversation_recording_service_invalid') {
  throw new BuilderAgentStepProgressConversationRecordingServiceError(code);
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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
  return descriptor.value;
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
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) {
    fail();
  }
  return conversationId;
}

function safeStepIndex(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9_999_999_999_999) fail();
  return value;
}

function safeRecordedState(value) {
  if (value !== 'start_recorded' && value !== 'result_recorded') fail();
  return value;
}

function method(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail();
  }
  return descriptor.value.bind(value);
}

function service(value, version, methodName) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, 'service_version');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== version) fail();
  return freezeDeep({
    service_version: version,
    [methodName]: method(value, methodName),
  });
}

function safeServices(rawServices) {
  exactObject(rawServices, SERVICE_KEYS);
  return freezeDeep({
    conversation_service: service(
      valueAt(rawServices, 'conversation_service'),
      BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
      'record_agent_step_progress',
    ),
    step_progress_read_service: service(
      valueAt(rawServices, 'step_progress_read_service'),
      BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,
      'read_agent_step_progress',
    ),
  });
}

function safeRequest(rawRequest) {
  exactObject(rawRequest, REQUEST_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  return freezeDeep({
    context: valueAt(rawRequest, 'context'),
    owner_id: safePattern(valueAt(rawRequest, 'owner_id'), OWNER_ID_PATTERN),
    project_id: projectId,
    conversation_id: safeConversationId(valueAt(rawRequest, 'conversation_id'), projectId),
    turn_id: safePattern(valueAt(rawRequest, 'turn_id'), TURN_ID_PATTERN),
    task_id: safePattern(valueAt(rawRequest, 'task_id'), TASK_ID_PATTERN),
    run_id: safePattern(valueAt(rawRequest, 'run_id'), RUN_ID_PATTERN),
    step_id: safePattern(valueAt(rawRequest, 'step_id'), STEP_ID_PATTERN),
    step_index: safeStepIndex(valueAt(rawRequest, 'step_index')),
    recorded_state: safeRecordedState(valueAt(rawRequest, 'recorded_state')),
    admitted_at_ms: safeTimestamp(valueAt(rawRequest, 'admitted_at_ms')),
  });
}

function evidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_step_progress_conversation_recording_service',
    read_service_authority: 'main_owned_agent_step_progress_read_service',
    admission_authority: 'main_agent_step_progress_conversation_admission_contract_v1',
    conversation_service_authority: 'builder_conversation_main_service_v1',
    conversation_event: 'agent_step_progress_recorded',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_output_storage: false,
    raw_context_storage: false,
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentStepProgressConversationRecordingServiceError) {
    return new BuilderAgentStepProgressConversationRecordingServiceError(error.code);
  }
  if (error instanceof BuilderAgentStepProgressReadServiceError) {
    return new BuilderAgentStepProgressConversationRecordingServiceError(
      error.retryable
        ? 'builder_agent_step_progress_conversation_recording_service_unavailable'
        : 'builder_agent_step_progress_conversation_recording_service_invalid',
    );
  }
  if (error instanceof BuilderAgentStepProgressConversationAdmissionError) {
    return new BuilderAgentStepProgressConversationRecordingServiceError(
      'builder_agent_step_progress_conversation_recording_service_invalid',
    );
  }
  if (error instanceof BuilderConversationMainServiceError) {
    return new BuilderAgentStepProgressConversationRecordingServiceError(
      'builder_agent_step_progress_conversation_recording_service_conflict',
    );
  }
  return new BuilderAgentStepProgressConversationRecordingServiceError(
    'builder_agent_step_progress_conversation_recording_service_unavailable',
  );
}

function recordAgentStepProgress(services, rawRequest) {
  const request = safeRequest(rawRequest);
  const readResult = services.step_progress_read_service.read_agent_step_progress({
    owner_id: request.owner_id,
    project_id: request.project_id,
    task_id: request.task_id,
    run_id: request.run_id,
  });
  if (readResult.status !== 'ready') {
    fail('builder_agent_step_progress_conversation_recording_service_conflict');
  }
  const admission = createBuilderAgentStepProgressConversationAdmission({
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    turn_id: request.turn_id,
    task_id: request.task_id,
    run_id: request.run_id,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    read_result: readResult,
    step_id: request.step_id,
    step_index: request.step_index,
    recorded_state: request.recorded_state,
    admitted_at_ms: request.admitted_at_ms,
  });
  const context = services.conversation_service.record_agent_step_progress({
    context: request.context,
    progress_admission: admission,
  });
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_RESULT_VERSION,
    service_version: BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION,
    operation: 'agent_step_progress_conversation_recorded',
    status: 'ready',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    turn_id: request.turn_id,
    task_id: request.task_id,
    run_id: request.run_id,
    step_id: request.step_id,
    step_index: request.step_index,
    recorded_state: request.recorded_state,
    context,
    evidence: evidence(),
  });
}

function createBuilderAgentStepProgressConversationRecordingService(rawServices) {
  const services = safeServices(rawServices);
  return freezeDeep({
    service_version: BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION,

    record_agent_step_progress(rawRequest) {
      try { return recordAgentStepProgress(services, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_RESULT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_CONVERSATION_RECORDING_SERVICE_VERSION,
  BuilderAgentStepProgressConversationRecordingServiceError,
  createBuilderAgentStepProgressConversationRecordingService,
});
