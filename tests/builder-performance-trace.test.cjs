'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  builderPerformanceTrace,
  resetBuilderPerformanceTraceForTests,
} = require('../electron/builder-performance-trace.cjs');

test.afterEach(() => resetBuilderPerformanceTraceForTests());

test('performance trace emits only whitelisted numeric aggregates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-performance-trace-'));
  try {
    const outputPath = path.join(root, 'trace.json');
    assert.equal(builderPerformanceTrace.configure({ enabled: true, output_path: outputPath }), true);
    builderPerformanceTrace.increment('main.task_stream.changed.live_only');
    builderPerformanceTrace.increment('main.task_stream.changed.runtime_append');
    builderPerformanceTrace.observe('main.workbench.task_sync.duration_ms', 9);
    builderPerformanceTrace.observe('main.workbench.task_sync.task_count', 1);
    builderPerformanceTrace.observe('main.workbench.read.duration_ms', 5);
    builderPerformanceTrace.observe('main.conversation.load.event_count', 12);
    builderPerformanceTrace.observe('main.command_output.event_loop_delay_ms', 24);
    builderPerformanceTrace.observe('main.command_executor.execute.duration_ms', 18);
    builderPerformanceTrace.observe('main.command_approval.request.duration_ms', 16);
    builderPerformanceTrace.observe('main.browser_session.cleanup.duration_ms', 2);
    builderPerformanceTrace.observe('main.browser_session.open.duration_ms', 3);
    builderPerformanceTrace.observe('main.agent_test_browser.layout.duration_ms', 1);
    builderPerformanceTrace.observe('main.harness_candidate.reconcile.duration_ms', 48);
    builderPerformanceTrace.observe('main.harness_jsonrpc.parse_frame.duration_ms', 3);
    builderPerformanceTrace.observe('main.harness_process_host.prompt.duration_ms', 12);
    builderPerformanceTrace.observe('main.harness_runner.wait_completion.duration_ms', 24);
    builderPerformanceTrace.observe('main.harness_runtime.persist_event.duration_ms', 12);
    builderPerformanceTrace.observe('main.harness_start.build_context.duration_ms', 72);
    builderPerformanceTrace.observe('main.lifecycle.ready_handler.duration_ms', 36);
    builderPerformanceTrace.increment('main.provider_output.delta_event_count');
    builderPerformanceTrace.increment('main.provider_output.sent_count');
    builderPerformanceTrace.increment('main.task_stream.read.count');
    builderPerformanceTrace.observe('main.task_stream.ipc.duration_ms', 8);
    builderPerformanceTrace.observe('main.task_stream.ipc.result_bytes', 1024);
    builderPerformanceTrace.increment('main.task_stream.cursor.full_count');
    builderPerformanceTrace.increment('main.task_stream.cursor.incremental_count');
    builderPerformanceTrace.increment('main.task_stream.cursor.unchanged_count');
    builderPerformanceTrace.increment('main.conversation.context_replay.cache_hit_count');
    builderPerformanceTrace.observe('main.conversation.context_replay.duration_ms', 7);
    builderPerformanceTrace.observe('main.conversation.derived_refresh.duration_ms', 8);
    builderPerformanceTrace.increment('main.conversation.derived_refresh.runtime_append_skipped_count');
    builderPerformanceTrace.observe('main.user_web.cleanup.duration_ms', 2);
    builderPerformanceTrace.observe('main.user_web.layout.duration_ms', 1);
    builderPerformanceTrace.observe('main.user_web.navigate.duration_ms', 10);
    builderPerformanceTrace.observe('main.user_web.reload.duration_ms', 8);
    builderPerformanceTrace.observe('not.allowed.prompt_text', 99);
    assert.equal(builderPerformanceTrace.measureSync(
      'main.conversation.load.duration_ms',
      () => 'result',
    ), 'result');
    assert.equal(builderPerformanceTrace.flush(), true);

    const raw = fs.readFileSync(outputPath, 'utf8');
    const trace = JSON.parse(raw);
    assert.equal(trace.trace_version, 'builder-performance-trace.v1');
    assert.deepEqual(trace.privacy, {
      content_fields_recorded: false,
      identifiers_recorded: false,
      paths_recorded: false,
      urls_recorded: false,
    });
    assert.deepEqual(
      trace.metrics.map((metric) => metric.name),
      [
        'main.agent_test_browser.layout.duration_ms',
        'main.browser_session.cleanup.duration_ms',
        'main.browser_session.open.duration_ms',
        'main.command_approval.request.duration_ms',
        'main.command_executor.execute.duration_ms',
        'main.command_output.event_loop_delay_ms',
        'main.conversation.context_replay.cache_hit_count',
        'main.conversation.context_replay.duration_ms',
        'main.conversation.derived_refresh.duration_ms',
        'main.conversation.derived_refresh.runtime_append_skipped_count',
        'main.conversation.load.duration_ms',
        'main.conversation.load.event_count',
        'main.harness_candidate.reconcile.duration_ms',
        'main.harness_jsonrpc.parse_frame.duration_ms',
        'main.harness_process_host.prompt.duration_ms',
        'main.harness_runner.wait_completion.duration_ms',
        'main.harness_runtime.persist_event.duration_ms',
        'main.harness_start.build_context.duration_ms',
        'main.lifecycle.ready_handler.duration_ms',
        'main.provider_output.delta_event_count',
        'main.provider_output.sent_count',
        'main.task_stream.changed.live_only',
        'main.task_stream.changed.runtime_append',
        'main.task_stream.cursor.full_count',
        'main.task_stream.cursor.incremental_count',
        'main.task_stream.cursor.unchanged_count',
        'main.task_stream.ipc.duration_ms',
        'main.task_stream.ipc.result_bytes',
        'main.task_stream.read.count',
        'main.user_web.cleanup.duration_ms',
        'main.user_web.layout.duration_ms',
        'main.user_web.navigate.duration_ms',
        'main.user_web.reload.duration_ms',
        'main.workbench.read.duration_ms',
        'main.workbench.task_sync.duration_ms',
        'main.workbench.task_sync.task_count',
      ],
    );
    assert.equal(raw.includes(root), false);
    assert.equal(raw.includes('prompt_text'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('performance trace records allowlisted event-loop windows without content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-performance-trace-'));
  try {
    const outputPath = path.join(root, 'trace.json');
    assert.equal(builderPerformanceTrace.configure({ enabled: true, output_path: outputPath }), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('not_allowed'), false);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('pb03_streaming_to_terminal'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('pb03_submit_to_first_live'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('pb03_submit_to_first_live'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('pb03_first_live_to_preview_stable'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('pb03_first_live_to_preview_stable'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('harness_candidate_reconcile'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('harness_candidate_reconcile'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('harness_start_build_context'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('harness_start_build_context'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('harness_runner_wait_completion'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('harness_runner_wait_completion'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('harness_process_host_prompt'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('harness_process_host_prompt'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('harness_tool_broker_dispatch'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('harness_tool_broker_dispatch'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('command_executor_execute'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('command_executor_execute'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('pb06_terminal_tab_settle'), true);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('pb06_terminal_tab_settle'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('pb03_streaming_to_terminal'), false);
    assert.equal(builderPerformanceTrace.endEventLoopWindow('pb03_streaming_to_terminal'), true);
    assert.equal(builderPerformanceTrace.beginEventLoopWindow('close_after_save'), true);
    const trace = builderPerformanceTrace.snapshot();
    assert.deepEqual(trace.event_loop_windows.map((entry) => entry.name), [
      'pb03_submit_to_first_live',
      'pb03_first_live_to_preview_stable',
      'harness_candidate_reconcile',
      'harness_start_build_context',
      'harness_runner_wait_completion',
      'harness_process_host_prompt',
      'harness_tool_broker_dispatch',
      'command_executor_execute',
      'pb06_terminal_tab_settle',
      'pb03_streaming_to_terminal',
      'close_after_save',
    ]);
    assert.deepEqual(trace.event_loop_windows.map((entry) => entry.status), [
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'active',
    ]);
    assert.equal(JSON.stringify(trace).includes('not_allowed'), false);
    assert.equal(JSON.stringify(trace).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('performance trace stays disabled for malformed configuration', () => {
  assert.equal(builderPerformanceTrace.configure({ enabled: false, output_path: 'relative.json' }), false);
  assert.equal(builderPerformanceTrace.enabled(), false);
  assert.equal(builderPerformanceTrace.increment('main.task_stream.changed.live_only'), false);
  assert.equal(builderPerformanceTrace.flush(), false);
});
