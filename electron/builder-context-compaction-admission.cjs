'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_CONVERSATION_COMPACTION_PROJECTION_VERSION,
} = require('./builder-conversation-export.cjs');
const {
  CONVERSATION_ID_PATTERN,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');

const BUILDER_CONTEXT_COMPACTION_ADMISSION_VERSION =
  'builder-context-compaction-admission.v1';
const BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION =
  'builder-context-compaction-admission-record.v1';
const BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND =
  'builder_context_compaction_admission_record';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN = /^builder-conversation-compaction-projection:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-context-compaction-admission:[0-9a-f]{64}$/u;

const INPUT_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'project_id',
  'conversation_id',
  'task_address_id',
  'conversation_compaction_projection_id',
  'source_event_count',
  'source_current_sequence',
  'source_current_event_id',
  'source_current_event_digest',
  'requested_by',
  'requested_at_ms',
  'trigger',
  'admission_status',
  'admission_reason',
  'harness_operation',
  'harness_turn_binding',
  'execution_boundary',
]);
const RECORD_KEYS = Object.freeze([
  'admission_id',
  'conversation_compaction_projection_digest',
  ...INPUT_KEYS,
  'lifecycle',
  'authority',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'projection_id',
  'project_id',
  'conversation_id',
  'source',
  'public_entry_count',
  'public_text_byte_length',
  'recent_public_entries',
  'omitted_public_entries_digest',
  'lifecycle',
]);
const SOURCE_KEYS = Object.freeze([
  'authority',
  'event_count',
  'current_sequence',
  'current_event_id',
  'current_event_digest',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'request',
  'conversation_projection',
  'harness_compaction',
  'summary_recording',
  'permission_grant',
  'source_mutation',
  'revision',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'conversation_projection_authority',
  'harness_authority',
  'renderer_authority',
  'ipc_authority',
  'model_dispatch',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'sqlite_write',
  'session_mutation',
  'permission_grant_authority',
  'revision_authority',
  'readiness_authority',
]);
const LIFECYCLE = Object.freeze({
  request: 'manual_compaction_request_admitted',
  conversation_projection: 'current_committed_projection_verified',
  harness_compaction: 'not_started_by_admission',
  summary_recording: 'not_performed_by_admission',
  permission_grant: 'not_created',
  source_mutation: 'not_performed_by_admission',
  revision: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_context_compaction_admission_contract_v1',
  conversation_projection_authority: 'main_conversation_export_contract_v1',
  harness_authority: 'manual_compactNow_admission_only',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  model_dispatch: false,
  provider_dispatch: false,
  tool_dispatch: false,
  source_read: 'not_performed_by_admission',
  source_write: 'not_performed_by_admission',
  sqlite_write: 'not_performed_by_admission',
  session_mutation: 'not_started_by_admission',
  permission_grant_authority: 'not_present',
  revision_authority: 'not_present',
  readiness_authority: 'not_authoritative_for_readiness',
});

const ERROR_MESSAGE = 'Builder context compaction admission could not be verified.';

class BuilderContextCompactionAdmissionError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderContextCompactionAdmissionError';
    this.code = 'builder_context_compaction_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextCompactionAdmissionError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestHex(value) {
  return sha256Canonical(value).slice('sha256:'.length);
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail();
  return value;
}

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function denseArray(value, maximum) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    if (!isPlainObject(descriptor.value)) fail();
  }
  return value;
}

function exactConstantObject(value, expected, keys) {
  exactObject(value, keys);
  const next = {};
  for (const key of keys) {
    const actual = valueAt(value, key);
    if (actual !== expected[key]) fail();
    next[key] = actual;
  }
  return freezeDeep(next);
}

