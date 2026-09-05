'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('../electron/builder-programming-runtime-events.cjs');
const {
  BuilderHarnessRuntimeEventNormalizerError,
  createBuilderHarnessRuntimeEventNormalizer,
} = require('../electron/builder-harness-runtime-event-normalizer.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function descriptor() {
  return createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness.v1',
    implementation_version: '0.1.0-rc.5',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'none',
      cancellation: 'process',
      session_resume: 'none',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
}

function contract(mode = 'build', inputText = 'Update the project and check it.') {
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor(),
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode,
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: DIGEST,
        writable: mode === 'build',
      },
      provider_config_digest: DIGEST,
      allowed_tools: mode === 'build'
        ? ['read', 'search', 'edit', 'write', 'command', 'browser']
        : ['read', 'search'],
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: inputText,
    },
  });
}

function setup(mode = 'build', inputText = 'Update the project and check it.') {
  const runContract = contract(mode, inputText);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  const workspaceRoot = path.resolve('harness-workspace');
  let now = 1_000;
  const normalizer = createBuilderHarnessRuntimeEventNormalizer({
    run_contract: runContract,
    event_sink: {
      emit(candidate) {
        return journal.append(candidate, candidate.occurred_at_ms + 1);
      },
    },
    session_id: 'builder-session-1',
    workspace_root: workspaceRoot,
    clock() {
      now += 1;
      return now;
    },
  });
  return { journal, normalizer, workspaceRoot };
}

function sessionEvent(event) {
  return {
    method: 'session.event',
    params: {
      sessionId: 'builder-session-1',
      event,
    },
  };
}

function event(type, seq, data, extra = {}) {
  const surface = ['assistant/message', 'tool/result', 'user/message'].includes(type)
    && !Object.hasOwn(extra, 'surfaceOp')
    ? { surfaceOp: 'append' }
    : {};
  return { type, seq, time: 100 + seq, data, ...surface, ...extra };
}

function assistantMessage(text) {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: text.length === 0 ? [] : [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4' },
  };
}

function toolResult(callId, isError = false) {
  return {
    id: `result-${callId}`,
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'text', text: isError ? 'failed' : 'ok' }],
      ...(isError ? { isError: true } : {}),
    }],
    source: { kind: 'tool', callId },
  };
}

function commandMeta(command = 'npm run build', overrides = {}) {
  return {
    kind: 'command',
    status: 'passed',
    command,
    exitCode: 0,
    durationMs: 123,
    stdoutPreview: '',
    stderrPreview: '',
    truncated: false,
    ...overrides,
  };
}

test('normalizes one bounded native Harness context projection snapshot', async () => {
  const { journal, normalizer } = setup();
  await normalizer.start();
  assert.equal(await normalizer.handle_notification({
    method: 'session.context-usage',
    params: {
      sessionId: 'builder-session-1',
      projectionSeq: 42,
      uncachedInputTokens: 20_000,
      outputTokens: 5_000,
      cacheReadTokens: 180_000,
      cacheWriteTokens: 0,
      pressureTokens: 200_000,
      projectedTokens: 205_000,
      contextWindowTokens: 258_000,
    },
  }), true);
  const projected = journal.snapshot().events.find(
    (item) => item.event_type === 'context_usage_projected',
  );
  assert.deepEqual(projected?.payload, {
    harness_projection_seq: 42,
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
  });
  assert.equal(projected?.turn_id, null);
  await assert.rejects(normalizer.handle_notification({
    method: 'session.context-usage',
    params: {
      sessionId: 'builder-session-1',
      projectionSeq: 43,
      uncachedInputTokens: 20_000,
      outputTokens: 5_000,
      cacheReadTokens: 180_000,
      cacheWriteTokens: 0,
      pressureTokens: null,
      projectedTokens: 205_000,
      contextWindowTokens: 258_000,
    },
  }), BuilderHarnessRuntimeEventNormalizerError);
});

