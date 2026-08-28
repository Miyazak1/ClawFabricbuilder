'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  harnessFiles,
  harnessLongStreamEvents,
  harnessOutputForRequest,
} = require('../scripts/verify-packaged-canary-default.cjs');
const {
  A05_BUDGETS,
  PB07_INSTRUCTION,
  qualifyB5PackagedEvidence,
  qualifyG2BrokerSchedulerEvidence,
  qualifyG3RuntimePersistenceEvidence,
  qualifyMain,
  qualifyMainAttribution,
  qualifyPb03,
  qualifyPb06,
} = require('../scripts/verify-packaged-harness-stress-canary.cjs');

function trace(values) {
  return {
    trace_version: 'builder-renderer-performance-trace.v1',
    metrics: Object.entries(values).map(([name, value]) => ({
      name,
      count: value.count ?? 0,
      sample_count: value.count ?? 0,
      total: value.total ?? value.count ?? 0,
      median: value.max ?? 0,
      p95: value.max ?? 0,
      max: value.max ?? 0,
    })),
    event_loop_delay: { max_ms: 0 },
    event_loop_windows: [],
    privacy: {},
  };
}

test('PB-03 fixture emits exactly 600 controlled text deltas', () => {
  const events = harnessLongStreamEvents();
  assert.equal(events.length, 602);
  assert.equal(events.filter((event) => (
    typeof event?.choices?.[0]?.delta?.content === 'string'
    && event.choices[0].delta.content.startsWith('stream ')
  )).length, 600);
});

test('the latest PB-06 instruction wins over historical PB-03 text', () => {
  const state = { harnessStressScenarios: true };
  const output = harnessOutputForRequest({
    messages: [
      { role: 'user', content: 'PB-03 controlled 60-second stream' },
      { role: 'assistant', content: 'complete' },
      { role: 'user', content: 'PB-06 controlled 10 MB output burst' },
    ],
  }, state);
  assert.equal(output.kind, 'harness_pb06_command');
});

test('PB-06 project fixture declares an exact 10 MiB mixed burst', () => {
  const files = harnessFiles(1, false, true);
  const packageJson = JSON.parse(files.get('package.json'));
  const burst = files.get('burst.js');
  assert.equal(packageJson.scripts.build, 'node burst.js');
  assert.match(burst, /repeat\(65_535\)/u);
  assert.match(burst, /index < 80/u);
  assert.equal((65_535 + 1) * 80 * 2, A05_BUDGETS.pb06.complete_output_bytes);
});

test('PB-07 fixture triggers a bounded broker read/search pressure batch', () => {
  const state = { harnessStressScenarios: true };
  const first = harnessOutputForRequest({
    messages: [{ role: 'user', content: PB07_INSTRUCTION }],
  }, state);
  assert.equal(first.kind, 'harness_pb07_tool_pressure');
  const toolCalls = first.events
    .flatMap((event) => event?.choices?.[0]?.delta?.tool_calls ?? []);
  assert.equal(toolCalls.length, 8);
  assert.deepEqual(
    toolCalls.map((call) => call.function.name),
    ['read', 'read', 'read', 'read', 'grep', 'grep', 'grep', 'grep'],
  );

  const second = harnessOutputForRequest({
    messages: [
      { role: 'user', content: PB07_INSTRUCTION },
      { role: 'tool', content: 'File: index.html\nContent:\nFocus Timer' },
    ],
  }, state);
  assert.equal(second.kind, 'harness_pb07_completed');
});

test('A0.5 qualification rejects durable amplification and accepts bounded output', () => {
  const before = trace({});
  const pb03After = trace({
    'renderer.live_output.received_count': { count: 600 },
    'renderer.task_stream.read.duration_ms': { count: 2 },
    'renderer.task_stream.controller_publish_count': { count: 2 },
    'renderer.builder_page.commit_count': { count: 4 },
    'renderer.activity.commit_count': { count: 4 },
    'renderer.side_workspace.commit_count': { count: 2 },
  });
  assert.equal(qualifyPb03(before, pb03After, 60_000).live_output_received, 600);
  assert.throws(() => qualifyPb03(before, trace({
    ...Object.fromEntries(pb03After.metrics.map((item) => [item.name, item])),
    'renderer.task_stream.read.duration_ms': { count: 100 },
  }), 60_000), /task_stream_reads/u);

  const pb06After = trace({
    'renderer.command_output.received_bytes': { count: 4, total: 256 * 1_024 },
    'renderer.command_output.received_count': { count: 4 },
    'renderer.command_output.flush_count': { count: 4 },
    'renderer.command_output.retained_bytes': { count: 4, max: 256 * 1_024 },
    'renderer.side_workspace.commit_count': { count: 4 },
  });
  assert.equal(qualifyPb06(before, pb06After, {
    stdout_visible_bytes: 128 * 1_024,
    stderr_visible_bytes: 128 * 1_024,
    truncation_visible: true,
    private_reference_hidden: true,
  }).renderer_received_bytes, 256 * 1_024);
});

