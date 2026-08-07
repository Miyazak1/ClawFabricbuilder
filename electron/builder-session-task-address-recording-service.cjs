'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const SERVICE_VERSION = 'builder-session-task-address-recording-service.v1';
const OPTION_KEYS = Object.freeze(['address_store', 'create_uuid', 'now_ms', 'created_by', 'agent_id']);
const RECORD_CONTEXT_KEYS = Object.freeze(['context']);
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
const HEAD_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
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
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const MAX_CONTEXT_EVENT_WINDOW = 512;
const ERROR_MESSAGE = 'Builder session and task address recording could not be verified.';

class BuilderSessionTaskAddressRecordingServiceError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderSessionTaskAddressRecordingServiceError';
    this.code = 'builder_session_task_address_recording_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderSessionTaskAddressRecordingServiceError();
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

function safeCreatedBy(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 80
    || value.trim() !== value
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function safeUuid(value) {
  return safePattern(value, UUID_PATTERN);
}

function safeText(value, maximum, fallback) {
  if (typeof value !== 'string' || hasControlCharacter(value)) fail();
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.length <= maximum) return trimmed;
  const shortened = trimmed.slice(0, maximum).trim();
  return shortened.length === 0 ? fallback : shortened;
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function displayIdFromUuid(uuid) {
  return `S-${uuid.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function denseEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < 2
    || value.length > MAX_CONTEXT_EVENT_WINDOW
  ) fail();
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

function beginContext(value) {
  exactObject(value, CONTEXT_KEYS);
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
  exactObject(valueAt(value, 'start_head'), HEAD_KEYS);
  const projectId = safePattern(valueAt(project, 'project_id'), PROJECT_ID_PATTERN);
  safeTimestamp(valueAt(project, 'created_at_ms'));
  if (safePattern(valueAt(conversation, 'project_id'), PROJECT_ID_PATTERN) !== projectId) fail();
  const conversationId = safePattern(valueAt(conversation, 'conversation_id'), CONVERSATION_ID_PATTERN);
  const createdAtMs = safeTimestamp(valueAt(conversation, 'created_at_ms'));
  const turnId = safePattern(valueAt(ids, 'turn_id'), TURN_ID_PATTERN);
  const taskId = safePattern(valueAt(ids, 'task_id'), TASK_ID_PATTERN);
  const runId = safePattern(valueAt(ids, 'run_id'), RUN_ID_PATTERN);
  const messageId = safePattern(valueAt(ids, 'message_id'), MESSAGE_ID_PATTERN);
  const events = denseEvents(valueAt(value, 'events'));
  const reversedEvents = [...events].reverse();
  const turnEvent = reversedEvents
    .find((event) => valueAt(event, 'event_type') === 'turn_submitted') ?? null;
  const runEvent = reversedEvents
    .find((event) => valueAt(event, 'event_type') === 'run_started') ?? null;
  if (turnEvent === null || runEvent === null) fail();
  if (
    valueAt(turnEvent, 'project_id') !== projectId
    || valueAt(turnEvent, 'conversation_id') !== conversationId
    || valueAt(runEvent, 'project_id') !== projectId
    || valueAt(runEvent, 'conversation_id') !== conversationId
  ) fail();
  const turnPayload = valueAt(turnEvent, 'payload');
  const runPayload = valueAt(runEvent, 'payload');
  exactObject(turnPayload, TURN_PAYLOAD_KEYS);
  exactObject(runPayload, RUN_PAYLOAD_KEYS);
  if (valueAt(turnPayload, 'turn_id') !== turnId || valueAt(turnPayload, 'mode') !== 'work') fail();
  const message = valueAt(turnPayload, 'message');
  const task = valueAt(turnPayload, 'task');
  exactObject(message, MESSAGE_KEYS);
  exactObject(task, TASK_KEYS);
  if (
    valueAt(message, 'message_id') !== messageId
    || valueAt(task, 'task_id') !== taskId
    || valueAt(runPayload, 'turn_id') !== turnId
    || valueAt(runPayload, 'run_id') !== runId
    || valueAt(runPayload, 'task_id') !== taskId
    || valueAt(runPayload, 'attempt_number') !== 1
    || valueAt(runPayload, 'retry_of_run_id') !== null
    || valueAt(runPayload, 'input_digest') !== valueAt(value, 'request_digest')
  ) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    conversation_created_at_ms: createdAtMs,
    turn_id: turnId,
    run_id: runId,
    low_level_task_id: taskId,
    message_id: messageId,
    message_text: valueAt(message, 'text'),
    task_title: valueAt(task, 'title'),
  });
}

function createBuilderSessionTaskAddressRecordingService(rawOptions) {
  exactObject(rawOptions, OPTION_KEYS);
  const addressStore = valueAt(rawOptions, 'address_store');
  const recordSessionAddress = stableMethod(addressStore, 'record_session_address');
  const recordTaskAddress = stableMethod(addressStore, 'record_task_address');
  const createUuid = valueAt(rawOptions, 'create_uuid');
  const nowMs = valueAt(rawOptions, 'now_ms');
  if (typeof createUuid !== 'function' || typeof nowMs !== 'function') fail();
  const createdBy = safeCreatedBy(valueAt(rawOptions, 'created_by'));
  const agentId = safePattern(valueAt(rawOptions, 'agent_id'), AGENT_ID_PATTERN);

  return freezeDeep({
    service_version: SERVICE_VERSION,
    record_addresses_from_conversation_context(rawRequest) {
      exactObject(rawRequest, RECORD_CONTEXT_KEYS);
      const context = beginContext(valueAt(rawRequest, 'context'));
      const sessionUuid = safeUuid(Reflect.apply(createUuid, undefined, []));
      const taskAddressUuid = safeUuid(Reflect.apply(createUuid, undefined, []));
      const recordedAtMs = safeTimestamp(Reflect.apply(nowMs, undefined, []));
      if (recordedAtMs < context.conversation_created_at_ms) fail();
      const taskAddressId = `builder-task-address:${taskAddressUuid}`;
      const sessionAddress = sanitizeBuilderSessionAddress(createBuilderSessionAddress({
        session_id: `builder-session:${sessionUuid}`,
        project_id: context.project_id,
        display_id: displayIdFromUuid(sessionUuid),
        title: safeText(context.task_title, 160, 'Builder work session'),
        status: 'active',
        root_conversation_id: context.conversation_id,
        current_task_id: taskAddressId,
        parent_session_id: null,
        forked_from_session_id: null,
        forked_from_revision_receipt_digest: null,
        created_by: createdBy,
        created_at_ms: recordedAtMs,
        updated_at_ms: recordedAtMs,
        archived_at_ms: null,
      }));
      const taskAddress = sanitizeBuilderTaskAddress(createBuilderTaskAddress({
        task_address_id: taskAddressId,
        session_id: sessionAddress.session_id,
        project_id: context.project_id,
        agent_id: agentId,
        parent_task_address_id: null,
        conversation_id: context.conversation_id,
        title: safeText(context.task_title, 160, 'Builder work task'),
        goal: safeText(context.message_text, 2048, 'Continue the requested Builder work.'),
        status: 'active',
        current_brief_id: null,
        current_plan_id: null,
        base_revision_receipt_digest: null,
        produced_revision_receipt_digest: null,
        created_by: createdBy,
        created_at_ms: recordedAtMs,
        updated_at_ms: recordedAtMs,
        closed_at_ms: null,
      }));
      const sessionResult = Reflect.apply(recordSessionAddress, addressStore, [{
        session_address: sessionAddress,
      }]);
      const taskResult = Reflect.apply(recordTaskAddress, addressStore, [{
        task_address: taskAddress,
      }]);
      return freezeDeep({
        result_version: 'builder-session-task-address-recording-result.v1',
        operation: 'session_task_addresses_recorded',
        project_id: context.project_id,
        conversation_id: context.conversation_id,
        turn_id: context.turn_id,
        run_id: context.run_id,
        low_level_task_id: context.low_level_task_id,
        session_address: sessionResult.session_address,
        task_address: taskResult.task_address,
        authority: {
          address_recording: 'main_owned_from_conversation_context',
          renderer_authority: 'not_present',
          ipc_authority: 'not_present',
          conversation_append: false,
          provider_dispatch: false,
          source_mutation: false,
          git_mutation: false,
          permission_grant: false,
          migration: false,
          archive_delete_fork_export: false,
        },
      });
    },
  });
}

module.exports = Object.freeze({
  BuilderSessionTaskAddressRecordingServiceError,
  SERVICE_VERSION,
  createBuilderSessionTaskAddressRecordingService,
});
