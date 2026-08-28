'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION = 'builder-workbench-message-envelope.v1';
const BUILDER_WORKBENCH_THREAD_VERSION = 'builder-workbench-thread.v1';
const BUILDER_WORKBENCH_MESSAGE_STATE_VERSION = 'builder-workbench-message-state.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const WORKBENCH_ID_PATTERN = new RegExp(`^builder-agent-workbench:${UUID_SOURCE}$`, 'u');
const THREAD_ID_PATTERN = new RegExp(`^builder-workbench-thread:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const ACTION_ID_PATTERN = /^builder-workbench-action:[0-9a-f]{64}$/u;
const ATTACHMENT_ID_PATTERN = /^builder-workbench-attachment:[0-9a-f]{64}$/u;
const CONTENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){2,7}$/u;
const SCHEMA_REF_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){2,7}$/u;
const SOURCE_KINDS = Object.freeze([
  'owner',
  'local_agent',
  'project_task',
  'remote_agent',
  'channel',
  'forum',
  'collaboration',
  'plugin',
]);
const ATTENTION_VALUES = Object.freeze(['normal', 'important', 'action_required']);
const VISIBILITY_VALUES = Object.freeze(['main_stream', 'focused_only', 'silent']);
const PROVENANCE_VALUES = Object.freeze([
  'human',
  'local_system',
  'verified_remote',
  'imported',
  'untrusted',
]);
const SENSITIVITY_VALUES = Object.freeze(['public', 'local', 'private', 'secret_adjacent']);
const ADMISSION_VALUES = Object.freeze(['excluded', 'candidate', 'review_required']);
const THREAD_KINDS = Object.freeze([
  'conversation',
  'proposal_review',
  'task_report',
  'agent_direct_message',
  'channel_topic',
  'forum_topic',
  'collaboration_invitation',
  'system_incident',
]);
const ENVELOPE_KEYS = Object.freeze([
  'envelope_version',
  'message_id',
  'agent_id',
  'owner_id',
  'source',
  'address',
  'content',
  'delivery',
  'trust',
  'attachment_refs',
  'proposed_action_refs',
  'created_at_ms',
  'received_at_ms',
]);
const SOURCE_KEYS = Object.freeze([
  'source_kind',
  'source_id',
  'connector_id',
  'actor_id',
  'external_message_id',
]);
const ADDRESS_KEYS = Object.freeze([
  'workbench_id',
  'thread_id',
  'reply_route_id',
  'project_id',
  'task_address_id',
]);
const CONTENT_KEYS = Object.freeze([
  'content_type',
  'schema_ref',
  'schema_version',
  'payload',
  'fallback_text',
]);
const DELIVERY_KEYS = Object.freeze([
  'attention',
  'visibility',
  'dedupe_key',
  'source_sequence',
]);
const TRUST_KEYS = Object.freeze([
  'provenance',
  'sensitivity',
  'prompt_admission',
  'memory_admission',
]);
const THREAD_KEYS = Object.freeze([
  'thread_version',
  'thread_id',
  'agent_id',
  'owner_id',
  'thread_kind',
  'title',
  'created_at_ms',
  'updated_at_ms',
]);
const STATE_KEYS = Object.freeze([
  'state_version',
  'message_id',
  'read_at_ms',
  'acknowledged_at_ms',
  'archived_at_ms',
  'muted',
  'saved',
  'selected_reaction',
  'updated_at_ms',
]);
const MAX_TEXT_CODE_POINTS = 12_000;
const MAX_TEXT_BYTES = 48_000;
const MAX_PAYLOAD_BYTES = 64_000;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_KEYS = 128;
const MAX_ARRAY_ITEMS = 128;

class BuilderWorkbenchMessageContractError extends Error {
  constructor() {
    super('Builder Workbench message could not be verified.');
    this.name = 'BuilderWorkbenchMessageContractError';
    this.code = 'builder_workbench_message_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkbenchMessageContractError();
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeEnum(value, values) {
  if (!values.includes(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeNullableTimestamp(value) {
  return value === null ? null : safeTimestamp(value);
}

function safeText(value, maximumCodePoints = MAX_TEXT_CODE_POINTS, maximumBytes = MAX_TEXT_BYTES) {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || [...value].length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if ((codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) || codePoint === 127) fail();
  }
  return value;
}

function safeNullableText(value, maximumCodePoints = 512, maximumBytes = 2048) {
  return value === null ? null : safeText(value, maximumCodePoints, maximumBytes);
}

function safeLooseId(value) {
  if (
    typeof value !== 'string'
    || value.length < 3
    || value.length > 240
    || !/^[A-Za-z0-9][A-Za-z0-9:._/@+-]*$/u.test(value)
  ) fail();
  return value;
}

function jsonValue(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) fail();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail();
    return value;
  }
  if (Array.isArray(value)) {
    if (utilTypes.isProxy(value) || value.length > MAX_ARRAY_ITEMS) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1
      || keys.some((key) => typeof key === 'symbol')
      || !keys.includes('length')
    ) fail();
    return value.map((item) => jsonValue(item, depth + 1));
  }
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_JSON_KEYS || keys.some((key) => typeof key !== 'string')) fail();
  const output = {};
  for (const key of keys.sort()) {
    if (key.length === 0 || key.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    output[key] = jsonValue(descriptor.value, depth + 1);
  }
  return output;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
  ).join(',')}}`;
}

