'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');
const {
  projectBuilderTaskStream,
} = require('../electron/builder-task-stream-projection.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('../electron/builder-programming-runtime-events.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID =
  `builder-conversation:${UUID}:22345678-1234-4234-8234-123456789abc`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const MESSAGE_ID = `builder-message:${UUID}`;
const RUNTIME_MESSAGE_ID = id('message', 2);
const DIGEST = `sha256:${'a'.repeat(64)}`;
const STEP_ID = id('run-step', 1);
const TOOL_CALL_ID = id('tool-call', 1);

function id(kind, tail) {
  return `builder-${kind}:00000000-0000-4000-8000-${tail.toString(16).padStart(12, '0')}`;
}

function appendConversation(events, eventType, payload) {
  const previous = events.at(-1) ?? null;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', events.length + 1),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function activeWorkEvents() {
  let events = [];
  events = appendConversation(events, 'turn_submitted', {
    message: { message_id: MESSAGE_ID, text: 'Update the timer.' },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Update timer' },
    base_revision: null,
    route_decision: {
      decision_id: `builder-route-decision:${UUID}`,
      decision_version: 'builder-composer-route-decision.v1',
      project_id: PROJECT_ID,
      message_id: MESSAGE_ID,
      task_id: TASK_ID,
      route: 'build',
      confidence: 'high',
      matched_signals: ['clear_build'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: ['write_project'],
      permission_result: 'allowed',
      dispatch: 'build',
      decided_at_ms: 1,
    },
  });
  return appendConversation(events, 'run_started', {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST,
  });
}

function runtimeJournal() {
  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'fake.multi_step',
    implementation_version: '0.1.0-test.1',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'runtime_local',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
  const contract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: DIGEST,
        writable: true,
      },
      provider_config_digest: DIGEST,
      allowed_tools: ['read', 'search', 'edit', 'write', 'command'],
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: { message_id: MESSAGE_ID, text: 'Update the timer.' },
  });
  return createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
}

function runtimeCandidate(eventType, payload, overrides = {}) {
  return {
    protocol_version: 'builder-programming-runtime.v1',
    runtime_event_ref: overrides.runtime_event_ref ?? `test:${eventType}`,
    run_id: RUN_ID,
    occurred_at_ms: overrides.occurred_at_ms ?? 20,
    turn_id: overrides.turn_id ?? null,
    step_id: overrides.step_id ?? null,
    tool_call_id: overrides.tool_call_id ?? null,
    event_type: eventType,
    payload,
  };
}