test('Main stress qualification includes runtime-window event-loop attribution', () => {
  const mainTrace = trace({
    'main.command_output.received_bytes': { count: 1, total: 10 * 1024 * 1024 },
    'main.command_output.public_event_bytes': { count: 1, total: 256 * 1024 },
    'main.command_output.spill_retained_bytes': { count: 1, max: 10 * 1024 * 1024 },
    'main.command_output.spill_write.duration_ms': { count: 1, max: 1 },
    'main.command_output.event_loop_delay_ms': { count: 1, max: 20 },
    'main.command_approval.request.duration_ms': { count: 1, max: 55 },
    'main.command_approval.prepare.duration_ms': { count: 1, max: 33 },
    'main.command_approval.wait_decision.duration_ms': { count: 1, max: 22 },
    'main.command_approval.decide.duration_ms': { count: 1, max: 6 },
    'main.command_approval.consume.duration_ms': { count: 1, max: 7 },
    'main.command_executor.execute.duration_ms': { count: 1, max: 444 },
    'main.command_executor.materialize.duration_ms': { count: 1, max: 15 },
    'main.command_executor.process_run.duration_ms': { count: 1, max: 300 },
    'main.command_executor.finish.duration_ms': { count: 1, max: 17 },
    'main.harness_candidate.reconcile.duration_ms': { count: 1, max: 44 },
    'main.harness_jsonrpc.request.duration_ms': { count: 2, max: 123 },
    'main.harness_jsonrpc.parse_frame.duration_ms': { count: 2, max: 9 },
    'main.harness_process_host.prompt.duration_ms': { count: 1, max: 124 },
    'main.harness_tool_broker.tool_write.duration_ms': { count: 1, max: 77 },
    'main.harness_tool_broker.tool_read.active_count': { count: 4, max: 2 },
    'main.harness_tool_broker.tool_read.queue_wait.duration_ms': { count: 2, max: 1 },
    'main.harness_tool_broker.tool_read.queued_count': { count: 1, max: 2 },
    'main.harness_tool_broker.tool_search.active_count': { count: 4, max: 1 },
    'main.harness_tool_broker.tool_search.queue_wait.duration_ms': { count: 3, max: 2 },
    'main.harness_tool_broker.tool_search.queued_count': { count: 1, max: 3 },
    'main.harness_tool_broker.tool_execute_command.duration_ms': { count: 1, max: 88 },
    'main.harness_response.complete_conversation.duration_ms': { count: 1, max: 12 },
    'main.harness_runner.wait_completion.duration_ms': { count: 1, max: 333 },
    'main.harness_runner.project_candidate.duration_ms': { count: 1, max: 11 },
    'main.harness_runtime.persist_event.duration_ms': { count: 3, total: 33, max: 22 },
    'main.harness_runtime.host_prompt.duration_ms': { count: 1, max: 125 },
    'main.harness_runtime.pending_batch_size': { count: 2, max: 64 },
    'main.harness_start.build_context.duration_ms': { count: 1, max: 111 },
    'main.harness_start.runner_run.duration_ms': { count: 1, max: 222 },
    'main.lifecycle.ready_handler.duration_ms': { count: 1, max: 100 },
  });
  mainTrace.event_loop_delay = { max_ms: 4_000 };
  mainTrace.event_loop_windows = [
    {
      name: 'pb03_streaming_to_terminal',
      status: 'completed',
      started_at_ms: 1,
      duration_ms: 60_000,
      sample_count: 3,
      mean_ms: 10,
      p95_ms: 20,
      max_ms: 30,
    },
    {
      name: 'harness_candidate_reconcile',
      status: 'completed',
      started_at_ms: 3,
      duration_ms: 120,
      sample_count: 2,
      mean_ms: 8,
      p95_ms: 9,
      max_ms: 10,
    },
    {
      name: 'close_after_save',
      status: 'active',
      started_at_ms: 2,
      duration_ms: 200,
      sample_count: 1,
      mean_ms: 5,
      p95_ms: 6,
      max_ms: 7,
    },
  ];
  assert.equal(
    qualifyMain(mainTrace).event_loop_windows.pb03_streaming_to_terminal.max_ms,
    30,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.command_approval.request_max_ms,
    55,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.command_approval.prepare_max_ms,
    33,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.command_approval.wait_decision_max_ms,
    22,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.command_executor.execute_max_ms,
    444,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.command_executor.process_run_max_ms,
    300,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_jsonrpc.request_max_ms,
    123,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_process_host.prompt_max_ms,
    124,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_tool_broker.tool_write_max_ms,
    77,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_tool_broker.tool_read_active_max,
    2,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_tool_broker.tool_search_active_max,
    1,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_tool_broker.tool_execute_command_max_ms,
    88,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_candidate.reconcile_max_ms,
    44,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_response.complete_conversation_max_ms,
    12,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_runner.wait_completion_max_ms,
    333,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_runner.project_candidate_max_ms,
    11,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_start.build_context_max_ms,
    111,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_start.runner_run_max_ms,
    222,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_runtime.host_prompt_max_ms,
    125,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_runtime.persist_event_count,
    3,
  );
  assert.equal(
    qualifyMain(mainTrace).runtime_metrics.harness_runtime.pending_batch_size_max,
    64,
  );
  assert.equal(
    qualifyMainAttribution(mainTrace).event_loop_windows.close_after_save.status,
    'active',
  );
});