function safeRefArray(value, pattern, maximum = 16) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const refs = value.map((item) => safePattern(item, pattern));
  if (new Set(refs).size !== refs.length) fail();
  return refs;
}

function sanitizeBuilderWorkbenchThread(raw) {
  const descriptors = exactObject(raw, THREAD_KEYS);
  if (descriptors.thread_version.value !== BUILDER_WORKBENCH_THREAD_VERSION) fail();
  const createdAtMs = safeTimestamp(descriptors.created_at_ms.value);
  const updatedAtMs = safeTimestamp(descriptors.updated_at_ms.value);
  if (updatedAtMs < createdAtMs) fail();
  return freezeDeep({
    thread_version: BUILDER_WORKBENCH_THREAD_VERSION,
    thread_id: safePattern(descriptors.thread_id.value, THREAD_ID_PATTERN),
    agent_id: safePattern(descriptors.agent_id.value, AGENT_ID_PATTERN),
    owner_id: safePattern(descriptors.owner_id.value, OWNER_ID_PATTERN),
    thread_kind: safeEnum(descriptors.thread_kind.value, THREAD_KINDS),
    title: safeText(descriptors.title.value, 160, 640),
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
  });
}

function sanitizeBuilderWorkbenchMessageState(raw) {
  const descriptors = exactObject(raw, STATE_KEYS);
  if (descriptors.state_version.value !== BUILDER_WORKBENCH_MESSAGE_STATE_VERSION) fail();
  const updatedAtMs = safeTimestamp(descriptors.updated_at_ms.value);
  const readAtMs = safeNullableTimestamp(descriptors.read_at_ms.value);
  const acknowledgedAtMs = safeNullableTimestamp(descriptors.acknowledged_at_ms.value);
  const archivedAtMs = safeNullableTimestamp(descriptors.archived_at_ms.value);
  if ([readAtMs, acknowledgedAtMs, archivedAtMs].some((value) => value !== null && value > updatedAtMs)) fail();
  if (typeof descriptors.muted.value !== 'boolean' || typeof descriptors.saved.value !== 'boolean') fail();
  return freezeDeep({
    state_version: BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
    message_id: safePattern(descriptors.message_id.value, MESSAGE_ID_PATTERN),
    read_at_ms: readAtMs,
    acknowledged_at_ms: acknowledgedAtMs,
    archived_at_ms: archivedAtMs,
    muted: descriptors.muted.value,
    saved: descriptors.saved.value,
    selected_reaction: safeNullableText(descriptors.selected_reaction.value, 48, 192),
    updated_at_ms: updatedAtMs,
  });
}