test('persists and replays the canonical runtime chain inside conversation authority', () => {
  const journal = runtimeJournal();
  const runtimeStarted = journal.append(runtimeCandidate('run_started', { mode: 'build' }), 21);
  const turnStarted = journal.append(runtimeCandidate('turn_started', {
    message_id: MESSAGE_ID,
  }, {
    runtime_event_ref: 'test:turn_started',
    turn_id: TURN_ID,
  }), 22);
  const stepStarted = journal.append(runtimeCandidate('step_started', {
    step_index: 1,
  }, {
    runtime_event_ref: 'test:step_started',
    occurred_at_ms: 23,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 24);
  const narration = 'I found the timer page and will update its heading next.';
  const assistantDelta = journal.append(runtimeCandidate('assistant_text_delta', {
    message_id: RUNTIME_MESSAGE_ID,
    delta_text: narration,
  }, {
    runtime_event_ref: 'test:assistant_delta',
    occurred_at_ms: 25,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 26);
  const assistantCompleted = journal.append(runtimeCandidate('assistant_text_completed', {
    message_id: RUNTIME_MESSAGE_ID,
    text_digest: `sha256:${nodeCrypto.createHash('sha256').update(narration, 'utf8').digest('hex')}`,
    text_bytes: Buffer.byteLength(narration, 'utf8'),
  }, {
    runtime_event_ref: 'test:assistant_completed',
    occurred_at_ms: 27,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 28);
  const toolStarted = journal.appendMainFact(runtimeCandidate('tool_call_started', {
    tool_kind: 'edit',
    active_label: 'Editing index.html',
    completed_label: 'Edited index.html',
    target_label: 'index.html',
    presentation: 'changes',
    argument_digest: DIGEST,
  }, {
    runtime_event_ref: 'test:tool_started',
    occurred_at_ms: 29,
    turn_id: TURN_ID,
    step_id: STEP_ID,
    tool_call_id: TOOL_CALL_ID,
  }), 30);
  const fileChanged = journal.appendMainFact(runtimeCandidate('file_change_recorded', {
    change_ref: `builder-runtime-file-change:${'b'.repeat(64)}`,
    resource_id: 'project:/index.html',
    change_kind: 'edited',
    added_lines: 4,
    deleted_lines: 1,
  }, {
    runtime_event_ref: 'test:file_changed',
    occurred_at_ms: 31,
    turn_id: TURN_ID,
    step_id: STEP_ID,
    tool_call_id: TOOL_CALL_ID,
  }), 32);
  const toolCompleted = journal.appendMainFact(runtimeCandidate('tool_call_completed', {
    duration_ms: 12,
    result_kind: 'edit',
    result_ref: `builder-runtime-tool-result:${'c'.repeat(64)}`,
    summary: 'Edited index.html.',
  }, {
    runtime_event_ref: 'test:tool_completed',
    occurred_at_ms: 33,
    turn_id: TURN_ID,
    step_id: STEP_ID,
    tool_call_id: TOOL_CALL_ID,
  }), 34);

  let events = activeWorkEvents();
  for (const runtimeEvent of [
    runtimeStarted,
    turnStarted,
    stepStarted,
    assistantDelta,
    assistantCompleted,
    toolStarted,
    fileChanged,
    toolCompleted,
  ]) {
    events = appendConversation(events, 'programming_runtime_event_recorded', {
      runtime_event: runtimeEvent,
    });
  }

  const replay = replayBuilderConversation(events);
  const run = replay.turns[0].runs[0];
  assert.deepEqual(
    run.runtime_events.map((event) => [event.sequence, event.event_type]),
    [
      [1, 'run_started'],
      [2, 'turn_started'],
      [3, 'step_started'],
      [4, 'assistant_text_delta'],
      [5, 'assistant_text_completed'],
      [6, 'tool_call_started'],
      [7, 'file_change_recorded'],
      [8, 'tool_call_completed'],
    ],
  );
  assert.notEqual(run.runtime_events, journal.snapshot().events);

  const stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
      events,
    },
  });
  assert.equal(
    stream.conversation.items.some(
      (item) => item.item_kind === 'programming_runtime_event_recorded',
    ),
    false,
  );
  const runtimeActivity = stream.conversation.items.filter(
    (item) => item.item_kind === 'programming_runtime_tool_activity',
  );
  assert.equal(runtimeActivity.length, 3);
  const runtimeNarration = stream.conversation.items.find(
    (item) => item.item_kind === 'programming_runtime_assistant_message',
  );
  assert.deepEqual(runtimeNarration, {
    item_kind: 'programming_runtime_assistant_message',
    sequence: 7,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    step_id: STEP_ID,
    message: {
      message_id: RUNTIME_MESSAGE_ID,
      text: narration,
    },
  });
  assert.ok(runtimeNarration.sequence < runtimeActivity[0].sequence);
  assert.deepEqual(runtimeActivity.at(-1), {
    item_kind: 'programming_runtime_tool_activity',
    sequence: 10,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    step_id: STEP_ID,
    tool_call_id: TOOL_CALL_ID,
    tool_kind: 'edit',
    state: 'completed',
    active_label: 'Editing index.html',
    completed_label: 'Edited index.html',
    target_label: 'index.html',
    presentation: 'changes',
    status_label: null,
    duration_ms: 12,
    summary: 'Edited index.html.',
    failure_class: null,
    result_ref: `builder-runtime-tool-result:${'c'.repeat(64)}`,
    presentation_detail: null,
    file_change: {
      change_ref: `builder-runtime-file-change:${'b'.repeat(64)}`,
      change_kind: 'edited',
      added_lines: 4,
      deleted_lines: 1,
    },
    check_result: null,
  });
});

test('projects bounded Harness reasoning and runtime activity without reasoning text', () => {
  const journal = runtimeJournal();
  const runtimeEvents = [
    journal.append(runtimeCandidate('run_started', { mode: 'build' }), 21),
    journal.append(runtimeCandidate('turn_started', { message_id: MESSAGE_ID }, {
      runtime_event_ref: 'test:status_turn_started',
      turn_id: TURN_ID,
    }), 22),
    journal.append(runtimeCandidate('runtime_activity_status', {
      activity_kind: 'turn_preparing',
      status: '正在准备本轮任务',
    }, {
      runtime_event_ref: 'test:turn_preparing',
      occurred_at_ms: 23,
      turn_id: TURN_ID,
    }), 24),
    journal.append(runtimeCandidate('step_started', { step_index: 1 }, {
      runtime_event_ref: 'test:status_step_started',
      occurred_at_ms: 25,
      turn_id: TURN_ID,
      step_id: STEP_ID,
    }), 26),
    journal.append(runtimeCandidate('assistant_reasoning_status', {
      status: '正在思考',
    }, {
      runtime_event_ref: 'test:reasoning_status',
      occurred_at_ms: 27,
      turn_id: TURN_ID,
      step_id: STEP_ID,
    }), 28),
  ];
  let events = activeWorkEvents();
  for (const runtimeEvent of runtimeEvents) {
    events = appendConversation(events, 'programming_runtime_event_recorded', { runtime_event: runtimeEvent });
  }

  const stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: { conversation_id: CONVERSATION_ID, created_at_ms: 1, events },
  });
  const statuses = stream.conversation.items.filter(
    (item) => item.item_kind === 'programming_runtime_status',
  );

  assert.deepEqual(statuses.map((item) => [item.status_kind, item.activity_kind, item.status]), [
    ['activity', 'turn_preparing', '正在准备本轮任务'],
    ['reasoning', null, '正在思考'],
  ]);
  assert.doesNotMatch(JSON.stringify(stream), /private reasoning|chain.of.thought/iu);
});

test('projects live Harness context usage and the post-compaction token drop into the task stream', () => {
  const journal = runtimeJournal();
  const runtimeEvents = [
    journal.append(runtimeCandidate('run_started', { mode: 'build' }, {
      runtime_event_ref: 'test:context_run_started',
      occurred_at_ms: 20,
    }), 21),
    journal.append(runtimeCandidate('turn_started', { message_id: MESSAGE_ID }, {
      runtime_event_ref: 'test:context_turn_started',
      occurred_at_ms: 22,
      turn_id: TURN_ID,
    }), 23),
    journal.append(runtimeCandidate('step_started', { step_index: 1 }, {
      runtime_event_ref: 'test:context_step_started',
      occurred_at_ms: 24,
      turn_id: TURN_ID,
      step_id: STEP_ID,
    }), 25),
    journal.append(runtimeCandidate('context_usage_projected', {
      harness_projection_seq: 42,
      uncached_input_tokens: 20_000,
      output_tokens: 5_000,
      cache_read_tokens: 180_000,
      cache_write_tokens: 0,
      pressure_tokens: 200_000,
      projected_tokens: 205_000,
      context_window_tokens: 258_000,
    }, {
      runtime_event_ref: 'test:context_usage_before',
      occurred_at_ms: 26,
    }), 27),
    journal.append(runtimeCandidate('runtime_activity_status', {
      activity_kind: 'context_compacting',
      status: 'Compacting context',
    }, {
      runtime_event_ref: 'test:context_compacting',
      occurred_at_ms: 28,
      turn_id: TURN_ID,
      step_id: STEP_ID,
    }), 29),
    journal.append(runtimeCandidate('runtime_activity_status', {
      activity_kind: 'context_compacted',
      status: 'Context compacted',
    }, {
      runtime_event_ref: 'test:context_compacted',
      occurred_at_ms: 30,
      turn_id: TURN_ID,
      step_id: STEP_ID,
    }), 31),
    journal.append(runtimeCandidate('context_usage_projected', {
      harness_projection_seq: 52,
      uncached_input_tokens: 22_000,
      output_tokens: 6_000,
      cache_read_tokens: 190_000,
      cache_write_tokens: 0,
      pressure_tokens: 30_000,
      projected_tokens: 31_000,
      context_window_tokens: 258_000,
    }, {
      runtime_event_ref: 'test:context_usage_after',
      occurred_at_ms: 32,
    }), 33),
  ];

  let events = activeWorkEvents();
  for (const runtimeEvent of runtimeEvents.slice(0, -1)) {
    events = appendConversation(events, 'programming_runtime_event_recorded', {
      runtime_event: runtimeEvent,
    });
  }
  let stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: { conversation_id: CONVERSATION_ID, created_at_ms: 1, events },
  });
  const compactedProjection = {
    projection_version: 'builder-context-usage-projection.v2',
    authority: 'main_owned_context_usage_projection',
    source: 'deepseek_harness_session_projection',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    harness_projection_seq: 42,
    measurement_state: 'awaiting_post_compaction_projection',
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
    usage_percent: 79,
    cache_hit_percent: 90,
    compaction_state: 'compacted',
    last_compacted_at_ms: 30,
    updated_at_ms: 30,
  };
  assert.deepEqual(stream.context_usage_projection, compactedProjection);

  events = appendConversation(events, 'programming_runtime_event_recorded', {
    runtime_event: runtimeEvents.at(-1),
  });
  stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: { conversation_id: CONVERSATION_ID, created_at_ms: 1, events },
  });
  assert.deepEqual(stream.context_usage_projection, {
    ...compactedProjection,
    measurement_state: 'ready',
    harness_projection_seq: 52,
    uncached_input_tokens: 22_000,
    output_tokens: 6_000,
    cache_read_tokens: 190_000,
    pressure_tokens: 30_000,
    projected_tokens: 31_000,
    usage_percent: 12,
    updated_at_ms: 32,
  });
});

