'use strict';

const { types: utilTypes } = require('node:util');

const {
  MAX_EVENT_RECORD_BYTES,
  sanitizeBuilderConversationEvent,
  serializeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');

const BUILDER_CONVERSATION_AUTHORITY_CONTRACT_VERSION =
  'builder-conversation-authority-contract.v1';
const BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION =
  'builder-conversation-authority-result.v1';
const MAX_APPEND_EVENTS = 4;
const MAX_CONVERSATION_EVENTS = 1_024;
const MAX_CONVERSATION_BYTES = 24 * 1_024 * 1_024;

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderConversationAuthorityContractError extends Error {
  constructor() {
    super('Builder conversation authority input could not be verified.');
    this.name = 'BuilderConversationAuthorityContractError';
    this.code = 'builder_conversation_authority_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderConversationAuthorityContractError();
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeEventId(value) {
  return safePattern(value, EVENT_ID_PATTERN, 128);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value, allowZero = false) {
  const minimum = allowZero ? 0 : 1;
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > MAX_CONVERSATION_EVENTS
  ) fail();
  return value;
}

function sanitizeProject(value) {
  exactObject(value, ['project_id', 'created_at_ms']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeConversation(value) {
  exactObject(value, ['project_id', 'conversation_id', 'created_at_ms']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeHead(value) {
  if (value === null) return null;
  exactObject(value, ['sequence', 'event_id', 'event_digest']);
  return freezeDeep({
    sequence: safeSequence(valueAt(value, 'sequence')),
    event_id: safeEventId(valueAt(value, 'event_id')),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  });
}

function assertDenseEvents(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < 1
    || value.length > MAX_APPEND_EVENTS
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => (
      typeof key === 'symbol'
      || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))
    ))
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function eventHead(event) {
  return freezeDeep({
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  });
}

function sameHead(left, right) {
  if (left === null || right === null) return left === right;
  return left.sequence === right.sequence
    && left.event_id === right.event_id
    && left.event_digest === right.event_digest;
}

function sanitizeEvents(value, project, conversation, expectedHead) {
  assertDenseEvents(value);
  const events = value.map((event) => {
    try {
      return sanitizeBuilderConversationEvent(event);
    } catch {
      fail();
    }
  });
  let previous = expectedHead;
  for (const event of events) {
    if (
      event.project_id !== project.project_id
      || event.project_id !== conversation.project_id
      || event.conversation_id !== conversation.conversation_id
      || event.sequence !== (previous === null ? 1 : previous.sequence + 1)
      || !sameHead(event.previous_event, previous)
      || event.sequence > MAX_CONVERSATION_EVENTS
    ) fail();
    const serialized = serializeBuilderConversationEvent(event);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_RECORD_BYTES) fail();
    previous = eventHead(event);
  }
  return freezeDeep(events);
}

function sanitizeAppendConversationEventsRequest(value) {
  exactObject(value, [
    'project',
    'conversation',
    'expected_head',
    'events',
    'recorded_at_ms',
  ]);
  const project = sanitizeProject(valueAt(value, 'project'));
  const conversation = sanitizeConversation(valueAt(value, 'conversation'));
  const expectedHead = sanitizeHead(valueAt(value, 'expected_head'));
  if (
    conversation.project_id !== project.project_id
    || conversation.conversation_id.slice('builder-conversation:'.length)
      !== project.project_id.slice('builder-project:'.length)
    || conversation.created_at_ms < project.created_at_ms
  ) fail();
  const events = sanitizeEvents(
    valueAt(value, 'events'),
    project,
    conversation,
    expectedHead,
  );
  return freezeDeep({
    project,
    conversation,
    expected_head: expectedHead,
    events,
    recorded_at_ms: safeTimestamp(valueAt(value, 'recorded_at_ms')),
  });
}

function sanitizeLoadConversationRequest(value) {
  exactObject(value, ['project_id', 'conversation_id']);
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'));
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
  });
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderConversationAuthorityContractError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_CONVERSATION_AUTHORITY_CONTRACT_VERSION,
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  MAX_APPEND_EVENTS,
  MAX_CONVERSATION_EVENTS,
  MAX_CONVERSATION_BYTES,
  BuilderConversationAuthorityContractError,
  eventHead: safeBoundary(eventHead),
  sanitizeAppendConversationEventsRequest: safeBoundary(sanitizeAppendConversationEventsRequest),
  sanitizeLoadConversationRequest: safeBoundary(sanitizeLoadConversationRequest),
});
