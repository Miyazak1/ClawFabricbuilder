'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_SESSION_ADDRESS_VERSION = 'builder-session-address.v1';
const BUILDER_TASK_ADDRESS_VERSION = 'builder-task-address.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DISPLAY_ID_PATTERN = /^S-[A-Z0-9]{6,12}$/u;
const MAX_TITLE_LENGTH = 160;
const MAX_GOAL_LENGTH = 2_048;

const SESSION_STATUS = Object.freeze(['active', 'archived', 'deleted_pending', 'deleted']);
const TASK_STATUS = Object.freeze([
  'draft',
  'discussing',
  'planned',
  'active',
  'blocked',
  'review_needed',
  'completed',
  'archived',
]);
const SESSION_INPUT_KEYS = Object.freeze([
  'session_id',
  'project_id',
  'display_id',
  'title',
  'status',
  'root_conversation_id',
  'current_task_id',
  'parent_session_id',
  'forked_from_session_id',
  'forked_from_revision_receipt_digest',
  'created_by',
  'created_at_ms',
  'updated_at_ms',
  'archived_at_ms',
]);
const TASK_INPUT_KEYS = Object.freeze([
  'task_address_id',
  'session_id',
  'project_id',
  'agent_id',
  'parent_task_address_id',
  'conversation_id',
  'title',
  'goal',
  'status',
  'current_brief_id',
  'current_plan_id',
  'base_revision_receipt_digest',
  'produced_revision_receipt_digest',
  'created_by',
  'created_at_ms',
  'updated_at_ms',
  'closed_at_ms',
]);
const LIFECYCLE = Object.freeze({
  address_authority: 'main_session_task_address_contract_v1',
  sqlite_read: 'not_performed',
  sqlite_write: 'not_performed',
  sqlite_delete: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  export_materialization: 'not_performed',
});
const ERROR_MESSAGE = 'Builder session task address could not be verified.';

class BuilderSessionTaskAddressError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderSessionTaskAddressError';
    this.code = 'builder_session_task_address_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderSessionTaskAddressError();
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

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeNullablePattern(value, pattern, maximum) {
  if (value === null) return null;
  return safePattern(value, pattern, maximum);
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

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN, 64);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 80);
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeNullableTimestamp(value) {
  if (value === null) return null;
  return safeTimestamp(value);
}