function safeCompactionProjection(value) {
  exactObject(value, PROJECTION_KEYS);
  const source = valueAt(value, 'source');
  exactObject(source, SOURCE_KEYS);
  const lifecycle = valueAt(value, 'lifecycle');
  if (
    valueAt(value, 'projection_version') !== BUILDER_CONVERSATION_COMPACTION_PROJECTION_VERSION
    || valueAt(source, 'authority') !== 'sqlite_conversation_replay_read_only'
  ) fail();
  const projection = freezeDeep({
    projection_version: BUILDER_CONVERSATION_COMPACTION_PROJECTION_VERSION,
    projection_id: safePattern(valueAt(value, 'projection_id'), PROJECTION_ID_PATTERN),
    project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: sanitizeBuilderConversationAddress(
      safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
    ),
    source: {
      authority: 'sqlite_conversation_replay_read_only',
      event_count: safeCount(valueAt(source, 'event_count'), 2, 10_000),
      current_sequence: safeCount(valueAt(source, 'current_sequence'), 2, 10_000),
      current_event_id: safePattern(valueAt(source, 'current_event_id'), EVENT_ID_PATTERN),
      current_event_digest: safeDigest(valueAt(source, 'current_event_digest')),
    },
    public_entry_count: safeCount(valueAt(value, 'public_entry_count'), 2, 10_000),
    public_text_byte_length: safeCount(valueAt(value, 'public_text_byte_length'), 1, 64 * 1_024 * 1_024),
    recent_public_entries: denseArray(valueAt(value, 'recent_public_entries'), 32),
    omitted_public_entries_digest: valueAt(value, 'omitted_public_entries_digest') === null
      ? null
      : safeDigest(valueAt(value, 'omitted_public_entries_digest')),
    lifecycle,
  });
  if (
    projection.source.event_count !== projection.source.current_sequence
    || projection.projection_id !== `builder-conversation-compaction-projection:${digestHex({
      project_id: projection.project_id,
      conversation_id: projection.conversation_id,
      source: projection.source,
      public_entry_count: projection.public_entry_count,
      public_text_byte_length: projection.public_text_byte_length,
      recent_public_entries: projection.recent_public_entries,
      omitted_public_entries_digest: projection.omitted_public_entries_digest,
      lifecycle: projection.lifecycle,
    })}`
  ) fail();
  return projection;
}

function safeAdmissionFields(value, projection) {
  exactObject(value, INPUT_KEYS);
  const fields = freezeDeep({
    record_version: valueAt(value, 'record_version'),
    record_kind: valueAt(value, 'record_kind'),
    project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: sanitizeBuilderConversationAddress(
      safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
    ),
    task_address_id: safePattern(valueAt(value, 'task_address_id'), TASK_ADDRESS_ID_PATTERN),
    conversation_compaction_projection_id:
      safePattern(valueAt(value, 'conversation_compaction_projection_id'), PROJECTION_ID_PATTERN),
    source_event_count: safeCount(valueAt(value, 'source_event_count'), 2, 10_000),
    source_current_sequence: safeCount(valueAt(value, 'source_current_sequence'), 2, 10_000),
    source_current_event_id: safePattern(valueAt(value, 'source_current_event_id'), EVENT_ID_PATTERN),
    source_current_event_digest: safeDigest(valueAt(value, 'source_current_event_digest')),
    requested_by: valueAt(value, 'requested_by'),
    requested_at_ms: safeTimestamp(valueAt(value, 'requested_at_ms')),
    trigger: valueAt(value, 'trigger'),
    admission_status: valueAt(value, 'admission_status'),
    admission_reason: valueAt(value, 'admission_reason'),
    harness_operation: valueAt(value, 'harness_operation'),
    harness_turn_binding: valueAt(value, 'harness_turn_binding'),
    execution_boundary: valueAt(value, 'execution_boundary'),
  });
  if (
    fields.record_version !== BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION
    || fields.record_kind !== BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND
    || fields.project_id !== projection.project_id
    || fields.conversation_id !== projection.conversation_id
    || fields.conversation_compaction_projection_id !== projection.projection_id
    || fields.source_event_count !== projection.source.event_count
    || fields.source_current_sequence !== projection.source.current_sequence
    || fields.source_current_event_id !== projection.source.current_event_id
    || fields.source_current_event_digest !== projection.source.current_event_digest
    || fields.requested_by !== 'local-user'
    || fields.trigger !== 'manual'
    || fields.admission_status !== 'admitted_for_manual_compaction'
    || fields.admission_reason !== 'manual_request_on_committed_conversation_projection'
    || fields.harness_operation !== 'compactNow'
    || fields.harness_turn_binding !== 'manual_turn_null'
    || fields.execution_boundary !== 'admission_only_no_compaction_started'
  ) fail();
  return fields;
}