test('G2 broker scheduler evidence requires queued read/search pressure within per-run limits', () => {
  const mainTrace = trace({
    'main.harness_tool_broker.tool_read.active_count': { count: 4, max: 2 },
    'main.harness_tool_broker.tool_read.queue_wait.duration_ms': { count: 2, max: 1 },
    'main.harness_tool_broker.tool_read.queued_count': { count: 1, max: 2 },
    'main.harness_tool_broker.tool_search.active_count': { count: 4, max: 1 },
    'main.harness_tool_broker.tool_search.queue_wait.duration_ms': { count: 3, max: 2 },
    'main.harness_tool_broker.tool_search.queued_count': { count: 1, max: 3 },
  });
  const qualified = qualifyG2BrokerSchedulerEvidence(mainTrace);
  assert.equal(qualified.tool_read_active_max, A05_BUDGETS.g2.broker_read_active_max);
  assert.equal(qualified.tool_search_active_max, A05_BUDGETS.g2.broker_search_active_max);

  assert.throws(() => qualifyG2BrokerSchedulerEvidence(trace({
    'main.harness_tool_broker.tool_read.active_count': { count: 4, max: 3 },
    'main.harness_tool_broker.tool_read.queue_wait.duration_ms': { count: 2, max: 1 },
    'main.harness_tool_broker.tool_search.active_count': { count: 4, max: 1 },
    'main.harness_tool_broker.tool_search.queue_wait.duration_ms': { count: 3, max: 2 },
  })), /tool_read_active_max/u);

  assert.throws(() => qualifyG2BrokerSchedulerEvidence(trace({
    'main.harness_tool_broker.tool_read.active_count': { count: 4, max: 2 },
    'main.harness_tool_broker.tool_read.queue_wait.duration_ms': { count: 0, max: 0 },
    'main.harness_tool_broker.tool_search.active_count': { count: 4, max: 1 },
    'main.harness_tool_broker.tool_search.queue_wait.duration_ms': { count: 3, max: 2 },
  })), /tool_read_queue_wait_count/u);
});