function safeDisplayId(value) {
  return safePattern(value, DISPLAY_ID_PATTERN, 16);
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeText(value, maximum, allowEmpty = false) {
  if (
    typeof value !== 'string'
    || value.length > maximum
    || value.trim() !== value
    || (!allowEmpty && value.length === 0)
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function safeCreatedBy(value) {
  return safeText(value, 80);
}

function safeStatus(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function recordId(prefix, body) {
  return `${prefix}:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function assertTimeOrder(createdAtMs, updatedAtMs, finalAtMs) {
  if (updatedAtMs < createdAtMs) fail();
  if (finalAtMs !== null && finalAtMs < createdAtMs) fail();
  if (finalAtMs !== null && updatedAtMs > finalAtMs) fail();
}

function createBuilderSessionAddress(rawInput) {
  exactObject(rawInput, SESSION_INPUT_KEYS);
  const sessionId = safeSessionId(valueAt(rawInput, 'session_id'));
  const status = safeStatus(valueAt(rawInput, 'status'), SESSION_STATUS);
  const currentTaskId = safeNullablePattern(valueAt(rawInput, 'current_task_id'), TASK_ADDRESS_ID_PATTERN, 96);
  const archivedAtMs = safeNullableTimestamp(valueAt(rawInput, 'archived_at_ms'));
  const createdAtMs = safeTimestamp(valueAt(rawInput, 'created_at_ms'));
  const updatedAtMs = safeTimestamp(valueAt(rawInput, 'updated_at_ms'));
  assertTimeOrder(createdAtMs, updatedAtMs, archivedAtMs);
  if ((status === 'archived' || status === 'deleted_pending' || status === 'deleted') && archivedAtMs === null) fail();
  if (status === 'active' && archivedAtMs !== null) fail();
  if (currentTaskId === null && status === 'active') fail();
  const parentSessionId = safeNullablePattern(valueAt(rawInput, 'parent_session_id'), SESSION_ID_PATTERN, 96);
  const forkedFromSessionId = safeNullablePattern(valueAt(rawInput, 'forked_from_session_id'), SESSION_ID_PATTERN, 96);
  if (parentSessionId === sessionId || forkedFromSessionId === sessionId) fail();
  const body = freezeDeep({
    session_id: sessionId,
    project_id: safeProjectId(valueAt(rawInput, 'project_id')),
    display_id: safeDisplayId(valueAt(rawInput, 'display_id')),
    title: safeText(valueAt(rawInput, 'title'), MAX_TITLE_LENGTH),
    status,
    root_conversation_id: safeConversationId(valueAt(rawInput, 'root_conversation_id')),
    current_task_id: currentTaskId,
    parent_session_id: parentSessionId,
    forked_from_session_id: forkedFromSessionId,
    forked_from_revision_receipt_digest:
      safeNullableDigest(valueAt(rawInput, 'forked_from_revision_receipt_digest')),
    created_by: safeCreatedBy(valueAt(rawInput, 'created_by')),
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
    archived_at_ms: archivedAtMs,
    lifecycle: { ...LIFECYCLE },
  });
  return freezeDeep({
    address_version: BUILDER_SESSION_ADDRESS_VERSION,
    address_id: recordId('builder-session-address-record', body),
    ...body,
  });
}

function createBuilderTaskAddress(rawInput) {
  exactObject(rawInput, TASK_INPUT_KEYS);
  const taskAddressId = safeTaskAddressId(valueAt(rawInput, 'task_address_id'));
  const status = safeStatus(valueAt(rawInput, 'status'), TASK_STATUS);
  const parentTaskAddressId = safeNullablePattern(
    valueAt(rawInput, 'parent_task_address_id'),
    TASK_ADDRESS_ID_PATTERN,
    96,
  );
  if (parentTaskAddressId === taskAddressId) fail();
  const createdAtMs = safeTimestamp(valueAt(rawInput, 'created_at_ms'));
  const updatedAtMs = safeTimestamp(valueAt(rawInput, 'updated_at_ms'));
  const closedAtMs = safeNullableTimestamp(valueAt(rawInput, 'closed_at_ms'));
  assertTimeOrder(createdAtMs, updatedAtMs, closedAtMs);
  if (['completed', 'archived'].includes(status) && closedAtMs === null) fail();
  if (!['completed', 'archived'].includes(status) && closedAtMs !== null) fail();
  const producedRevision = safeNullableDigest(valueAt(rawInput, 'produced_revision_receipt_digest'));
  if (producedRevision !== null && !['review_needed', 'completed', 'archived'].includes(status)) fail();
  const body = freezeDeep({
    task_address_id: taskAddressId,
    session_id: safeSessionId(valueAt(rawInput, 'session_id')),
    project_id: safeProjectId(valueAt(rawInput, 'project_id')),
    agent_id: safeAgentId(valueAt(rawInput, 'agent_id')),
    parent_task_address_id: parentTaskAddressId,
    conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id')),
    title: safeText(valueAt(rawInput, 'title'), MAX_TITLE_LENGTH),
    goal: safeText(valueAt(rawInput, 'goal'), MAX_GOAL_LENGTH),
    status,
    current_brief_id: safeNullableDigest(valueAt(rawInput, 'current_brief_id')),
    current_plan_id: safeNullableDigest(valueAt(rawInput, 'current_plan_id')),
    base_revision_receipt_digest: safeNullableDigest(valueAt(rawInput, 'base_revision_receipt_digest')),
    produced_revision_receipt_digest: producedRevision,
    created_by: safeCreatedBy(valueAt(rawInput, 'created_by')),
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
    closed_at_ms: closedAtMs,
    lifecycle: { ...LIFECYCLE },
  });
  return freezeDeep({
    address_version: BUILDER_TASK_ADDRESS_VERSION,
    address_id: recordId('builder-task-address-record', body),
    ...body,
  });
}

function sanitizeBuilderSessionAddress(value) {
  exactObject(value, [
    'address_version',
    'address_id',
    ...SESSION_INPUT_KEYS,
    'lifecycle',
  ]);
  if (valueAt(value, 'address_version') !== BUILDER_SESSION_ADDRESS_VERSION) fail();
  const rebuilt = createBuilderSessionAddress({
    session_id: valueAt(value, 'session_id'),
    project_id: valueAt(value, 'project_id'),
    display_id: valueAt(value, 'display_id'),
    title: valueAt(value, 'title'),
    status: valueAt(value, 'status'),
    root_conversation_id: valueAt(value, 'root_conversation_id'),
    current_task_id: valueAt(value, 'current_task_id'),
    parent_session_id: valueAt(value, 'parent_session_id'),
    forked_from_session_id: valueAt(value, 'forked_from_session_id'),
    forked_from_revision_receipt_digest: valueAt(value, 'forked_from_revision_receipt_digest'),
    created_by: valueAt(value, 'created_by'),
    created_at_ms: valueAt(value, 'created_at_ms'),
    updated_at_ms: valueAt(value, 'updated_at_ms'),
    archived_at_ms: valueAt(value, 'archived_at_ms'),
  });
  if (valueAt(value, 'address_id') !== rebuilt.address_id) fail();
  if (canonicalJson(valueAt(value, 'lifecycle')) !== canonicalJson(rebuilt.lifecycle)) fail();
  return rebuilt;
}

function sanitizeBuilderTaskAddress(value) {
  exactObject(value, [
    'address_version',
    'address_id',
    ...TASK_INPUT_KEYS,
    'lifecycle',
  ]);
  if (valueAt(value, 'address_version') !== BUILDER_TASK_ADDRESS_VERSION) fail();
  const rebuilt = createBuilderTaskAddress({
    task_address_id: valueAt(value, 'task_address_id'),
    session_id: valueAt(value, 'session_id'),
    project_id: valueAt(value, 'project_id'),
    agent_id: valueAt(value, 'agent_id'),
    parent_task_address_id: valueAt(value, 'parent_task_address_id'),
    conversation_id: valueAt(value, 'conversation_id'),
    title: valueAt(value, 'title'),
    goal: valueAt(value, 'goal'),
    status: valueAt(value, 'status'),
    current_brief_id: valueAt(value, 'current_brief_id'),
    current_plan_id: valueAt(value, 'current_plan_id'),
    base_revision_receipt_digest: valueAt(value, 'base_revision_receipt_digest'),
    produced_revision_receipt_digest: valueAt(value, 'produced_revision_receipt_digest'),
    created_by: valueAt(value, 'created_by'),
    created_at_ms: valueAt(value, 'created_at_ms'),
    updated_at_ms: valueAt(value, 'updated_at_ms'),
    closed_at_ms: valueAt(value, 'closed_at_ms'),
  });
  if (valueAt(value, 'address_id') !== rebuilt.address_id) fail();
  if (canonicalJson(valueAt(value, 'lifecycle')) !== canonicalJson(rebuilt.lifecycle)) fail();
  return rebuilt;
}

module.exports = {
  BUILDER_SESSION_ADDRESS_VERSION,
  BUILDER_TASK_ADDRESS_VERSION,
  BuilderSessionTaskAddressError,
  createBuilderSessionAddress,
  createBuilderTaskAddress,
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
};