test('serializes repair with the trailing SDK idle notification before continuing a token-limited turn', async () => {
  const runContract = contract();
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  let now = 1_000;
  let emitting = 0;
  let maximumEmitting = 0;
  let holdRepair = false;
  let enteredRepair;
  let releaseRepair;
  const entered = new Promise((resolve) => { enteredRepair = resolve; });
  const released = new Promise((resolve) => { releaseRepair = resolve; });
  const normalizer = createBuilderHarnessRuntimeEventNormalizer({
    run_contract: runContract,
    session_id: 'builder-session-1',
    workspace_root: path.resolve('harness-workspace'),
    clock: () => ++now,
    event_sink: {
      async emit(candidate) {
        emitting += 1;
        maximumEmitting = Math.max(maximumEmitting, emitting);
        try {
          const result = journal.append(candidate, candidate.occurred_at_ms + 1);
          if (holdRepair && candidate.event_type === 'step_completed') {
            enteredRepair();
            await released;
          }
          return result;
        } finally {
          emitting -= 1;
        }
      },
    },
  });
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 3, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 4, { turn: 1, reason: { kind: 'max-tokens' } })));
  holdRepair = true;
  const repairing = normalizer.prepare_repair({ failure_summary: 'No implementation before the output limit.' });
  await entered;
  const idle = normalizer.handle_notification({
    method: 'session.status', params: { sessionId: 'builder-session-1', status: 'idle' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseRepair();
  await repairing;
  await idle;
  holdRepair = false;
  assert.equal(maximumEmitting, 1, 'lifecycle mutations must not race asynchronous persistence');
  await normalizer.handle_notification(sessionEvent(event('turn/start', 5, { turn: 2 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 6, { turn: 2, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 7, { turn: 2, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 8, { turn: 2, reason: { kind: 'completed' } })));
  await normalizer.complete_run({ checkpoint_status: 'not_applicable' });
  assert.equal(journal.snapshot().status, 'run_completed');
});

test('normalizes a successful Agent Test browser checkpoint as a public browser tool fact', async () => {
  const { journal, normalizer } = setup();
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-browser-open',
    name: 'browser_open_local_app',
    arguments: '{}',
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('call-browser-open'),
  })));

  const browserEvents = journal.snapshot().events.filter((item) => (
    item.event_type === 'tool_call_started' || item.event_type === 'tool_call_completed'
  ));
  assert.equal(browserEvents.length, 2);
  assert.equal(browserEvents[0].payload.tool_kind, 'browser');
  assert.equal(browserEvents[0].payload.presentation, 'browser');
  assert.equal(browserEvents[0].payload.target_label, 'Agent Test browser');
  assert.equal(browserEvents[1].payload.result_kind, 'browser');
  assert.match(browserEvents[1].payload.summary, /Opened Agent Test browser/u);
});

test('accepts the Harness inbox splice before the first public turn event', async () => {
  const { journal, normalizer } = setup();
  await normalizer.start();
  const accepted = await normalizer.handle_notification(sessionEvent(event(
    'agent/inbox/spliced',
    0,
    {
      target: 'next-turn',
      start: 0,
      inserted: [{
        content: [{ type: 'text', text: 'Update the project and check it.' }],
        source: { kind: 'user' },
        role: 'user',
        id: UUID,
      }],
    },
  )));
  assert.equal(accepted, false);
  assert.equal(await normalizer.handle_notification(sessionEvent(event(
    'session/title',
    1,
    { title: 'Update the project', messageSeqs: [0], source: { kind: 'fallback' } },
  ))), false);
  await normalizer.handle_notification(sessionEvent(event('turn/start', 2, { turn: 1 })));
  assert.deepEqual(
    journal.snapshot().events.map((item) => item.event_type),
    ['run_started', 'turn_started', 'runtime_activity_status'],
  );
  assert.equal(journal.snapshot().events[1].occurred_at_ms > 102, true);
  assert.equal(normalizer.snapshot().accepted_session_event_count, 3);
});

