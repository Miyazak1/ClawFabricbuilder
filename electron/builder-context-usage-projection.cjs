'use strict';

const { types: utilTypes } = require('node:util');

const {
  parseBuilderConversationAddress,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');

const BUILDER_CONTEXT_USAGE_PROJECTION_VERSION = 'builder-context-usage-projection.v2';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'authority', 'source', 'project_id', 'conversation_id', 'run_id',
  'harness_projection_seq', 'measurement_state', 'uncached_input_tokens', 'output_tokens',
  'cache_read_tokens', 'cache_write_tokens', 'pressure_tokens', 'projected_tokens',
  'context_window_tokens', 'usage_percent', 'cache_hit_percent', 'compaction_state',
  'last_compacted_at_ms', 'updated_at_ms',
]);

class BuilderContextUsageProjectionError extends Error {
  constructor() {
    super('Builder context usage is unavailable.');
    this.name = 'BuilderContextUsageProjectionError';
    this.code = 'builder_context_usage_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderContextUsageProjectionError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeCount(value, minimum = 0, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function nullableCount(value, minimum = 0) {
  return value === null ? null : safeCount(value, minimum);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail();
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function calculateUsagePercent(projectedTokens, pressureTokens, contextWindowTokens) {
  const occupiedTokens = projectedTokens ?? pressureTokens;
  return occupiedTokens === null || contextWindowTokens === null
    ? null
    : Math.min(100, Math.round((occupiedTokens / contextWindowTokens) * 100));
}

function calculateCacheHitPercent(uncachedInputTokens, cacheReadTokens, cacheWriteTokens) {
  const totalInputTokens = uncachedInputTokens + cacheReadTokens + cacheWriteTokens;
  return totalInputTokens === 0
    ? null
    : Math.min(100, Math.round((cacheReadTokens / totalInputTokens) * 100));
}

function sanitizeBuilderContextUsageProjection(value) {
  const source = exactObject(value, PROJECTION_KEYS);
  if (valueAt(source, 'projection_version') !== BUILDER_CONTEXT_USAGE_PROJECTION_VERSION
    || valueAt(source, 'authority') !== 'main_owned_context_usage_projection'
    || valueAt(source, 'source') !== 'deepseek_harness_session_projection') fail();
  const projectId = safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN);
  const runId = safePattern(valueAt(source, 'run_id'), RUN_ID_PATTERN);
  const harnessProjectionSeq = safeCount(valueAt(source, 'harness_projection_seq'), -1);
  const measurementState = valueAt(source, 'measurement_state');
  if (!['ready', 'awaiting_usage', 'awaiting_post_compaction_projection'].includes(measurementState)) fail();
  const uncachedInputTokens = safeCount(valueAt(source, 'uncached_input_tokens'));
  const outputTokens = safeCount(valueAt(source, 'output_tokens'));
  const cacheReadTokens = safeCount(valueAt(source, 'cache_read_tokens'));
  const cacheWriteTokens = safeCount(valueAt(source, 'cache_write_tokens'));
  const pressureTokens = nullableCount(valueAt(source, 'pressure_tokens'));
  const projectedTokens = nullableCount(valueAt(source, 'projected_tokens'));
  const contextWindowTokens = nullableCount(valueAt(source, 'context_window_tokens'), 1);
  const usagePercent = nullableCount(valueAt(source, 'usage_percent'));
  const cacheHitPercent = nullableCount(valueAt(source, 'cache_hit_percent'));
  if ((usagePercent !== null && usagePercent > 100)
    || (cacheHitPercent !== null && cacheHitPercent > 100)
    || (projectedTokens !== null && pressureTokens === null)) fail();
  const compactionState = valueAt(source, 'compaction_state');
  if (!['idle', 'compacting', 'compacted'].includes(compactionState)) fail();
  const lastCompactedAtMs = valueAt(source, 'last_compacted_at_ms') === null
    ? null
    : safeTimestamp(valueAt(source, 'last_compacted_at_ms'));
  const updatedAtMs = safeTimestamp(valueAt(source, 'updated_at_ms'));
  const expectedMeasurementState = measurementState === 'awaiting_post_compaction_projection'
    ? measurementState
    : pressureTokens === null ? 'awaiting_usage' : 'ready';
  if (measurementState !== expectedMeasurementState
    || usagePercent !== calculateUsagePercent(projectedTokens, pressureTokens, contextWindowTokens)
    || cacheHitPercent !== calculateCacheHitPercent(uncachedInputTokens, cacheReadTokens, cacheWriteTokens)
    || (compactionState === 'idle' && lastCompactedAtMs !== null)
    || (measurementState === 'awaiting_post_compaction_projection' && lastCompactedAtMs === null)
    || (lastCompactedAtMs !== null && lastCompactedAtMs > updatedAtMs)) fail();
  return freezeDeep({
    projection_version: BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
    authority: 'main_owned_context_usage_projection',
    source: 'deepseek_harness_session_projection',
    project_id: projectId,
    conversation_id: conversationId,
    run_id: runId,
    harness_projection_seq: harnessProjectionSeq,
    measurement_state: measurementState,
    uncached_input_tokens: uncachedInputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    pressure_tokens: pressureTokens,
    projected_tokens: projectedTokens,
    context_window_tokens: contextWindowTokens,
    usage_percent: usagePercent,
    cache_hit_percent: cacheHitPercent,
    compaction_state: compactionState,
    last_compacted_at_ms: lastCompactedAtMs,
    updated_at_ms: updatedAtMs,
  });
}

function runtimeEventFromConversationEvent(event) {
  if (!isPlainObject(event) || valueAt(event, 'event_type') !== 'programming_runtime_event_recorded') {
    return null;
  }
  const payload = valueAt(event, 'payload');
  if (!isPlainObject(payload)) fail();
  const runtimeEvent = valueAt(payload, 'runtime_event');
  if (!isPlainObject(runtimeEvent)) fail();
  return runtimeEvent;
}

function manualContextCompactionFromConversationEvent(event) {
  if (!isPlainObject(event) || valueAt(event, 'event_type') !== 'context_compaction_recorded') {
    return null;
  }
  const payload = valueAt(event, 'payload');
  if (!isPlainObject(payload)) fail();
  return payload;
}

function projectBuilderContextUsage(rawInput) {
  exactObject(rawInput, ['project_id', 'conversation_id', 'events']);
  const projectId = safePattern(valueAt(rawInput, 'project_id'), PROJECT_ID_PATTERN);
  let conversationId;
  let conversationAddress;
  try {
    conversationId = sanitizeBuilderConversationAddress(projectId, valueAt(rawInput, 'conversation_id'));
    conversationAddress = parseBuilderConversationAddress(conversationId);
  } catch {
    fail();
  }
  if (conversationAddress.format !== 'task_conversation') return null;
  safePattern(conversationId, CONVERSATION_ID_PATTERN);
  const events = valueAt(rawInput, 'events');
  if (!Array.isArray(events) || utilTypes.isProxy(events) || events.length > 4096) fail();
  let latestProjection = null;
  let latestProjectionPosition = -1;
  const compactionsByRun = new Map();
  for (let position = 0; position < events.length; position += 1) {
    const manualCompaction = manualContextCompactionFromConversationEvent(events[position]);
    if (manualCompaction !== null) {
      const runId = safePattern(valueAt(manualCompaction, 'run_id'), RUN_ID_PATTERN);
      const status = valueAt(manualCompaction, 'status');
      const recordedAtMs = safeTimestamp(valueAt(manualCompaction, 'recorded_at_ms'));
      if (status === 'compaction_completed') {
        const current = compactionsByRun.get(runId) ?? {
          compaction_state: 'idle',
          last_compacted_at_ms: null,
          last_compacted_position: -1,
          updated_at_ms: 0,
        };
        compactionsByRun.set(runId, {
          compaction_state: 'compacted',
          last_compacted_at_ms: recordedAtMs,
          last_compacted_position: position,
          updated_at_ms: Math.max(current.updated_at_ms, recordedAtMs),
        });
      }
      continue;
    }
    const runtimeEvent = runtimeEventFromConversationEvent(events[position]);
    if (runtimeEvent === null) continue;
    const eventType = valueAt(runtimeEvent, 'event_type');
    const runId = safePattern(valueAt(runtimeEvent, 'run_id'), RUN_ID_PATTERN);
    const occurredAtMs = safeTimestamp(valueAt(runtimeEvent, 'occurred_at_ms'));
    if (eventType === 'context_usage_projected') {
      const payload = exactObject(valueAt(runtimeEvent, 'payload'), [
        'harness_projection_seq', 'uncached_input_tokens', 'output_tokens',
        'cache_read_tokens', 'cache_write_tokens', 'pressure_tokens',
        'projected_tokens', 'context_window_tokens',
      ]);
      latestProjection = {
        run_id: runId,
        harness_projection_seq: safeCount(valueAt(payload, 'harness_projection_seq'), -1),
        uncached_input_tokens: safeCount(valueAt(payload, 'uncached_input_tokens')),
        output_tokens: safeCount(valueAt(payload, 'output_tokens')),
        cache_read_tokens: safeCount(valueAt(payload, 'cache_read_tokens')),
        cache_write_tokens: safeCount(valueAt(payload, 'cache_write_tokens')),
        pressure_tokens: nullableCount(valueAt(payload, 'pressure_tokens')),
        projected_tokens: nullableCount(valueAt(payload, 'projected_tokens')),
        context_window_tokens: nullableCount(valueAt(payload, 'context_window_tokens'), 1),
      };
      if (latestProjection.projected_tokens !== null && latestProjection.pressure_tokens === null) fail();
      latestProjectionPosition = position;
      latestProjection.occurred_at_ms = occurredAtMs;
      continue;
    }
    if (eventType !== 'runtime_activity_status') continue;
    const payload = valueAt(runtimeEvent, 'payload');
    if (!isPlainObject(payload)) fail();
    const activityKind = valueAt(payload, 'activity_kind');
    const current = compactionsByRun.get(runId) ?? {
      compaction_state: 'idle',
      last_compacted_at_ms: null,
      last_compacted_position: -1,
      updated_at_ms: 0,
    };
    if (activityKind === 'context_compacting') {
      compactionsByRun.set(runId, {
        ...current,
        compaction_state: 'compacting',
        updated_at_ms: Math.max(current.updated_at_ms, occurredAtMs),
      });
    } else if (activityKind === 'context_compacted') {
      compactionsByRun.set(runId, {
        compaction_state: 'compacted',
        last_compacted_at_ms: occurredAtMs,
        last_compacted_position: position,
        updated_at_ms: Math.max(current.updated_at_ms, occurredAtMs),
      });
    }
  }
  if (latestProjection === null) return null;
  const compaction = compactionsByRun.get(latestProjection.run_id) ?? {
    compaction_state: 'idle',
    last_compacted_at_ms: null,
    last_compacted_position: -1,
    updated_at_ms: 0,
  };
  const measurementState = compaction.last_compacted_position > latestProjectionPosition
    ? 'awaiting_post_compaction_projection'
    : latestProjection.pressure_tokens === null ? 'awaiting_usage' : 'ready';
  const updatedAtMs = Math.max(latestProjection.occurred_at_ms, compaction.updated_at_ms);
  return sanitizeBuilderContextUsageProjection({
    projection_version: BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
    authority: 'main_owned_context_usage_projection',
    source: 'deepseek_harness_session_projection',
    project_id: projectId,
    conversation_id: conversationId,
    run_id: latestProjection.run_id,
    harness_projection_seq: latestProjection.harness_projection_seq,
    measurement_state: measurementState,
    uncached_input_tokens: latestProjection.uncached_input_tokens,
    output_tokens: latestProjection.output_tokens,
    cache_read_tokens: latestProjection.cache_read_tokens,
    cache_write_tokens: latestProjection.cache_write_tokens,
    pressure_tokens: latestProjection.pressure_tokens,
    projected_tokens: latestProjection.projected_tokens,
    context_window_tokens: latestProjection.context_window_tokens,
    usage_percent: calculateUsagePercent(
      latestProjection.projected_tokens,
      latestProjection.pressure_tokens,
      latestProjection.context_window_tokens,
    ),
    cache_hit_percent: calculateCacheHitPercent(
      latestProjection.uncached_input_tokens,
      latestProjection.cache_read_tokens,
      latestProjection.cache_write_tokens,
    ),
    compaction_state: compaction.compaction_state,
    last_compacted_at_ms: compaction.last_compacted_at_ms,
    updated_at_ms: updatedAtMs,
  });
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
  BuilderContextUsageProjectionError,
  projectBuilderContextUsage,
  sanitizeBuilderContextUsageProjection,
});