function admissionIdFor(projectionDigest, fields) {
  return `builder-context-compaction-admission:${digestHex({
    context_compaction_admission_identity: BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION,
    conversation_compaction_projection_digest: projectionDigest,
    fields,
  })}`;
}

function createBuilderContextCompactionAdmissionRecord(value, conversationCompactionProjection) {
  try {
    const projection = safeCompactionProjection(conversationCompactionProjection);
    const fields = safeAdmissionFields(value, projection);
    const projectionDigest = sha256Canonical(projection);
    return freezeDeep({
      admission_id: admissionIdFor(projectionDigest, fields),
      conversation_compaction_projection_digest: projectionDigest,
      ...fields,
      lifecycle: freezeDeep({ ...LIFECYCLE }),
      authority: freezeDeep({ ...AUTHORITY }),
    });
  } catch (error) {
    if (error instanceof BuilderContextCompactionAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderContextCompactionAdmissionRecord(value, conversationCompactionProjection) {
  try {
    const projection = safeCompactionProjection(conversationCompactionProjection);
    exactObject(value, RECORD_KEYS);
    const admissionId = safePattern(valueAt(value, 'admission_id'), ADMISSION_ID_PATTERN);
    const projectionDigest = safeDigest(valueAt(value, 'conversation_compaction_projection_digest'));
    const expectedProjectionDigest = sha256Canonical(projection);
    if (projectionDigest !== expectedProjectionDigest) fail();
    const fields = safeAdmissionFields({
      record_version: valueAt(value, 'record_version'),
      record_kind: valueAt(value, 'record_kind'),
      project_id: valueAt(value, 'project_id'),
      conversation_id: valueAt(value, 'conversation_id'),
      task_address_id: valueAt(value, 'task_address_id'),
      conversation_compaction_projection_id: valueAt(value, 'conversation_compaction_projection_id'),
      source_event_count: valueAt(value, 'source_event_count'),
      source_current_sequence: valueAt(value, 'source_current_sequence'),
      source_current_event_id: valueAt(value, 'source_current_event_id'),
      source_current_event_digest: valueAt(value, 'source_current_event_digest'),
      requested_by: valueAt(value, 'requested_by'),
      requested_at_ms: valueAt(value, 'requested_at_ms'),
      trigger: valueAt(value, 'trigger'),
      admission_status: valueAt(value, 'admission_status'),
      admission_reason: valueAt(value, 'admission_reason'),
      harness_operation: valueAt(value, 'harness_operation'),
      harness_turn_binding: valueAt(value, 'harness_turn_binding'),
      execution_boundary: valueAt(value, 'execution_boundary'),
    }, projection);
    if (admissionId !== admissionIdFor(projectionDigest, fields)) fail();
    return freezeDeep({
      admission_id: admissionId,
      conversation_compaction_projection_digest: projectionDigest,
      ...fields,
      lifecycle: exactConstantObject(valueAt(value, 'lifecycle'), LIFECYCLE, LIFECYCLE_KEYS),
      authority: exactConstantObject(valueAt(value, 'authority'), AUTHORITY, AUTHORITY_KEYS),
    });
  } catch (error) {
    if (error instanceof BuilderContextCompactionAdmissionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND,
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION,
  BUILDER_CONTEXT_COMPACTION_ADMISSION_VERSION,
  BuilderContextCompactionAdmissionError,
  createBuilderContextCompactionAdmissionRecord,
  sanitizeBuilderContextCompactionAdmissionRecord,
});