test('accepts Harness compaction lifecycle and replacement events without publishing summary text', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('compaction/prune', 2, {
    shadowedRange: { start: 0, end: 0 },
    shadowedSeqs: [0],
    shadowedTokenCount: 2_048,
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 3, {
    turn: 1,
    step: 1,
    message: toolResult('historical-call'),
  }, {
    surfaceOp: { op: 'replace', start: 0, end: 0 },
    sourceEventSeqs: [0],
  })));
  await normalizer.handle_notification(sessionEvent(event('compaction/start', 4, {
    compactionId: 'compaction-1',
    turn: 1,
  })));
  await normalizer.handle_notification(sessionEvent(event('compaction/summary', 5, {
    compactionId: 'compaction-1',
    summary: [{ type: 'text', text: 'private summary marker' }],
    shadowedRange: { start: 0, end: 0 },
    shadowedSeqs: [0],
    shadowedTokenCount: 2_048,
    provider: 'deepseek-official',
    model: 'deepseek-v4',
  })));
  await normalizer.handle_notification(sessionEvent(event('user/message', 6, {
    id: 'compaction-checkpoint',
    role: 'user',
    content: [{ type: 'text', text: 'private summary marker' }],
    source: { kind: 'compaction' },
  }, {
    surfaceOp: { op: 'replace', start: 0, end: 0 },
    sourceEventSeqs: [0, 4, 5],
  })));
  await normalizer.handle_notification(sessionEvent(event('compaction/end', 7, {
    compactionId: 'compaction-1',
    turn: 1,
  })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 8, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 9, {
    turn: 1,
    step: 1,
    message: assistantMessage('Continue after compaction.'),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 10, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 11, {
    turn: 1,
    reason: { kind: 'completed' },
  })));

  assert.deepEqual(await normalizer.when_settled(), { status: 'settled', reason: 'completed' });
  assert.equal(normalizer.snapshot().active_compaction_count, 0);
  assert.equal(normalizer.snapshot().accepted_session_event_count, 11);
  assert.doesNotMatch(JSON.stringify(journal.snapshot()), /private summary marker/u);
});

test('normalizes Harness streaming text and distinct file and command tool facts', async () => {
  const { journal, normalizer, workspaceRoot } = setup();
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 3, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'I will update ' },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 4, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'the timer.' },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 5, {
    turn: 1,
    step: 1,
    message: assistantMessage('I will update the timer.'),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 6, {
    turn: 1,
    step: 1,
    callId: 'call-edit',
    name: 'edit',
    arguments: JSON.stringify({
      file_path: path.join(workspaceRoot, 'src', 'timer.js'),
      old_string: 'old',
      new_string: 'new',
    }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 7, {
    turn: 1,
    step: 1,
    message: toolResult('call-edit'),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 8, {
    turn: 1,
    step: 1,
    callId: 'call-command',
    name: 'bash',
    arguments: JSON.stringify({ command: 'npm test' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 9, {
    turn: 1,
    step: 1,
    message: toolResult('call-command'),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 10, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 11, {
    turn: 1,
    reason: { kind: 'completed' },
  })));

  assert.deepEqual(await normalizer.when_settled(), { status: 'settled', reason: 'completed' });
  assert.equal(normalizer.snapshot().successful_mutation_tool_call_count, 1);
  await normalizer.complete_run({ checkpoint_status: 'created' });
  const events = journal.snapshot().events;
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.equal(
    events.filter((item) => item.event_type === 'assistant_text_delta')
      .map((item) => item.payload.delta_text)
      .join(''),
    'I will update the timer.',
  );
  assert.deepEqual(
    events.filter((item) => item.event_type === 'tool_call_started')
      .map((item) => [item.payload.tool_kind, item.payload.active_label]),
    [
      ['edit', 'Editing src/timer.js'],
      ['command', 'Running npm test'],
    ],
  );
  assert.equal(events.some((item) => item.event_type === 'file_change_recorded'), false);
  assert.equal(events.some((item) => item.event_type === 'check_result_recorded'), false);
});

test('projects reasoning chunks as a bounded Chinese status without exposing raw reasoning', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 3, {
    turn: 1,
    step: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: 'private chain of thought marker' },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 4, {
    turn: 1,
    step: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: 'more private reasoning' },
  })));

  const snapshot = journal.snapshot();
  assert.deepEqual(
    snapshot.events.filter((item) => item.event_type === 'assistant_reasoning_status')
      .map((item) => item.payload.status),
    ['正在思考'],
  );
  assert.deepEqual(
    snapshot.events.filter((item) => item.event_type === 'runtime_activity_status')
      .map((item) => item.payload.activity_kind),
    ['turn_preparing', 'step_analyzing'],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /private chain of thought marker|more private reasoning/u);
  await normalizer.handle_notification(sessionEvent(event('step/end', 5, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 6, { turn: 1, step: 2 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 7, {
    turn: 1, step: 2,
    chunk: { type: 'reasoning-delta', index: 0, text: 'private second-step reasoning' },
  })));
  const statuses = journal.snapshot().events.filter((item) => item.event_type === 'assistant_reasoning_status');
  assert.equal(statuses.length, 2, 'each model step must publish its own bounded thinking status');
  assert.notEqual(statuses[0].step_id, statuses[1].step_id);
  assert.doesNotMatch(JSON.stringify(journal.snapshot()), /private second-step reasoning/u);
});

