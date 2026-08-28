'use strict';

const { performance } = require('node:perf_hooks');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  projectBuilderTaskStream,
} = require('../electron/builder-task-stream-projection.cjs');

const BASELINE_VERSION = 'builder-event-projection-baseline.v1';
const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
const DIGEST = `sha256:${'1'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function previousHead(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function append(events, eventType, payload, index) {
  const previous = events.at(-1) ?? null;
  events.push(createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: id('command', index),
    event_type: eventType,
    previous_event: previousHead(previous),
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  }));
}

function routeDecision(messageId, index) {
  return {
    decision_id: id('route-decision', index),
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: messageId,
    task_id: null,
    route: 'answer',
    confidence: 'high',
    matched_signals: ['read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: [],
    permission_result: 'not_required',
    dispatch: 'reply',
    decided_at_ms: index,
  };
}

function syntheticConversation(eventCount) {
  const events = [];
  const turnCount = Math.floor(eventCount / 4);
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const seed = turn * 10;
    const turnId = id('turn', turn);
    const runId = id('run', turn);
    const userMessageId = id('message', seed);
    append(events, 'turn_submitted', {
      message: { message_id: userMessageId, text: 'Synthetic baseline request.' },
      turn_id: turnId,
      mode: 'question',
      task: null,
      base_revision: null,
      route_decision: routeDecision(userMessageId, seed),
    }, seed);
    append(events, 'run_started', {
      turn_id: turnId,
      run_id: runId,
      task_id: null,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: DIGEST,
    }, seed + 1);
    append(events, 'run_completed', {
      turn_id: turnId,
      run_id: runId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      result_digest: DIGEST,
      assistant_message: {
        message_id: id('message', seed + 1),
        text: 'Synthetic baseline response.',
      },
      candidate_result: null,
      plan_admission: null,
    }, seed + 2);
    append(events, 'turn_completed', {
      turn_id: turnId,
      run_id: runId,
      outcome: 'answered',
    }, seed + 3);
  }
  return {
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
      events,
    },
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function measure(eventCount, repetitions) {
  const input = syntheticConversation(eventCount);
  projectBuilderTaskStream(input);
  const samples = [];
  for (let index = 0; index < repetitions; index += 1) {
    const startedAt = performance.now();
    projectBuilderTaskStream(input);
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  return {
    event_count: eventCount,
    repetitions,
    median_ms: rounded(percentile(samples, 0.5)),
    p95_ms: rounded(percentile(samples, 0.95)),
    maximum_ms: rounded(samples.at(-1)),
  };
}

function main(argv) {
  const quick = argv.includes('--quick');
  const eventCounts = quick ? [40, 100] : [100, 400, 800, 1_200];
  const repetitions = quick ? 3 : 7;
  const result = {
    baseline_version: BASELINE_VERSION,
    workload: 'synthetic_four_event_answer_turns',
    content_policy: 'fixed_synthetic_content_only',
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    measurements: eventCounts.map((eventCount) => measure(eventCount, repetitions)),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main(process.argv.slice(2));