test('G3 runtime persistence evidence rejects repeated full replay amplification', () => {
  const accepted = qualifyG3RuntimePersistenceEvidence(trace({
    'main.conversation.append.duration_ms': { count: 172, total: 1_759.243, max: 109.268 },
    'main.task_stream.ipc.duration_ms': { count: 52, total: 338.717, max: 18.349 },
    'main.task_stream.projection.duration_ms': { count: 382, total: 120.261, max: 14.218 },
    'main.harness_runtime.persist_event.duration_ms': { count: 765, total: 9_031.36, max: 216.8 },
    'main.harness_runtime.record_events.duration_ms': { count: 158, total: 8_835.383, max: 216.564 },
    'main.harness_runtime.pending_batch_size': { count: 5, max: 128 },
  }));
  assert.equal(accepted.runtime_pending_batch_size_max, A05_BUDGETS.g3.runtime_pending_batch_size_min);
  assert.equal(accepted.conversation_append_total_ms, 1_759.243);

  assert.throws(() => qualifyG3RuntimePersistenceEvidence(trace({
    'main.conversation.append.duration_ms': { count: 177, total: 11_340.029, max: 198.835 },
    'main.task_stream.ipc.duration_ms': { count: 63, total: 4_812.217, max: 265.997 },
    'main.task_stream.projection.duration_ms': { count: 373, total: 2_189.384, max: 21.049 },
    'main.harness_runtime.persist_event.duration_ms': { count: 765, total: 26_888.643, max: 407.893 },
    'main.harness_runtime.record_events.duration_ms': { count: 158, total: 26_677.692, max: 407.643 },
    'main.harness_runtime.pending_batch_size': { count: 5, max: 128 },
  })), /runtime_record_events_total_ms|runtime_persist_event_total_ms|conversation_append_total_ms/u);

  assert.throws(() => qualifyG3RuntimePersistenceEvidence(trace({
    'main.conversation.append.duration_ms': { count: 172, total: 1_759.243, max: 109.268 },
    'main.task_stream.ipc.duration_ms': { count: 52, total: 338.717, max: 18.349 },
    'main.task_stream.projection.duration_ms': { count: 382, total: 120.261, max: 14.218 },
    'main.harness_runtime.persist_event.duration_ms': { count: 765, total: 9_031.36, max: 216.8 },
    'main.harness_runtime.record_events.duration_ms': { count: 158, total: 8_835.383, max: 216.564 },
    'main.harness_runtime.pending_batch_size': { count: 5, max: 64 },
  })), /runtime_pending_batch_size_max/u);
});

test('B5 packaged evidence gate requires bounded Main task-stream IPC cursor evidence', () => {
  const mainTrace = trace({
    'main.task_stream.read.count': { count: 6 },
    'main.task_stream.ipc.duration_ms': { count: 6, max: 2 },
    'main.task_stream.ipc.result_bytes': { count: 6, max: 32 * 1024 },
    'main.task_stream.projection.duration_ms': { count: 6, max: 2 },
    'main.task_stream.projection.result_bytes': { count: 6, max: 24 * 1024 },
    'main.task_stream.cursor.full_count': { count: 1 },
    'main.task_stream.cursor.incremental_count': { count: 3 },
    'main.task_stream.cursor.unchanged_count': { count: 2 },
    'main.task_stream.changed.legacy': { count: 4 },
  });
  const qualified = qualifyB5PackagedEvidence(mainTrace);
  assert.equal(qualified.ipc_result_bytes_max, 32 * 1024);
  assert.equal(qualified.cursor_incremental_count, 3);
  assert.equal(qualified.cursor_unchanged_count, 2);

  assert.throws(() => qualifyB5PackagedEvidence(trace({
    'main.task_stream.read.count': { count: 6 },
    'main.task_stream.ipc.duration_ms': { count: 6, max: 2 },
    'main.task_stream.ipc.result_bytes': {
      count: 6,
      max: A05_BUDGETS.b5.main_task_stream_result_bytes_max + 1,
    },
    'main.task_stream.projection.duration_ms': { count: 6, max: 2 },
    'main.task_stream.projection.result_bytes': { count: 6, max: 24 * 1024 },
    'main.task_stream.cursor.incremental_count': { count: 3 },
    'main.task_stream.cursor.unchanged_count': { count: 2 },
    'main.task_stream.changed.legacy': { count: 4 },
  })), /ipc_result_bytes_max/u);

  assert.throws(() => qualifyB5PackagedEvidence(trace({
    'main.task_stream.read.count': { count: 6 },
    'main.task_stream.ipc.duration_ms': { count: 6, max: 2 },
    'main.task_stream.ipc.result_bytes': { count: 6, max: 32 * 1024 },
    'main.task_stream.projection.duration_ms': { count: 6, max: 2 },
    'main.task_stream.projection.result_bytes': { count: 6, max: 24 * 1024 },
    'main.task_stream.cursor.incremental_count': { count: 0 },
    'main.task_stream.cursor.unchanged_count': { count: 0 },
    'main.task_stream.changed.legacy': { count: A05_BUDGETS.b5.main_task_stream_legacy_changes_max + 1 },
  })), /cursor_incremental_count|cursor_unchanged_count|changed_legacy/u);
});