test('localizes tool activity labels and summaries for a Chinese end-user request', async () => {
  const { journal, normalizer } = setup('build', '请修改项目并运行测试。');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-command-zh',
    name: 'bash',
    arguments: JSON.stringify({ command: 'npm test' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('call-command-zh'),
  })));

  const events = journal.snapshot().events;
  const started = events.find((item) => item.event_type === 'tool_call_started');
  const completed = events.find((item) => item.event_type === 'tool_call_completed');
  assert.equal(started.payload.active_label, '正在运行 npm test');
  assert.equal(started.payload.completed_label, '已运行 npm test');
  assert.equal(completed.payload.summary, '已运行 npm test。');
});

test('accepts empty provider deltas without manufacturing public text', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 3, {
    turn: 1,
    step: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: '' },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 4, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 1, text: '' },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 5, {
    turn: 1,
    step: 1,
    chunk: { type: 'tool-call-delta', index: 2, id: 'call-read', argumentsDelta: '' },
  })));

  const snapshot = journal.snapshot();
  assert.equal(snapshot.events.some((item) => item.event_type === 'assistant_text_delta'), false);
  assert.equal(snapshot.events.some((item) => item.event_type === 'assistant_reasoning_status'), false);
  assert.equal(
    snapshot.events.filter((item) => item.event_type === 'runtime_activity_status').at(-1).payload.status,
    '正在准备工具调用',
  );
});

test('preserves Harness usage, finish, todo, session, and subagent lifecycle facts', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  assert.equal(await normalizer.handle_notification({
    method: 'session.status',
    params: { sessionId: 'builder-session-1', status: 'running' },
  }), true);
  assert.equal(await normalizer.handle_notification({
    method: 'subagent.started',
    params: { parentSessionId: 'builder-session-1', childSessionId: 'child-session-1' },
  }), true);
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('request/context', 2, {
    provider: 'deepseek-official',
    model: 'deepseek-v4',
    contextWindow: 258_000,
  })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 3, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('todo/write', 4, {
    todos: [
      { content: 'Inspect the project', status: 'completed' },
      { content: 'Explain the result', status: 'in_progress' },
    ],
  })));
  const usage = {
    inputTokens: 120,
    outputTokens: 24,
    cacheReadTokens: 40,
    reasoningTokens: 8,
  };
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 5, {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 6, {
    turn: 1,
    step: 1,
    chunk: { type: 'finish', reason: { kind: 'stop' } },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 7, {
    turn: 1,
    step: 1,
    message: assistantMessage('已完成。'),
    usage,
  })));
  await normalizer.handle_notification({
    method: 'subagent.finished',
    params: {
      provider: 'local',
      agentId: 'child-session-1',
      parentSessionId: 'builder-session-1',
      childSessionId: 'child-session-1',
      status: 'ok',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'private child output' }],
    },
  });

  const events = journal.snapshot().events;
  assert.deepEqual(
    events.filter((item) => item.event_type === 'model_usage_recorded').map((item) => item.payload),
    [{
      input_tokens: 120,
      output_tokens: 24,
      cache_read_tokens: 40,
      cache_write_tokens: null,
      reasoning_tokens: 8,
      context_window_tokens: 258_000,
    }],
  );
  assert.deepEqual(
    events.filter((item) => item.event_type === 'model_finish_recorded')
      .map((item) => item.payload.reason_kind),
    ['stop'],
  );
  assert.deepEqual(
    events.filter((item) => item.event_type === 'runtime_activity_status')
      .map((item) => item.payload.activity_kind),
    [
      'session_running',
      'subagent_started',
      'turn_preparing',
      'step_analyzing',
      'todo_updated',
      'generation_finishing',
      'subagent_finished',
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), /Inspect the project|private child output/u);
});