function sanitizeBuilderWorkbenchMessageEnvelope(raw) {
  const descriptors = exactObject(raw, ENVELOPE_KEYS);
  if (descriptors.envelope_version.value !== BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION) fail();
  const source = exactObject(descriptors.source.value, SOURCE_KEYS);
  const address = exactObject(descriptors.address.value, ADDRESS_KEYS);
  const content = exactObject(descriptors.content.value, CONTENT_KEYS);
  const delivery = exactObject(descriptors.delivery.value, DELIVERY_KEYS);
  const trust = exactObject(descriptors.trust.value, TRUST_KEYS);
  const createdAtMs = safeTimestamp(descriptors.created_at_ms.value);
  const receivedAtMs = safeTimestamp(descriptors.received_at_ms.value);
  if (receivedAtMs < createdAtMs) fail();
  const payload = jsonValue(content.payload.value);
  if (Buffer.byteLength(canonicalJson(payload), 'utf8') > MAX_PAYLOAD_BYTES) fail();
  return freezeDeep({
    envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
    message_id: safePattern(descriptors.message_id.value, MESSAGE_ID_PATTERN),
    agent_id: safePattern(descriptors.agent_id.value, AGENT_ID_PATTERN),
    owner_id: safePattern(descriptors.owner_id.value, OWNER_ID_PATTERN),
    source: {
      source_kind: safeEnum(source.source_kind.value, SOURCE_KINDS),
      source_id: safeLooseId(source.source_id.value),
      connector_id: source.connector_id.value === null ? null : safeLooseId(source.connector_id.value),
      actor_id: source.actor_id.value === null ? null : safeLooseId(source.actor_id.value),
      external_message_id: source.external_message_id.value === null
        ? null
        : safeLooseId(source.external_message_id.value),
    },
    address: {
      workbench_id: safePattern(address.workbench_id.value, WORKBENCH_ID_PATTERN),
      thread_id: address.thread_id.value === null
        ? null
        : safePattern(address.thread_id.value, THREAD_ID_PATTERN),
      reply_route_id: address.reply_route_id.value === null
        ? null
        : safeLooseId(address.reply_route_id.value),
      project_id: address.project_id.value === null
        ? null
        : safePattern(address.project_id.value, PROJECT_ID_PATTERN),
      task_address_id: address.task_address_id.value === null
        ? null
        : safePattern(address.task_address_id.value, TASK_ADDRESS_ID_PATTERN),
    },
    content: {
      content_type: safePattern(content.content_type.value, CONTENT_TYPE_PATTERN),
      schema_ref: safePattern(content.schema_ref.value, SCHEMA_REF_PATTERN),
      schema_version: (() => {
        const value = content.schema_version.value;
        if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
        return value;
      })(),
      payload,
      fallback_text: safeText(content.fallback_text.value),
    },
    delivery: {
      attention: safeEnum(delivery.attention.value, ATTENTION_VALUES),
      visibility: safeEnum(delivery.visibility.value, VISIBILITY_VALUES),
      dedupe_key: delivery.dedupe_key.value === null ? null : safeLooseId(delivery.dedupe_key.value),
      source_sequence: delivery.source_sequence.value === null
        ? null
        : safeLooseId(delivery.source_sequence.value),
    },
    trust: {
      provenance: safeEnum(trust.provenance.value, PROVENANCE_VALUES),
      sensitivity: safeEnum(trust.sensitivity.value, SENSITIVITY_VALUES),
      prompt_admission: safeEnum(trust.prompt_admission.value, ADMISSION_VALUES),
      memory_admission: safeEnum(trust.memory_admission.value, ADMISSION_VALUES),
    },
    attachment_refs: safeRefArray(descriptors.attachment_refs.value, ATTACHMENT_ID_PATTERN),
    proposed_action_refs: safeRefArray(descriptors.proposed_action_refs.value, ACTION_ID_PATTERN),
    created_at_ms: createdAtMs,
    received_at_ms: receivedAtMs,
  });
}

function builderWorkbenchMessageDigest(raw) {
  const message = sanitizeBuilderWorkbenchMessageEnvelope(raw);
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(message), 'utf8').digest('hex')}`;
}

module.exports = Object.freeze({
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
  BUILDER_WORKBENCH_THREAD_VERSION,
  BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
  BuilderWorkbenchMessageContractError,
  builderWorkbenchMessageDigest,
  sanitizeBuilderWorkbenchMessageEnvelope,
  sanitizeBuilderWorkbenchMessageState,
  sanitizeBuilderWorkbenchThread,
});