test('replay omits a discarded retry attempt and projects only the recovered narration', () => {
  const journal = runtimeJournal();
  const runtimeEvents = [];
  runtimeEvents.push(journal.append(runtimeCandidate('run_started', { mode: 'build' }), 21));
  runtimeEvents.push(journal.append(runtimeCandidate('turn_started', {
    message_id: MESSAGE_ID,
  }, {
    runtime_event_ref: 'test:retry_turn_started',
    turn_id: TURN_ID,
  }), 22));
  runtimeEvents.push(journal.append(runtimeCandidate('step_started', {
    step_index: 1,
  }, {
    runtime_event_ref: 'test:retry_step_started',
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 23));
  const failed = 'This partial must disappear.';
  runtimeEvents.push(journal.append(runtimeCandidate('assistant_text_delta', {
    message_id: RUNTIME_MESSAGE_ID,
    delta_text: failed,
  }, {
    runtime_event_ref: 'test:retry_failed_delta',
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 24));
  runtimeEvents.push(journal.append(runtimeCandidate('assistant_text_discarded', {
    message_id: RUNTIME_MESSAGE_ID,
    text_digest: `sha256:${nodeCrypto.createHash('sha256').update(failed, 'utf8').digest('hex')}`,
    text_bytes: Buffer.byteLength(failed, 'utf8'),
  }, {
    runtime_event_ref: 'test:retry_discarded',
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 25));
  const recovered = 'The provider recovered and I can continue.';
  runtimeEvents.push(journal.append(runtimeCandidate('assistant_text_delta', {
    message_id: RUNTIME_MESSAGE_ID,
    delta_text: recovered,
  }, {
    runtime_event_ref: 'test:retry_recovered_delta',
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 26));
  runtimeEvents.push(journal.append(runtimeCandidate('assistant_text_completed', {
    message_id: RUNTIME_MESSAGE_ID,
    text_digest: `sha256:${nodeCrypto.createHash('sha256').update(recovered, 'utf8').digest('hex')}`,
    text_bytes: Buffer.byteLength(recovered, 'utf8'),
  }, {
    runtime_event_ref: 'test:retry_recovered_completed',
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 27));

  let events = activeWorkEvents();
  for (const runtimeEvent of runtimeEvents) {
    events = appendConversation(events, 'programming_runtime_event_recorded', {
      runtime_event: runtimeEvent,
    });
  }
  const stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: { conversation_id: CONVERSATION_ID, created_at_ms: 1, events },
  });
  const narration = stream.conversation.items.filter(
    (item) => item.item_kind === 'programming_runtime_assistant_message',
  );
  assert.equal(narration.length, 1);
  assert.equal(narration[0].message.text, recovered);
  assert.doesNotMatch(JSON.stringify(stream), /This partial must disappear/u);
});

test('rejects duplicate or out-of-order runtime events during replay', () => {
  const journal = runtimeJournal();
  const runtimeStarted = journal.append(runtimeCandidate('run_started', { mode: 'build' }), 21);
  let events = activeWorkEvents();
  events = appendConversation(events, 'programming_runtime_event_recorded', {
    runtime_event: runtimeStarted,
  });
  events = appendConversation(events, 'programming_runtime_event_recorded', {
    runtime_event: runtimeStarted,
  });
  assert.throws(() => replayBuilderConversation(events));
});

test('omits unsafe runtime narration without making the task stream unavailable', () => {
  const journal = runtimeJournal();
  const runtimeStarted = journal.append(runtimeCandidate('run_started', { mode: 'build' }), 21);
  const turnStarted = journal.append(runtimeCandidate('turn_started', {
    message_id: MESSAGE_ID,
  }, {
    runtime_event_ref: 'test:unsafe_turn_started',
    turn_id: TURN_ID,
  }), 22);
  const stepStarted = journal.append(runtimeCandidate('step_started', {
    step_index: 1,
  }, {
    runtime_event_ref: 'test:unsafe_step_started',
    occurred_at_ms: 23,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 24);
  const narration = 'I will inspect C:\\Users\\Builder\\private-project before editing.';
  const assistantDelta = journal.append(runtimeCandidate('assistant_text_delta', {
    message_id: RUNTIME_MESSAGE_ID,
    delta_text: narration,
  }, {
    runtime_event_ref: 'test:unsafe_assistant_delta',
    occurred_at_ms: 25,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 26);
  const assistantCompleted = journal.append(runtimeCandidate('assistant_text_completed', {
    message_id: RUNTIME_MESSAGE_ID,
    text_digest: `sha256:${nodeCrypto.createHash('sha256').update(narration, 'utf8').digest('hex')}`,
    text_bytes: Buffer.byteLength(narration, 'utf8'),
  }, {
    runtime_event_ref: 'test:unsafe_assistant_completed',
    occurred_at_ms: 27,
    turn_id: TURN_ID,
    step_id: STEP_ID,
  }), 28);

  let events = activeWorkEvents();
  for (const runtimeEvent of [
    runtimeStarted,
    turnStarted,
    stepStarted,
    assistantDelta,
    assistantCompleted,
  ]) {
    events = appendConversation(events, 'programming_runtime_event_recorded', {
      runtime_event: runtimeEvent,
    });
  }
  const stream = projectBuilderTaskStream({
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
      events,
    },
  });

  assert.equal(
    stream.conversation.items.some(
      (item) => item.item_kind === 'programming_runtime_assistant_message',
    ),
    false,
  );
  assert.equal(stream.conversation.items.some((item) => item.item_kind === 'run_started'), true);
});