test('emits complete Plan Markdown when the provider did not stream chunks', async () => {
  const { journal, normalizer } = setup('plan');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  const markdown = '## Plan\n\n1. Read the project.\n2. Update the timer.';
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 3, {
    turn: 1,
    step: 1,
    message: assistantMessage(markdown),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 4, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 5, {
    turn: 1,
    reason: { kind: 'completed' },
  })));
  await normalizer.when_settled();
  await normalizer.complete_run({ checkpoint_status: 'not_applicable' });

  const events = journal.snapshot().events;
  assert.equal(
    events.filter((item) => item.event_type === 'assistant_text_delta')
      .map((item) => item.payload.delta_text)
      .join(''),
    markdown,
  );
  assert.equal(events.at(-1).payload.outcome, 'planned');
});

test('coalesces upstream assistant chunks before durable persistence without losing text', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  const chunks = Array.from({ length: 80 }, (_, index) => `part-${index.toString().padStart(2, '0')} `);
  for (let index = 0; index < chunks.length; index += 1) {
    await normalizer.handle_notification(sessionEvent(event('assistant/chunk', index + 3, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: chunks[index] },
    })));
  }
  const text = chunks.join('');
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 83, {
    turn: 1,
    step: 1,
    message: assistantMessage(text),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 84, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 85, {
    turn: 1,
    reason: { kind: 'completed' },
  })));

  const deltas = journal.snapshot().events
    .filter((item) => item.event_type === 'assistant_text_delta')
    .map((item) => item.payload.delta_text);
  assert.equal(deltas.join(''), text);
  assert.ok(deltas.length < chunks.length / 4);
  assert.ok(deltas.every((delta) => Buffer.byteLength(delta, 'utf8') <= 16 * 1_024));
});

test('discards a failed streaming attempt and continues after a Harness model retry', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  const failedPartial = 'discard this partial '.repeat(80);
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 3, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: failedPartial },
  })));
  assert.equal(
    journal.snapshot().events.some((item) => item.event_type === 'assistant_text_delta'),
    true,
  );
  await normalizer.handle_notification(sessionEvent(event('llm/retry', 4, {
    retryId: 'retry-chain-1',
    turn: 1,
    step: 1,
    provider: 'deepseek-official',
    mode: 'normal',
    policyKey: '["normal",2]',
    retry: 1,
    maxRetries: 2,
    delayMs: 25.5,
    failure: { message: 'connection reset', code: 'TRANSPORT' },
  })));
  await normalizer.handle_notification(sessionEvent(event('llm/retry-started', 5, {
    retryId: 'retry-chain-1',
    turn: 1,
    step: 1,
    retry: 1,
  })));
  const recovered = 'Recovered response.';
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 6, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: recovered },
  })));
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 7, {
    turn: 1,
    step: 1,
    message: assistantMessage(recovered),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 8, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 9, {
    turn: 1,
    reason: { kind: 'completed' },
  })));

  assert.deepEqual(await normalizer.when_settled(), { status: 'settled', reason: 'completed' });
  const assistantEvents = journal.snapshot().events.filter((item) => (
    item.event_type.startsWith('assistant_text_')
  ));
  assert.deepEqual(assistantEvents.map((item) => item.event_type), [
    'assistant_text_delta',
    'assistant_text_discarded',
    'assistant_text_delta',
    'assistant_text_completed',
  ]);
  assert.equal(assistantEvents[1].payload.text_bytes, Buffer.byteLength(failedPartial, 'utf8'));
  assert.equal(assistantEvents[2].payload.delta_text, recovered);
});

