'use strict';

const { types: utilTypes } = require('node:util');

const SERVICE_VERSION = 'builder-session-task-address-binding-service.v1';
const RESULT_VERSION = 'builder-session-task-address-binding-result.v1';
const OPTION_KEYS = Object.freeze(['address_store']);
const BIND_QUEUED_FOLLOWUP_KEYS = Object.freeze(['context', 'queued_followup']);
const BIND_APPROVED_PLAN_CONTINUATION_KEYS = Object.freeze([
  'context',
  'approved_plan_continuation',
]);
const BIND_DRAFT_CONTINUATION_KEYS = Object.freeze([
  'context',
  'draft_continuation',
]);
const CONTEXT_KEYS = Object.freeze([
  'context_version',
  'mode',
  'project',
  'conversation',
  'request_digest',
  'start_head',
  'attempt_number',
  'events',
  'run_terminal_failure_code',
  'ids',
  'cancel_requested',
]);
const DRAFT_CONTINUATION_CONTEXT_KEYS = Object.freeze([...CONTEXT_KEYS, 'draft_continuation']);
const PROJECT_KEYS = Object.freeze(['project_id', 'created_at_ms']);
const CONVERSATION_KEYS = Object.freeze(['project_id', 'conversation_id', 'created_at_ms']);
const IDS_KEYS = Object.freeze([
  'turn_command_id',
  'run_command_id',
  'terminal_command_id',
  'turn_terminal_command_id',
  'cancel_command_id',
  'cancel_request_id',
  'interrupt_command_id',
  'interrupt_request_id',
  'message_id',
  'assistant_message_id',
  'turn_id',
  'task_id',
  'run_id',
]);
const EVENT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'event_id',
  'project_id',
  'conversation_id',
  'sequence',
  'command_id',
  'event_type',
  'previous_event',
  'payload',
  'authority',
  'command_digest',
  'event_digest',
]);
const QUEUED_FOLLOWUP_KEYS = Object.freeze(['turn_id', 'run_id', 'message_id']);
const APPROVED_PLAN_CONTINUATION_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'approved_plan_turn_id',
  'approved_plan_task_id',
  'approved_plan_run_id',
  'continuation_id',
  'continuation_admission_digest',
]);
const DRAFT_CONTINUATION_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'draft_id',
  'previous_turn_id',
  'previous_task_id',
  'previous_run_id',
  'continuation_id',
  'admission_digest',
  'candidate_digest',
]);
const FOLLOWUP_CONSUMED_PAYLOAD_KEYS = Object.freeze([
  'turn_id',
  'run_id',
  'message_id',
  'consuming_turn_id',
  'consuming_message_id',
]);
const DRAFT_CONTINUATION_CONTEXT_PAYLOAD_KEYS = Object.freeze([
  'admission_digest',
  'draft_id',
  'previous_turn_id',
  'previous_task_id',
  'previous_run_id',
  'previous_candidate_digest',
]);
const TURN_PAYLOAD_KEYS = Object.freeze(['message', 'turn_id', 'mode', 'task', 'base_revision', 'route_decision']);
const MESSAGE_KEYS = Object.freeze(['message_id', 'text']);
const TASK_KEYS = Object.freeze(['task_id', 'title']);
const RUN_PAYLOAD_KEYS = Object.freeze([
  'turn_id',
  'run_id',
  'task_id',
  'attempt_number',
  'retry_of_run_id',
  'input_digest',
]);
const ADDRESS_STORE_READ_KEYS = Object.freeze([
  'result_version',
  'status',
  'session_address',
  'task_address',
  'address_evidence',
]);
const ADDRESS_RECORD_KEYS = Object.freeze(['session_address']);
const TASK_RECORD_KEYS = Object.freeze(['task_address']);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const APPROVED_PLAN_CONTINUATION_ID_PATTERN = new RegExp(
  `^builder-approved-plan-continuation:${UUID_SOURCE}$`,
  'u',
);
const DRAFT_CONTINUATION_ID_PATTERN = new RegExp(`^builder-draft-continuation:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ERROR_MESSAGE = 'Builder session and task address binding could not be verified.';

class BuilderSessionTaskAddressBindingServiceError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderSessionTaskAddressBindingServiceError';
    this.code = 'builder_session_task_address_binding_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderSessionTaskAddressBindingServiceError();
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

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function denseEvents(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 2 || value.length > 128) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => typeof key === 'symbol')
    || !keys.includes('length')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    events.push(eventRecord(descriptor.value));
  }
  return events;
}

function eventRecord(value) {
  exactObject(value, EVENT_KEYS);
  return value;
}

function queuedFollowupReference(value) {
  exactObject(value, QUEUED_FOLLOWUP_KEYS);
  return freezeDeep({
    turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
    run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
    message_id: safePattern(valueAt(value, 'message_id'), MESSAGE_ID_PATTERN),
  });
}

function approvedPlanContinuationReference(value) {
  exactObject(value, APPROVED_PLAN_CONTINUATION_KEYS);
  return freezeDeep({
    project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
    approved_plan_turn_id: safePattern(valueAt(value, 'approved_plan_turn_id'), TURN_ID_PATTERN),
    approved_plan_task_id: safePattern(valueAt(value, 'approved_plan_task_id'), TASK_ID_PATTERN),
    approved_plan_run_id: safePattern(valueAt(value, 'approved_plan_run_id'), RUN_ID_PATTERN),
    continuation_id: safePattern(
      valueAt(value, 'continuation_id'),
      APPROVED_PLAN_CONTINUATION_ID_PATTERN,
    ),
    continuation_admission_digest: safePattern(valueAt(value, 'continuation_admission_digest'), DIGEST_PATTERN),
  });
}

function draftContinuationReference(value) {
  exactObject(value, DRAFT_CONTINUATION_KEYS);
  return freezeDeep({
    project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
    draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
    previous_turn_id: safePattern(valueAt(value, 'previous_turn_id'), TURN_ID_PATTERN),
    previous_task_id: safePattern(valueAt(value, 'previous_task_id'), TASK_ID_PATTERN),
    previous_run_id: safePattern(valueAt(value, 'previous_run_id'), RUN_ID_PATTERN),
    continuation_id: safePattern(valueAt(value, 'continuation_id'), DRAFT_CONTINUATION_ID_PATTERN),
    admission_digest: safePattern(valueAt(value, 'admission_digest'), DIGEST_PATTERN),
    candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
  });
}

function baseWorkContext(value) {
  const actualKeys = Reflect.ownKeys(value);
  exactObject(
    value,
    actualKeys.includes('draft_continuation') ? DRAFT_CONTINUATION_CONTEXT_KEYS : CONTEXT_KEYS,
  );
  if (valueAt(value, 'context_version') !== 'builder-conversation-run-context.v1') fail();
  if (valueAt(value, 'mode') !== 'work') fail();
  if (valueAt(value, 'run_terminal_failure_code') !== null || valueAt(value, 'cancel_requested') !== false) fail();
  if (valueAt(value, 'attempt_number') !== 1) fail();
  const project = valueAt(value, 'project');
  const conversation = valueAt(value, 'conversation');
  const ids = valueAt(value, 'ids');
  exactObject(project, PROJECT_KEYS);
  exactObject(conversation, CONVERSATION_KEYS);
  exactObject(ids, IDS_KEYS);
  const projectId = safePattern(valueAt(project, 'project_id'), PROJECT_ID_PATTERN);
  safeTimestamp(valueAt(project, 'created_at_ms'));
  if (safePattern(valueAt(conversation, 'project_id'), PROJECT_ID_PATTERN) !== projectId) fail();
  const conversationId = safePattern(valueAt(conversation, 'conversation_id'), CONVERSATION_ID_PATTERN);
  safeTimestamp(valueAt(conversation, 'created_at_ms'));
  const turnId = safePattern(valueAt(ids, 'turn_id'), TURN_ID_PATTERN);
  const taskId = safePattern(valueAt(ids, 'task_id'), TASK_ID_PATTERN);
  const runId = safePattern(valueAt(ids, 'run_id'), RUN_ID_PATTERN);
  const messageId = safePattern(valueAt(ids, 'message_id'), MESSAGE_ID_PATTERN);
  const events = denseEvents(valueAt(value, 'events'));
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    run_id: runId,
    low_level_task_id: taskId,
    message_id: messageId,
    events,
    request_digest: safePattern(valueAt(value, 'request_digest'), DIGEST_PATTERN),
  });
}

function queuedWorkContext(value, queuedFollowup) {
  const context = baseWorkContext(value);
  const events = context.events;
  const consumed = events.filter((event) => valueAt(event, 'event_type') === 'turn_followup_consumed');
  if (consumed.length !== 1) fail();
  const payload = valueAt(consumed[0], 'payload');
  exactObject(payload, FOLLOWUP_CONSUMED_PAYLOAD_KEYS);
  if (
    valueAt(consumed[0], 'project_id') !== context.project_id
    || valueAt(consumed[0], 'conversation_id') !== context.conversation_id
    || valueAt(payload, 'turn_id') !== queuedFollowup.turn_id
    || valueAt(payload, 'run_id') !== queuedFollowup.run_id
    || valueAt(payload, 'message_id') !== queuedFollowup.message_id
    || valueAt(payload, 'consuming_turn_id') !== context.turn_id
    || valueAt(payload, 'consuming_message_id') !== context.message_id
  ) fail();
  return freezeDeep({
    project_id: context.project_id,
    conversation_id: context.conversation_id,
    turn_id: context.turn_id,
    run_id: context.run_id,
    low_level_task_id: context.low_level_task_id,
    message_id: context.message_id,
  });
}

function startedWorkContext(value, continuationReference) {
  const context = baseWorkContext(value);
  if (
    context.project_id !== continuationReference.project_id
    || context.conversation_id !== continuationReference.conversation_id
  ) fail();
  const reversedEvents = [...context.events].reverse();
  const turnEvent = reversedEvents.find((event) => valueAt(event, 'event_type') === 'turn_submitted') ?? null;
  const runEvent = reversedEvents.find((event) => valueAt(event, 'event_type') === 'run_started') ?? null;
  if (turnEvent === null || runEvent === null) fail();
  if (
    valueAt(turnEvent, 'project_id') !== context.project_id
    || valueAt(turnEvent, 'conversation_id') !== context.conversation_id
    || valueAt(runEvent, 'project_id') !== context.project_id
    || valueAt(runEvent, 'conversation_id') !== context.conversation_id
  ) fail();
  const turnPayload = valueAt(turnEvent, 'payload');
  const runPayload = valueAt(runEvent, 'payload');
  exactObject(turnPayload, TURN_PAYLOAD_KEYS);
  exactObject(runPayload, RUN_PAYLOAD_KEYS);
  const message = valueAt(turnPayload, 'message');
  const task = valueAt(turnPayload, 'task');
  exactObject(message, MESSAGE_KEYS);
  exactObject(task, TASK_KEYS);
  if (
    valueAt(turnPayload, 'turn_id') !== context.turn_id
    || valueAt(turnPayload, 'mode') !== 'work'
    || valueAt(message, 'message_id') !== context.message_id
    || valueAt(task, 'task_id') !== context.low_level_task_id
    || valueAt(runPayload, 'turn_id') !== context.turn_id
    || valueAt(runPayload, 'run_id') !== context.run_id
    || valueAt(runPayload, 'task_id') !== context.low_level_task_id
    || valueAt(runPayload, 'attempt_number') !== 1
    || valueAt(runPayload, 'retry_of_run_id') !== null
    || valueAt(runPayload, 'input_digest') !== context.request_digest
  ) fail();
  return freezeDeep({
    project_id: context.project_id,
    conversation_id: context.conversation_id,
    turn_id: context.turn_id,
    run_id: context.run_id,
    low_level_task_id: context.low_level_task_id,
    message_id: context.message_id,
  });
}

function approvedPlanContinuationWorkContext(value, approvedPlanContinuation) {
  return startedWorkContext(value, approvedPlanContinuation);
}

function draftContinuationWorkContext(value, draftContinuation) {
  const context = startedWorkContext(value, draftContinuation);
  const payload = valueAt(value, 'draft_continuation');
  exactObject(payload, DRAFT_CONTINUATION_CONTEXT_PAYLOAD_KEYS);
  if (
    valueAt(payload, 'admission_digest') !== draftContinuation.admission_digest
    || valueAt(payload, 'draft_id') !== draftContinuation.draft_id
    || valueAt(payload, 'previous_turn_id') !== draftContinuation.previous_turn_id
    || valueAt(payload, 'previous_task_id') !== draftContinuation.previous_task_id
    || valueAt(payload, 'previous_run_id') !== draftContinuation.previous_run_id
    || valueAt(payload, 'previous_candidate_digest') !== draftContinuation.candidate_digest
  ) fail();
  return context;
}

function addressRecord(value, key) {
  exactObject(value, key === 'session_address' ? ADDRESS_RECORD_KEYS : TASK_RECORD_KEYS);
  const body = valueAt(value, key);
  if (!isPlainObject(body)) fail();
  return value;
}

function currentAddressRead(value, projectId, conversationId) {
  exactObject(value, ADDRESS_STORE_READ_KEYS);
  if (valueAt(value, 'result_version') !== 'builder-session-task-address-store-read-result.v1') fail();
  if (valueAt(value, 'status') !== 'ready') fail();
  const session = addressRecord(valueAt(value, 'session_address'), 'session_address');
  const task = addressRecord(valueAt(value, 'task_address'), 'task_address');
  const sessionBody = valueAt(session, 'session_address');
  const taskBody = valueAt(task, 'task_address');
  if (
    safePattern(valueAt(sessionBody, 'project_id'), PROJECT_ID_PATTERN) !== projectId
    || safePattern(valueAt(taskBody, 'project_id'), PROJECT_ID_PATTERN) !== projectId
    || safePattern(valueAt(taskBody, 'conversation_id'), CONVERSATION_ID_PATTERN) !== conversationId
    || safePattern(valueAt(taskBody, 'session_id'), SESSION_ID_PATTERN)
      !== safePattern(valueAt(sessionBody, 'session_id'), SESSION_ID_PATTERN)
    || !TASK_ADDRESS_ID_PATTERN.test(valueAt(taskBody, 'task_address_id'))
  ) fail();
  return freezeDeep({
    session_address: session,
    task_address: task,
  });
}

function authority() {
  return freezeDeep({
    address_binding: 'main_owned_read_only_session_task_address_lookup',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    conversation_append: false,
    provider_dispatch: false,
    source_mutation: false,
    git_mutation: false,
    permission_grant: false,
    migration: false,
    archive_delete_fork_export: false,
  });
}

function createBuilderSessionTaskAddressBindingService(rawOptions) {
  const descriptors = exactObject(rawOptions, OPTION_KEYS);
  const addressStore = descriptors.address_store.value;
  if (!isPlainObject(addressStore)) fail();
  const readCurrent = stableMethod(addressStore, 'read_current_session_task_for_conversation');
  return freezeDeep({
    service_version: SERVICE_VERSION,
    bind_queued_followup_work_to_current_task_address(rawRequest) {
      exactObject(rawRequest, BIND_QUEUED_FOLLOWUP_KEYS);
      const queuedFollowup = queuedFollowupReference(valueAt(rawRequest, 'queued_followup'));
      const context = queuedWorkContext(valueAt(rawRequest, 'context'), queuedFollowup);
      const read = Reflect.apply(readCurrent, addressStore, [{
        project_id: context.project_id,
        conversation_id: context.conversation_id,
      }]);
      const bound = currentAddressRead(read, context.project_id, context.conversation_id);
      return freezeDeep({
        result_version: RESULT_VERSION,
        operation: 'queued_followup_work_bound',
        project_id: context.project_id,
        conversation_id: context.conversation_id,
        turn_id: context.turn_id,
        run_id: context.run_id,
        low_level_task_id: context.low_level_task_id,
        queued_followup: queuedFollowup,
        session_address: bound.session_address,
        task_address: bound.task_address,
        authority: authority(),
      });
    },
    bind_approved_plan_continuation_to_current_task_address(rawRequest) {
      exactObject(rawRequest, BIND_APPROVED_PLAN_CONTINUATION_KEYS);
      const approvedPlanContinuation = approvedPlanContinuationReference(
        valueAt(rawRequest, 'approved_plan_continuation'),
      );
      const context = approvedPlanContinuationWorkContext(
        valueAt(rawRequest, 'context'),
        approvedPlanContinuation,
      );
      const read = Reflect.apply(readCurrent, addressStore, [{
        project_id: context.project_id,
        conversation_id: context.conversation_id,
      }]);
      const bound = currentAddressRead(read, context.project_id, context.conversation_id);
      return freezeDeep({
        result_version: RESULT_VERSION,
        operation: 'approved_plan_continuation_bound',
        project_id: context.project_id,
        conversation_id: context.conversation_id,
        turn_id: context.turn_id,
        run_id: context.run_id,
        low_level_task_id: context.low_level_task_id,
        approved_plan_continuation: approvedPlanContinuation,
        session_address: bound.session_address,
        task_address: bound.task_address,
        authority: authority(),
      });
    },
    bind_draft_continuation_to_current_task_address(rawRequest) {
      exactObject(rawRequest, BIND_DRAFT_CONTINUATION_KEYS);
      const draftContinuation = draftContinuationReference(valueAt(rawRequest, 'draft_continuation'));
      const context = draftContinuationWorkContext(valueAt(rawRequest, 'context'), draftContinuation);
      const read = Reflect.apply(readCurrent, addressStore, [{
        project_id: context.project_id,
        conversation_id: context.conversation_id,
      }]);
      const bound = currentAddressRead(read, context.project_id, context.conversation_id);
      return freezeDeep({
        result_version: RESULT_VERSION,
        operation: 'draft_continuation_bound',
        project_id: context.project_id,
        conversation_id: context.conversation_id,
        turn_id: context.turn_id,
        run_id: context.run_id,
        low_level_task_id: context.low_level_task_id,
        draft_continuation: draftContinuation,
        session_address: bound.session_address,
        task_address: bound.task_address,
        authority: authority(),
      });
    },
  });
}

module.exports = Object.freeze({
  BuilderSessionTaskAddressBindingServiceError,
  RESULT_VERSION,
  SERVICE_VERSION,
  createBuilderSessionTaskAddressBindingService,
});
