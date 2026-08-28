'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_CONVERSATION_COMPACTION_PROJECTION_VERSION,
  createBuilderConversationCompactionProjection,
} = require('./builder-conversation-export.cjs');
const {
  createBuilderContextCompactionSummary,
} = require('./builder-context-compaction-summary.cjs');

const SERVICE_VERSION = 'builder-context-compaction-recording-service.v1';
const RESULT_VERSION = 'builder-context-compaction-recording-result.v1';
const REQUIRED_OPTION_KEYS = Object.freeze([
  'context_compaction_summary_store',
  'session_task_address_store',
  'now_ms',
]);
const RECORD_KEYS = Object.freeze(['loaded_conversation']);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECTION_ID_PATTERN = /^builder-conversation-compaction-projection:[0-9a-f]{64}$/u;
const ERROR_MESSAGE = 'Builder context compaction could not be recorded.';
// This batches Builder's cross-run context checkpoint projection. Token-pressure
// compaction inside an active coding run remains owned by DeepSeek Harness.
const DEFAULT_MINIMUM_SOURCE_EVENT_COUNT = 16;
const MAX_PUBLIC_ENTRIES_FOR_SUMMARY = 24;
const PATHISH_PATTERN = /(?:file:\/{1,3}\S+|\\\\\S+|(?:[A-Za-z]:[\\/]\S+)|(?:^|\s)\/[A-Za-z0-9._/@-]+(?:[\\/][A-Za-z0-9._/@-]+)*)/gu;
const CREDENTIALISH_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|bearer\s+[A-Za-z0-9._~+/=-]{8,}|sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})/giu;