test('keeps a rejected unsupported tool private so the Harness loop can recover', async () => {
  const { journal, normalizer } = setup();
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-subagent',
    name: 'subagent',
    arguments: JSON.stringify({ task: 'do more work' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('call-subagent', true),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 5, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 6, { turn: 1, step: 2 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/message', 7, {
    turn: 1,
    step: 2,
    message: assistantMessage('Recovered after the rejected tool.'),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 8, { turn: 1, step: 2 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 9, {
    turn: 1,
    reason: { kind: 'completed' },
  })));
  assert.deepEqual(await normalizer.when_settled(), { status: 'settled', reason: 'completed' });
  await normalizer.complete_run({ checkpoint_status: 'created' });
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.deepEqual(
    journal.snapshot().events.filter((item) => item.event_type.startsWith('tool_call_')),
    [],
  );
});

test('fails closed if an unsupported tool unexpectedly reports success', async () => {
  const { normalizer } = setup();
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-subagent',
    name: 'subagent',
    arguments: JSON.stringify({ task: 'do more work' }),
  })));
  await assert.rejects(
    normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
      turn: 1,
      step: 1,
      message: toolResult('call-subagent'),
    }))),
    (error) => error instanceof BuilderHarnessRuntimeEventNormalizerError
      && error.code === 'builder_harness_runtime_event_unsupported_tool',
  );
});

