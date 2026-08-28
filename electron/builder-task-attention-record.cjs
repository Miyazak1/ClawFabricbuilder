'use strict';

const { types: utilTypes } = require('node:util');

const RECORD_VERSION = 'builder-task-attention-record.v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PATTERNS = Object.freeze({
  attention: new RegExp(`^builder-task-attention:${UUID}$`, 'u'),
  conversation: new RegExp(`^builder-conversation:${UUID}:${UUID}$`, 'u'),
  project: new RegExp(`^builder-project:${UUID}$`, 'u'),
  task: new RegExp(`^builder-task-address:${UUID}$`, 'u'),
  digest: /^sha256:[0-9a-f]{64}$/u,
});
const STATES = new Set([
  'ready', 'waiting_permission', 'waiting_user_input', 'waiting_resource', 'paused',
]);
const REASONS = new Set([
  'resolved', 'current_project_write', 'plan_source_read', 'clarification_required',
  'decision_required', 'project_busy', 'concurrency_limit', 'owner_paused',
]);
const KEYS = Object.freeze([
  'record_version', 'attention_id', 'project_id', 'conversation_id', 'task_address_id',
  'state', 'reason_code', 'request_digest', 'revision', 'updated_at_ms',
]);

class BuilderTaskAttentionRecordError extends Error {
  constructor() {
    super('Task attention state could not be verified.');
    this.name = 'BuilderTaskAttentionRecordError';
    this.code = 'builder_task_attention_record_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderTaskAttentionRecordError(); }

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== KEYS.length || keys.some((key) => typeof key !== 'string' || !KEYS.includes(key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function id(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function sanitizeBuilderTaskAttentionRecord(value) {
  const source = plain(value);
  if (
    source.record_version !== RECORD_VERSION
    || !STATES.has(source.state)
    || !REASONS.has(source.reason_code)
    || !Number.isSafeInteger(source.revision)
    || source.revision < 1
    || !Number.isSafeInteger(source.updated_at_ms)
    || source.updated_at_ms < 0
    || (source.state === 'ready') !== (source.reason_code === 'resolved')
    || (source.state === 'ready' && source.request_digest !== null)
    || (source.request_digest !== null && !PATTERNS.digest.test(source.request_digest))
  ) fail();
  return Object.freeze({
    record_version: RECORD_VERSION,
    attention_id: id(source.attention_id, PATTERNS.attention),
    project_id: id(source.project_id, PATTERNS.project),
    conversation_id: id(source.conversation_id, PATTERNS.conversation),
    task_address_id: id(source.task_address_id, PATTERNS.task),
    state: source.state,
    reason_code: source.reason_code,
    request_digest: source.request_digest,
    revision: source.revision,
    updated_at_ms: source.updated_at_ms,
  });
}

module.exports = Object.freeze({
  RECORD_VERSION,
  BuilderTaskAttentionRecordError,
  sanitizeBuilderTaskAttentionRecord,
});