class BuilderContextCompactionRecordingServiceError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderContextCompactionRecordingServiceError';
    this.code = 'builder_context_compaction_recording_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextCompactionRecordingServiceError();
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
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys) {
  if (!isPlainObject(value)) fail();
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const actual = Reflect.ownKeys(value);
  if (
    actual.length < requiredKeys.length
    || actual.length > allowedKeys.length
    || requiredKeys.some((key) => !actual.includes(key))
    || actual.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of actual) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function method(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeMinimum(value) {
  if (value === undefined) return DEFAULT_MINIMUM_SOURCE_EVENT_COUNT;
  return safeCount(value, 2, 10_000);
}

function safeProjection(value) {
  const projected = createBuilderConversationCompactionProjection({
    loaded_conversation: value,
  });
  exactObject(projected, [
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
  if (valueAt(projected, 'projection_version') !== BUILDER_CONVERSATION_COMPACTION_PROJECTION_VERSION) fail();
  safePattern(valueAt(projected, 'projection_id'), PROJECTION_ID_PATTERN);
  const projectId = safePattern(valueAt(projected, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(projected, 'conversation_id'), CONVERSATION_ID_PATTERN);
  const source = valueAt(projected, 'source');
  exactObject(source, [
    'authority',
    'event_count',
    'current_sequence',
    'current_event_id',
    'current_event_digest',
  ]);
  if (valueAt(source, 'authority') !== 'sqlite_conversation_replay_read_only') fail();
  const eventCount = safeCount(valueAt(source, 'event_count'), 1, 10_000);
  const currentSequence = safeCount(valueAt(source, 'current_sequence'), 1, 10_000);
  const currentEventId = safePattern(valueAt(source, 'current_event_id'), EVENT_ID_PATTERN);
  const currentEventDigest = safePattern(valueAt(source, 'current_event_digest'), DIGEST_PATTERN);
  if (eventCount !== currentSequence) fail();
  const entries = valueAt(projected, 'recent_public_entries');
  if (!Array.isArray(entries) || utilTypes.isProxy(entries) || entries.length > 32) fail();
  const entryKeys = Reflect.ownKeys(entries);
  if (entryKeys.length !== entries.length + 1 || entryKeys.some((key) => typeof key === 'symbol')) fail();
  for (let index = 0; index < entries.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    if (!isPlainObject(descriptor.value)) fail();
  }
  const omittedDigest = valueAt(projected, 'omitted_public_entries_digest');
  if (omittedDigest !== null) safePattern(omittedDigest, DIGEST_PATTERN);
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    source: {
      event_count: eventCount,
      current_sequence: currentSequence,
      current_event_id: currentEventId,
      current_event_digest: currentEventDigest,
    },
    public_entry_count: safeCount(valueAt(projected, 'public_entry_count'), 1, 10_000),
    public_text_byte_length: safeCount(valueAt(projected, 'public_text_byte_length'), 1, 64 * 1_024 * 1_024),
    recent_public_entries: entries,
    omitted_public_entries_digest: omittedDigest,
  });
}

function loadedEvents(value) {
  const events = valueAt(value, 'events');
  if (!Array.isArray(events) || utilTypes.isProxy(events) || events.length < 1 || events.length > 1_000_000) fail();
  const keys = Reflect.ownKeys(events);
  if (keys.length !== events.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const output = [];
  for (let index = 0; index < events.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const event = descriptor.value;
    if (!isPlainObject(event)) fail();
    output.push(event);
  }
  return output;
}

function redactedSnippet(value, maximum = 240) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .normalize('NFC')
    .replace(CREDENTIALISH_PATTERN, 'redacted credential')
    .replace(PATHISH_PATTERN, ' redacted path')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maximum) return normalized;
  return `${codePoints.slice(0, maximum - 3).join('').trimEnd()}...`;
}

function entryText(entry) {
  if (typeof entry.text === 'string') return entry.text;
  if (typeof entry.title === 'string') return entry.title;
  if (typeof entry.outcome === 'string') return entry.outcome;
  if (typeof entry.result_kind === 'string') return entry.result_kind;
  return entry.entry_kind;
}

function sourceKind(entry) {
  if (entry.entry_kind === 'message' && entry.role === 'user') return 'user_message';
  if (entry.entry_kind === 'message' && entry.role === 'assistant') return 'assistant_message';
  if (entry.entry_kind === 'run') return 'run_result';
  if (entry.entry_kind === 'turn') return 'task_capsule_update';
  return null;
}

function sourceRefs(entries) {
  return entries
    .map((entry) => {
      const kind = sourceKind(entry);
      if (kind === null) return null;
      return {
        source_kind: kind,
        source_digest: digest(entry),
      };
    })
    .filter((entry) => entry !== null)
    .slice(-32);
}

function summaryText(entries, publicEntryCount, sequence) {
  const recent = entries.slice(-MAX_PUBLIC_ENTRIES_FOR_SUMMARY);
  const latestUser = [...recent].reverse().find((entry) => entry.entry_kind === 'message' && entry.role === 'user');
  const latestAssistant = [...recent].reverse().find((entry) => entry.entry_kind === 'message' && entry.role === 'assistant');
  const latestRun = [...recent].reverse().find((entry) => entry.entry_kind === 'run');
  const parts = [
    `Conversation checkpoint through event sequence ${sequence}.`,
    `Public entries summarized: ${publicEntryCount}.`,
  ];
  if (latestUser) parts.push(`Latest user request: ${redactedSnippet(entryText(latestUser)) || 'present'}.`);
  if (latestAssistant) parts.push(`Latest assistant result: ${redactedSnippet(entryText(latestAssistant)) || 'present'}.`);
  if (latestRun) parts.push(`Latest run state: ${redactedSnippet(entryText(latestRun), 120) || 'recorded'}.`);
  return parts.join('\n');
}

function tokenEstimateForProjection(projection) {
  return Math.max(256, Math.ceil(projection.public_text_byte_length / 4) + 128);
}

function currentTaskAddressId(readResult, projectId, conversationId) {
  exactObject(readResult, [
    'result_version',
    'status',
    'session_address',
    'task_address',
    'address_evidence',
  ]);
  if (valueAt(readResult, 'status') !== 'ready') return null;
  const wrapper = valueAt(readResult, 'task_address');
  exactObject(wrapper, ['task_address']);
  const task = valueAt(wrapper, 'task_address');
  if (!isPlainObject(task)) fail();
  const taskProjectId = safePattern(valueAt(task, 'project_id'), PROJECT_ID_PATTERN);
  const taskConversationId = safePattern(valueAt(task, 'conversation_id'), CONVERSATION_ID_PATTERN);
  const taskAddressId = safePattern(valueAt(task, 'task_address_id'), TASK_ADDRESS_ID_PATTERN);
  if (taskProjectId !== projectId || taskConversationId !== conversationId) fail();
  return taskAddressId;
}

function result(operation, payload = {}) {
  return freezeDeep({
    result_version: RESULT_VERSION,
    operation,
    ...payload,
    authority: {
      compaction_recording: 'main_owned_context_compaction_recording_service',
      source: 'sqlite_conversation_replay_bounded_projection',
      address_binding: 'main_owned_session_task_address_store',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_mutation: false,
      git_mutation: false,
      permission_grant: false,
      readiness_authority: 'not_authoritative_for_readiness',
    },
  });
}

function createBuilderContextCompactionRecordingService(rawOptions) {
  exactObjectWithOptional(rawOptions, REQUIRED_OPTION_KEYS, ['minimum_source_event_count']);
  const store = valueAt(rawOptions, 'context_compaction_summary_store');
  const addressStore = valueAt(rawOptions, 'session_task_address_store');
  const nowMs = valueAt(rawOptions, 'now_ms');
  const minimumSourceEventCount = safeMinimum(Object.hasOwn(rawOptions, 'minimum_source_event_count')
    ? valueAt(rawOptions, 'minimum_source_event_count')
    : undefined);
  if (
    !isPlainObject(store)
    || !isPlainObject(addressStore)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
  ) fail();
  const recordSummary = method(store, 'record_context_compaction_summary');
  const readLatestSummary = method(store, 'read_latest_context_compaction_summary');
  const readAddress = method(addressStore, 'read_current_session_task_for_conversation');

  return freezeDeep({
    service_version: SERVICE_VERSION,
    record_committed_conversation_compaction(rawRequest) {
      exactObject(rawRequest, RECORD_KEYS);
      const loaded = valueAt(rawRequest, 'loaded_conversation');
      if (!isPlainObject(loaded)) fail();
      const projected = safeProjection(loaded);
      const entries = projected.recent_public_entries;
      const events = loadedEvents(loaded);
      if (events.length !== projected.source.event_count) fail();
      if (events.length < minimumSourceEventCount) {
        return result('compaction_not_needed', {
          project_id: projected.project_id,
          conversation_id: projected.conversation_id,
          source_event_count: events.length,
        });
      }
      const refs = sourceRefs(entries);
      if (refs.length < 1) {
        return result('compaction_not_needed', {
          project_id: projected.project_id,
          conversation_id: projected.conversation_id,
          source_event_count: events.length,
        });
      }
      const taskAddressId = currentTaskAddressId(Reflect.apply(readAddress, addressStore, [{
        project_id: projected.project_id,
        conversation_id: projected.conversation_id,
      }]), projected.project_id, projected.conversation_id);
      if (taskAddressId === null) {
        return result('task_address_absent', {
          project_id: projected.project_id,
          conversation_id: projected.conversation_id,
          source_event_count: events.length,
        });
      }
      const sourceEventStartId = safePattern(valueAt(events[0], 'event_id'), EVENT_ID_PATTERN);
      const sourceRangeDigest = digest({
        conversation_id: projected.conversation_id,
        task_address_id: taskAddressId,
        source_event_start_id: sourceEventStartId,
        source_event_end_id: projected.source.current_event_id,
        source_event_count: events.length,
      });
      const latest = Reflect.apply(readLatestSummary, store, [{
        conversation_id: projected.conversation_id,
        task_address_id: taskAddressId,
      }]);
      if (isPlainObject(latest) && valueAt(latest, 'status') === 'ready') {
        const latestWrapper = valueAt(latest, 'context_compaction_summary');
        exactObject(latestWrapper, ['context_compaction_summary']);
        const latestSummary = valueAt(latestWrapper, 'context_compaction_summary');
        if (
          isPlainObject(latestSummary)
          && valueAt(latestSummary, 'source_range_digest') === sourceRangeDigest
        ) {
          return result('compaction_summary_replayed', {
            project_id: projected.project_id,
            conversation_id: projected.conversation_id,
            task_address_id: taskAddressId,
            summary_id: valueAt(latestSummary, 'summary_id'),
            summary_digest: valueAt(latestSummary, 'digest'),
            source_range_digest: sourceRangeDigest,
            source_event_count: events.length,
          });
        }
        const latestSourceEventCount = safeCount(valueAt(latestSummary, 'source_event_count'), 1, 10_000);
        if (
          latestSourceEventCount >= events.length
          || events.length - latestSourceEventCount < minimumSourceEventCount
        ) {
          return result('compaction_not_needed', {
            project_id: projected.project_id,
            conversation_id: projected.conversation_id,
            source_event_count: events.length,
          });
        }
      }
      const summaryValue = summaryText(entries, projected.public_entry_count, events.length);
      const before = tokenEstimateForProjection(projected);
      const after = Math.max(1, Math.min(before - 1, Math.ceil(Buffer.byteLength(summaryValue, 'utf8') / 4)));
      const summary = createBuilderContextCompactionSummary({
        conversation_id: projected.conversation_id,
        task_address_id: taskAddressId,
        source_event_start_id: sourceEventStartId,
        source_event_end_id: projected.source.current_event_id,
        source_event_count: events.length,
        token_budget_before: before,
        token_budget_after: after,
        summary: summaryValue,
        durable_decisions: [],
        unresolved_questions: [],
        omitted_large_outputs: projected.omitted_public_entries_digest === null ? [] : [{
          source_kind: 'tool_output',
          source_digest: projected.omitted_public_entries_digest,
          reason: 'Older public transcript entries are referenced by digest only.',
        }],
        source_refs: refs,
        created_at_ms: safeCount(Reflect.apply(nowMs, undefined, []), 0, Number.MAX_SAFE_INTEGER),
      });
      const recorded = Reflect.apply(recordSummary, store, [{
        context_compaction_summary: summary,
      }]);
      const operation = recorded.operation === 'context_compaction_summary_replayed'
        ? 'compaction_summary_replayed'
        : 'compaction_summary_recorded';
      return result(operation, {
        project_id: projected.project_id,
        conversation_id: projected.conversation_id,
        task_address_id: taskAddressId,
        summary_id: summary.summary_id,
        summary_digest: summary.digest,
        source_range_digest: summary.source_range_digest,
        source_event_count: summary.source_event_count,
      });
    },
  });
}

module.exports = Object.freeze({
  BuilderContextCompactionRecordingServiceError,
  RESULT_VERSION,
  SERVICE_VERSION,
  createBuilderContextCompactionRecordingService,
});