test('records a rejected outside path and continues with a valid read', async () => {
  const { journal, normalizer } = setup();
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-outside',
    name: 'read',
    arguments: JSON.stringify({ file_path: '../outside.txt' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('call-outside', true),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 5, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 6, { turn: 1, step: 2 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 7, {
    turn: 1,
    step: 2,
    callId: 'call-valid',
    name: 'read',
    arguments: JSON.stringify({ file_path: 'index.html' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 8, {
    turn: 1,
    step: 2,
    message: toolResult('call-valid'),
  })));
  const toolEvents = journal.snapshot().events.filter((item) => item.event_type.startsWith('tool_call_'));
  assert.deepEqual(toolEvents.map((item) => item.event_type), [
    'tool_call_started', 'tool_call_failed', 'tool_call_started', 'tool_call_completed',
  ]);
  assert.equal(toolEvents[0].payload.target_label, 'project file');
});

test('keeps concurrent Harness read tools distinct within one step', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-read-a',
    name: 'read',
    arguments: JSON.stringify({ file_path: 'index.html' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 4, {
    turn: 1,
    step: 1,
    callId: 'call-read-b',
    name: 'read',
    arguments: JSON.stringify({ file_path: 'styles.css' }),
  })));
  assert.equal(normalizer.snapshot().active_tool_count, 2);
  await normalizer.handle_notification(sessionEvent(event('tool/result', 5, {
    turn: 1,
    step: 1,
    message: toolResult('call-read-b'),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 6, {
    turn: 1,
    step: 1,
    message: toolResult('call-read-a'),
  })));

  assert.equal(normalizer.snapshot().active_tool_count, 0);
  assert.deepEqual(
    journal.snapshot().events.filter((item) => item.event_type === 'tool_call_started')
      .map((item) => item.payload.target_label),
    ['index.html', 'styles.css'],
  );
});

test('scopes repeated Harness call ids by step across repaired turns', async () => {
  const { journal, normalizer } = setup('build');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'reused-command-id',
    name: 'bash',
    arguments: JSON.stringify({ command: 'npm run build' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('reused-command-id'),
    meta: commandMeta(),
  })));
  await normalizer.handle_notification(sessionEvent(event('step/end', 5, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('turn/end', 6, {
    turn: 1,
    reason: { kind: 'completed' },
  })));
  await normalizer.prepare_repair({ failure_summary: 'The first candidate still needs repair.' });

  await normalizer.handle_notification(sessionEvent(event('turn/start', 7, { turn: 2 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 8, { turn: 2, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 9, {
    turn: 2,
    step: 1,
    callId: 'reused-command-id',
    name: 'bash',
    arguments: JSON.stringify({ command: 'npm run build' }),
  })));
  await normalizer.handle_notification(sessionEvent(event('tool/result', 10, {
    turn: 2,
    step: 1,
    message: toolResult('reused-command-id'),
    meta: commandMeta('npm run build', { durationMs: 456 }),
  })));

  const commandStarts = journal.snapshot().events.filter((item) => (
    item.event_type === 'tool_call_started'
    && item.payload.tool_kind === 'command'
  ));
  const checks = journal.snapshot().events.filter((item) => item.event_type === 'check_result_recorded');
  assert.equal(commandStarts.length, 2);
  assert.notEqual(commandStarts[0].tool_call_id, commandStarts[1].tool_call_id);
  assert.deepEqual(checks.map((item) => item.payload.duration_ms), [123, 456]);
});

test('projects Harness tool presentation metadata without exposing source text or search previews', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 3, {
    turn: 1,
    step: 1,
    callId: 'call-read-meta',
    name: 'read',
    arguments: JSON.stringify({ file_path: 'src/timer.js' }),
  })));
  await assert.doesNotReject(normalizer.handle_notification(sessionEvent(event('tool/result', 4, {
    turn: 1,
    step: 1,
    message: toolResult('call-read-meta'),
    meta: {
      kind: 'read',
      path: 'src/timer.js',
      offset: 1,
      lines: [
        { number: 1, text: 'private source marker' },
        { number: 2, text: '' },
      ],
      totalLines: 2,
      lang: 'js',
    },
  }))));
  await normalizer.handle_notification(sessionEvent(event('step/end', 5, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 6, { turn: 1, step: 2 })));
  await normalizer.handle_notification(sessionEvent(event('tool/call', 7, {
    turn: 1,
    step: 2,
    callId: 'call-search-meta',
    name: 'grep',
    arguments: JSON.stringify({ query: 'private marker' }),
  })));
  await assert.doesNotReject(normalizer.handle_notification(sessionEvent(event('tool/result', 8, {
    turn: 1,
    step: 2,
    message: toolResult('call-search-meta'),
    meta: {
      kind: 'search',
      query: 'private marker',
      matches: [{ path: 'src/timer.js', line: 1, column: 1, preview: 'private preview marker' }],
      truncated: false,
      total: 1,
    },
  }))));

  const completed = journal.snapshot().events.filter((item) => item.event_type === 'tool_call_completed');
  assert.deepEqual(completed.map((item) => item.payload.presentation_detail), [
    {
      detail_kind: 'read',
      path: 'src/timer.js',
      offset: 1,
      returned_lines: 2,
      total_lines: 2,
      first_line: 1,
      last_line: 2,
      language_hint: 'js',
    },
    {
      detail_kind: 'search',
      matches: [{ path: 'src/timer.js', line: 1, column: 1 }],
      truncated: false,
      total: 1,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(completed), /private source marker|private preview marker|private marker/u);
});

test('rejects a final assistant message that disagrees with streamed text', async () => {
  const { normalizer } = setup('ask');
  await normalizer.start();
  await normalizer.handle_notification(sessionEvent(event('turn/start', 1, { turn: 1 })));
  await normalizer.handle_notification(sessionEvent(event('step/start', 2, { turn: 1, step: 1 })));
  await normalizer.handle_notification(sessionEvent(event('assistant/chunk', 3, {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'first' },
  })));

  await assert.rejects(
    normalizer.handle_notification(sessionEvent(event('assistant/message', 4, {
      turn: 1,
      step: 1,
      message: assistantMessage('second'),
    }))),
    (error) => error instanceof BuilderHarnessRuntimeEventNormalizerError
      && error.code === 'builder_harness_runtime_event_conflict',
  );
});

test('ignores other sessions and idempotently accepts duplicate Harness sequence events', async () => {
  const { journal, normalizer } = setup('ask');
  await normalizer.start();
  assert.equal(await normalizer.handle_notification({
    method: 'session.status',
    params: { sessionId: 'child-session', status: 'running' },
  }), false);
  const start = sessionEvent(event('turn/start', 1, { turn: 1 }));
  assert.equal(await normalizer.handle_notification(start), true);
  assert.equal(await normalizer.handle_notification(start), false);
  assert.equal(
    journal.snapshot().events.filter((item) => item.event_type === 'turn_started').length,
    1,
  );
});
