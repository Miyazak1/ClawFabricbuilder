'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
  BuilderContextUsageProjectionError,
  projectBuilderContextUsage,
  sanitizeBuilderContextUsageProjection,
} = require('../electron/builder-context-usage-projection.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID =
  `builder-conversation:${UUID}:223e4567-e89b-42d3-a456-426614174000`;
const RUN_ID = `builder-run:${UUID}`;
const OTHER_RUN_ID = 'builder-run:223e4567-e89b-42d3-a456-426614174000';
const TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174001';

function conversationRuntimeEvent(eventType, payload, occurredAtMs, runId = RUN_ID) {
  return {
    event_type: 'programming_runtime_event_recorded',
    payload: { runtime_event: { run_id: runId, occurred_at_ms: occurredAtMs, event_type: eventType, payload } },
  };
}

function usage(payload, occurredAtMs, runId = RUN_ID) {
  return conversationRuntimeEvent('context_usage_projected', {
    harness_projection_seq: 42,
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
    ...payload,
  }, occurredAtMs, runId);
}

function activity(activityKind, occurredAtMs, runId = RUN_ID) {
  return conversationRuntimeEvent('runtime_activity_status', {
    activity_kind: activityKind,
    status: activityKind === 'context_compacting' ? 'Compacting context' : 'Context compacted',
  }, occurredAtMs, runId);
}

function manualCompaction(status, recordedAtMs, runId = RUN_ID) {
  const completed = status === 'compaction_completed';
  return {
    event_type: 'context_compaction_recorded',
    payload: {
      turn_id: `builder-turn:${UUID}`,
      run_id: runId,
      task_id: `builder-task:${UUID}`,
      task_address_id: TASK_ADDRESS_ID,
      admission_id: `builder-context-compaction-admission:${(completed ? 'a' : 'b').repeat(64)}`,
      conversation_compaction_projection_digest: `sha256:${'c'.repeat(64)}`,
      operation: completed ? 'manual_compaction_completed' : 'manual_compaction_noop',
      status,
      compaction_id: completed ? 'deepseek-compaction:manual-1' : null,
      start_seq: completed ? 8 : null,
      summary_seq: completed ? 9 : null,
      end_seq: completed ? 10 : null,
      shadowed_token_count: completed ? 48_000 : null,
      recorded_at_ms: recordedAtMs,
    },
  };
}

function legacyModelUsage(occurredAtMs) {
  return conversationRuntimeEvent('model_usage_recorded', {
    input_tokens: 190_000,
    output_tokens: 5_000,
    cache_read_tokens: 12_000,
    cache_write_tokens: null,
    reasoning_tokens: 1_000,
    context_window_tokens: 258_000,
  }, occurredAtMs);
}

function project(events) {
  return projectBuilderContextUsage({ project_id: PROJECT_ID, conversation_id: CONVERSATION_ID, events });
}

function assertProjectionError(error) {
  assert.equal(error instanceof BuilderContextUsageProjectionError, true);
  assert.equal(error.code, 'builder_context_usage_projection_invalid');
  assert.equal(error.message, 'Builder context usage is unavailable.');
  return true;
}

test('uses native Harness pressure for occupancy and durable buckets for cache accounting', () => {
  const projection = project([usage({}, 1_000)]);
  assert.deepEqual(projection, {
    projection_version: BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
    authority: 'main_owned_context_usage_projection',
    source: 'deepseek_harness_session_projection',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    harness_projection_seq: 42,
    measurement_state: 'ready',
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
    usage_percent: 79,
    cache_hit_percent: 90,
    compaction_state: 'idle',
    last_compacted_at_ms: null,
    updated_at_ms: 1_000,
  });
  assert.equal(Object.isFrozen(projection), true);
});

test('keeps durable cache totals while native post-compaction pressure drops', () => {
  const before = usage({}, 1_000);
  const compacting = activity('context_compacting', 1_100);
  const compacted = activity('context_compacted', 1_200);
  assert.deepEqual(project([before, compacting]), {
    ...project([before]),
    compaction_state: 'compacting',
    updated_at_ms: 1_100,
  });
  assert.deepEqual(project([before, compacting, compacted]), {
    ...project([before]),
    measurement_state: 'awaiting_post_compaction_projection',
    compaction_state: 'compacted',
    last_compacted_at_ms: 1_200,
    updated_at_ms: 1_200,
  });
  assert.deepEqual(project([before, compacting, compacted, usage({
    harness_projection_seq: 52,
    uncached_input_tokens: 22_000,
    output_tokens: 6_000,
    cache_read_tokens: 190_000,
    pressure_tokens: 30_000,
    projected_tokens: 31_000,
  }, 1_300)]), {
    ...project([before]),
    harness_projection_seq: 52,
    measurement_state: 'ready',
    uncached_input_tokens: 22_000,
    output_tokens: 6_000,
    cache_read_tokens: 190_000,
    pressure_tokens: 30_000,
    projected_tokens: 31_000,
    usage_percent: 12,
    compaction_state: 'compacted',
    last_compacted_at_ms: 1_200,
    updated_at_ms: 1_300,
  });
});

test('uses Main-recorded manual compaction events as durable lifecycle facts', () => {
  assert.deepEqual(project([
    usage({}, 1_000),
    manualCompaction('compaction_completed', 1_200),
  ]), {
    ...project([usage({}, 1_000)]),
    measurement_state: 'awaiting_post_compaction_projection',
    compaction_state: 'compacted',
    last_compacted_at_ms: 1_200,
    updated_at_ms: 1_200,
  });

  assert.deepEqual(project([
    usage({}, 1_000),
    manualCompaction('compaction_not_needed', 1_200),
  ]), project([usage({}, 1_000)]));
});

test('keeps compaction lifecycle scoped to the run that produced the usage projection', () => {
  assert.deepEqual(project([
    usage({}, 1_000),
    activity('context_compacting', 1_100, OTHER_RUN_ID),
    activity('context_compacted', 1_200, OTHER_RUN_ID),
  ]), project([usage({}, 1_000)]));

  assert.deepEqual(project([
    activity('context_compacting', 900, RUN_ID),
    activity('context_compacted', 950, RUN_ID),
    usage({}, 1_000, OTHER_RUN_ID),
  ]), {
    ...project([usage({}, 1_000)]),
    run_id: OTHER_RUN_ID,
  });
});

test('does not fall back to legacy model-usage arithmetic and rejects forged percentages', () => {
  assert.equal(project([]), null);
  assert.equal(project([legacyModelUsage(1_000)]), null);
  assert.equal(projectBuilderContextUsage({
    project_id: PROJECT_ID,
    conversation_id: `builder-conversation:${UUID}`,
    events: [usage({}, 1_000)],
  }), null);
  const forged = { ...project([usage({}, 1_000)]), usage_percent: 99 };
  assert.throws(() => sanitizeBuilderContextUsageProjection(forged), assertProjectionError);
});
