'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay, performance: nodePerformance } = require('node:perf_hooks');

const TRACE_VERSION = 'builder-performance-trace.v1';
const MAX_SAMPLES_PER_METRIC = 4_096;
const MAX_EVENT_LOOP_WINDOWS = 256;
const METRIC_NAMES = Object.freeze(new Set([
  'main.command_output.public_event_bytes',
  'main.command_output.received_bytes',
  'main.command_output.event_loop_delay_ms',
  'main.command_executor.cleanup.duration_ms',
  'main.command_executor.execute.duration_ms',
  'main.command_executor.finish.duration_ms',
  'main.command_executor.materialize.duration_ms',
  'main.command_executor.process_run.duration_ms',
  'main.command_executor.read_private_runtime.duration_ms',
  'main.command_executor.resolve_runtime.duration_ms',
  'main.command_executor.spawn.duration_ms',
  'main.command_output.spill_retained_bytes',
  'main.command_output.spill_write.duration_ms',
  'main.browser_session.cleanup.duration_ms',
  'main.browser_session.open.duration_ms',
  'main.agent_test_browser.layout.duration_ms',
  'main.conversation.append.duration_ms',
  'main.conversation.append.event_bytes',
  'main.conversation.append.event_count',
  'main.conversation.append.suffix_event_count',
  'main.conversation.append.suffix_validation_count',
  'main.conversation.load.cache_hit_count',
  'main.conversation.load.duration_ms',
  'main.conversation.load.event_bytes',
  'main.conversation.load.event_count',
  'main.conversation.load.full_read_count',
  'main.conversation.load.suffix_hit_count',
  'main.conversation.context_replay.cache_hit_count',
  'main.conversation.context_replay.duration_ms',
  'main.conversation.derived_refresh.duration_ms',
  'main.conversation.derived_refresh.runtime_append_skipped_count',
  'main.harness_candidate.automatic_check.duration_ms',
  'main.harness_candidate.checkpoint.duration_ms',
  'main.harness_candidate.complete_conversation.duration_ms',
  'main.harness_candidate.git_persist.duration_ms',
  'main.harness_candidate.git_verify.duration_ms',
  'main.harness_candidate.materialize_current.duration_ms',
  'main.harness_candidate.reconcile.duration_ms',
  'main.harness_candidate.record_check_fact.duration_ms',
  'main.harness_candidate.repair.duration_ms',
  'main.harness_candidate.workspace_guard.duration_ms',
  'main.harness_jsonrpc.dispatch_notification.duration_ms',
  'main.harness_jsonrpc.handle_data.duration_ms',
  'main.harness_jsonrpc.parse_frame.duration_ms',
  'main.harness_jsonrpc.request.duration_ms',
  'main.harness_jsonrpc.request_serialize.duration_ms',
  'main.harness_jsonrpc.request_write.duration_ms',
  'main.harness_jsonrpc.settle_response.duration_ms',
  'main.harness_process_host.initialize.duration_ms',
  'main.harness_process_host.prompt.duration_ms',
  'main.harness_process_host.request.duration_ms',
  'main.harness_response.complete_conversation.duration_ms',
  'main.harness_response.reconcile.duration_ms',
  'main.harness_runner.project_candidate.duration_ms',
  'main.harness_runner.read_conversation_events.duration_ms',
  'main.harness_runner.reconcile_runtime.duration_ms',
  'main.harness_runner.repair_runtime.duration_ms',
  'main.harness_runner.start_runtime.duration_ms',
  'main.harness_runner.wait_completion.duration_ms',
  'main.harness_runtime.bind_tool_file.duration_ms',
  'main.harness_runtime.flush_pending_events.duration_ms',
  'main.harness_runtime.host_prompt.duration_ms',
  'main.harness_runtime.journal_append.duration_ms',
  'main.harness_runtime.pending_batch_size',
  'main.harness_runtime.persist_event.duration_ms',
  'main.harness_runtime.record_events.duration_ms',
  'main.harness_runtime.reconcile_run.duration_ms',
  'main.harness_runtime.repair_run.duration_ms',
  'main.harness_runtime.start_run.duration_ms',
  'main.harness_runtime.stop_with_failure.duration_ms',
  'main.harness_start.build_context.duration_ms',
  'main.harness_start.provider_config.duration_ms',
  'main.harness_start.provider_dispatch.duration_ms',
  'main.harness_start.resolve_secret.duration_ms',
  'main.harness_start.run_contract.duration_ms',
  'main.harness_start.runner_create.duration_ms',
  'main.harness_start.runner_run.duration_ms',
  'main.harness_tool_broker.dispatch.duration_ms',
  'main.harness_tool_broker.execute_tool.duration_ms',
  'main.harness_tool_broker.parse_request.duration_ms',
  'main.harness_tool_broker.read_request.duration_ms',
  'main.harness_tool_broker.send_response.duration_ms',
  'main.harness_tool_broker.start.duration_ms',
  'main.harness_tool_broker.tool_ask_user_question.duration_ms',
  'main.harness_tool_broker.tool_browser_click.duration_ms',
  'main.harness_tool_broker.tool_browser_close.duration_ms',
  'main.harness_tool_broker.tool_browser_observe.duration_ms',
  'main.harness_tool_broker.tool_browser_open_local_app.duration_ms',
  'main.harness_tool_broker.tool_browser_press_key.duration_ms',
  'main.harness_tool_broker.tool_browser_reload_latest_source.duration_ms',
  'main.harness_tool_broker.tool_browser_scroll.duration_ms',
  'main.harness_tool_broker.tool_browser_select_option.duration_ms',
  'main.harness_tool_broker.tool_browser_type.duration_ms',
  'main.harness_tool_broker.tool_edit.duration_ms',
  'main.harness_tool_broker.tool_execute_command.duration_ms',
  'main.harness_tool_broker.tool_read.duration_ms',
  'main.harness_tool_broker.tool_read.active_count',
  'main.harness_tool_broker.tool_read.queue_wait.duration_ms',
  'main.harness_tool_broker.tool_read.queued_count',
  'main.harness_tool_broker.tool_search.duration_ms',
  'main.harness_tool_broker.tool_search.active_count',
  'main.harness_tool_broker.tool_search.queue_wait.duration_ms',
  'main.harness_tool_broker.tool_search.queued_count',
  'main.harness_tool_broker.tool_write.duration_ms',
  'main.harness_tool_broker.user_question.duration_ms',
  'main.command_approval.consume.duration_ms',
  'main.command_approval.decide.duration_ms',
  'main.command_approval.prepare.duration_ms',
  'main.command_approval.request.duration_ms',
  'main.command_approval.wait_decision.duration_ms',
  'main.lifecycle.create_ipc_runtimes.duration_ms',
  'main.lifecycle.create_main_window.duration_ms',
  'main.lifecycle.ready_handler.duration_ms',
  'main.lifecycle.register_ipc_runtimes.duration_ms',
  'main.lifecycle.shutdown_ipc_runtimes.duration_ms',
  'main.lifecycle.trace_flush.duration_ms',
  'main.provider_output.delta_event_count',
  'main.provider_output.display_attempt_count',
  'main.provider_output.sent_count',
  'main.provider_output.suppressed_count',
  'main.task_stream.changed.durable_append',
  'main.task_stream.changed.legacy',
  'main.task_stream.changed.live_only',
  'main.task_stream.changed.runtime_append',
  'main.task_stream.cursor.full_count',
  'main.task_stream.cursor.incremental_count',
  'main.task_stream.cursor.unchanged_count',
  'main.task_stream.ipc.duration_ms',
  'main.task_stream.ipc.result_bytes',
  'main.task_stream.projection.duration_ms',
  'main.task_stream.projection.result_bytes',
  'main.task_stream.read.count',
  'main.user_web.cleanup.duration_ms',
  'main.user_web.layout.duration_ms',
  'main.user_web.navigate.duration_ms',
  'main.user_web.reload.duration_ms',
  'main.workbench.read.duration_ms',
  'main.workbench.task_sync.duration_ms',
  'main.workbench.task_sync.task_count',
]));
const EVENT_LOOP_WINDOW_NAMES = Object.freeze(new Set([
  'pb03_streaming_to_terminal',
  'pb03_submit_to_first_live',
  'pb03_first_live_to_preview_stable',
  'pb03_preview_stable_to_provider_complete',
  'pb03_provider_complete_to_terminal',
  'pb06_output_to_terminal',
  'pb06_submit_to_command_approval',
  'pb06_command_approval_to_command_provider',
  'pb06_command_provider_to_completed_provider',
  'pb06_completed_provider_to_task_stream_terminal',
  'pb06_terminal_tab_settle',
  'harness_candidate_automatic_check',
  'harness_candidate_checkpoint',
  'harness_candidate_complete_conversation',
  'harness_candidate_git_persist',
  'harness_candidate_git_verify',
  'harness_candidate_materialize_current',
  'harness_candidate_reconcile',
  'harness_candidate_record_check_fact',
  'harness_candidate_repair',
  'harness_candidate_workspace_guard',
  'harness_process_host_initialize',
  'harness_process_host_prompt',
  'harness_response_complete_conversation',
  'harness_response_reconcile',
  'harness_runner_project_candidate',
  'harness_runner_read_conversation_events',
  'harness_runner_reconcile_runtime',
  'harness_runner_repair_runtime',
  'harness_runner_start_runtime',
  'harness_runner_wait_completion',
  'harness_runtime_host_prompt',
  'harness_runtime_reconcile_run',
  'harness_runtime_repair_run',
  'harness_start_build_context',
  'harness_start_provider_config',
  'harness_start_provider_dispatch',
  'harness_start_runner_run',
  'harness_tool_broker_dispatch',
  'harness_tool_broker_execute_tool',
  'command_executor_execute',
  'command_executor_process_run',
  'save_version_refresh',
  'close_after_save',
  'restart_reopen_project',
  'close_after_restart',
]));

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rounded(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
}

function createMetric() {
  return { count: 0, samples: [], total: 0 };
}

let enabled = false;
let outputPath = null;
let eventLoopHistogram = null;
let configuredAtMs = 0;
const metrics = new Map();
const eventLoopWindows = [];
const activeEventLoopWindows = new Map();

function metricFor(name) {
  if (!enabled || !METRIC_NAMES.has(name)) return null;
  let metric = metrics.get(name);
  if (metric === undefined) {
    metric = createMetric();
    metrics.set(name, metric);
  }
  return metric;
}

function observe(name, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return false;
  const metric = metricFor(name);
  if (metric === null) return false;
  metric.count += 1;
  metric.total += value;
  if (metric.samples.length < MAX_SAMPLES_PER_METRIC) metric.samples.push(value);
  return true;
}

function increment(name, amount = 1) {
  return observe(name, amount);
}

function measureSync(name, callback) {
  if (!enabled || !METRIC_NAMES.has(name)) return callback();
  const startedAt = nodePerformance.now();
  try {
    return callback();
  } finally {
    observe(name, nodePerformance.now() - startedAt);
  }
}

async function measureAsync(name, callback) {
  if (!enabled || !METRIC_NAMES.has(name)) return callback();
  const startedAt = nodePerformance.now();
  try {
    return await callback();
  } finally {
    observe(name, nodePerformance.now() - startedAt);
  }
}

function snapshotEventLoopHistogram(histogram) {
  return Object.freeze({
    sample_count: Number(histogram.count),
    mean_ms: rounded(Number(histogram.mean) / 1_000_000),
    p95_ms: rounded(Number(histogram.percentile(95)) / 1_000_000),
    max_ms: rounded(Number(histogram.max) / 1_000_000),
  });
}

function beginEventLoopWindow(name) {
  if (!enabled || !EVENT_LOOP_WINDOW_NAMES.has(name) || activeEventLoopWindows.has(name)) {
    return false;
  }
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  activeEventLoopWindows.set(name, Object.freeze({
    histogram,
    started_at_ms: Date.now(),
    started_at_performance_ms: nodePerformance.now(),
  }));
  return true;
}

function endEventLoopWindow(name) {
  if (!enabled || !EVENT_LOOP_WINDOW_NAMES.has(name)) return false;
  const activeWindow = activeEventLoopWindows.get(name);
  if (activeWindow === undefined) return false;
  activeEventLoopWindows.delete(name);
  activeWindow.histogram.disable();
  if (eventLoopWindows.length < MAX_EVENT_LOOP_WINDOWS) {
    eventLoopWindows.push(Object.freeze({
      name,
      status: 'completed',
      started_at_ms: activeWindow.started_at_ms,
      duration_ms: rounded(nodePerformance.now() - activeWindow.started_at_performance_ms),
      ...snapshotEventLoopHistogram(activeWindow.histogram),
    }));
  }
  return true;
}

function configure(rawOptions) {
  if (
    rawOptions === null
    || typeof rawOptions !== 'object'
    || Array.isArray(rawOptions)
    || Reflect.ownKeys(rawOptions).length !== 2
    || rawOptions.enabled !== true
    || typeof rawOptions.output_path !== 'string'
    || !path.isAbsolute(rawOptions.output_path)
    || path.normalize(rawOptions.output_path) !== rawOptions.output_path
    || rawOptions.output_path.includes('\0')
  ) return false;
  enabled = true;
  outputPath = rawOptions.output_path;
  configuredAtMs = Date.now();
  metrics.clear();
  eventLoopHistogram?.disable();
  for (const activeWindow of activeEventLoopWindows.values()) activeWindow.histogram.disable();
  eventLoopWindows.splice(0);
  activeEventLoopWindows.clear();
  eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHistogram.enable();
  return true;
}

function snapshot() {
  const outputMetrics = [...metrics.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, metric]) => {
      const sorted = [...metric.samples].sort((left, right) => left - right);
      return Object.freeze({
        name,
        count: metric.count,
        sample_count: sorted.length,
        total: rounded(metric.total),
        median: rounded(percentile(sorted, 0.5)),
        p95: rounded(percentile(sorted, 0.95)),
        max: rounded(sorted.at(-1) ?? 0),
      });
    });
  const eventLoop = eventLoopHistogram === null
    ? null
    : snapshotEventLoopHistogram(eventLoopHistogram);
  const activeWindows = [...activeEventLoopWindows.entries()].map(([name, activeWindow]) => (
    Object.freeze({
      name,
      status: 'active',
      started_at_ms: activeWindow.started_at_ms,
      duration_ms: rounded(nodePerformance.now() - activeWindow.started_at_performance_ms),
      ...snapshotEventLoopHistogram(activeWindow.histogram),
    })
  ));
  return Object.freeze({
    trace_version: TRACE_VERSION,
    configured_at_ms: configuredAtMs,
    captured_at_ms: Date.now(),
    metrics: Object.freeze(outputMetrics),
    event_loop_delay: eventLoop,
    event_loop_windows: Object.freeze([...eventLoopWindows, ...activeWindows]),
    privacy: Object.freeze({
      content_fields_recorded: false,
      identifiers_recorded: false,
      paths_recorded: false,
      urls_recorded: false,
    }),
  });
}

function flush() {
  if (!enabled || outputPath === null) return false;
  const result = snapshot();
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, outputPath);
  return true;
}

function resetForTests() {
  eventLoopHistogram?.disable();
  for (const activeWindow of activeEventLoopWindows.values()) activeWindow.histogram.disable();
  eventLoopHistogram = null;
  enabled = false;
  outputPath = null;
  configuredAtMs = 0;
  metrics.clear();
  eventLoopWindows.splice(0);
  activeEventLoopWindows.clear();
}

const builderPerformanceTrace = Object.freeze({
  beginEventLoopWindow,
  configure,
  endEventLoopWindow,
  enabled: () => enabled,
  flush,
  increment,
  measureAsync,
  measureSync,
  observe,
  snapshot,
});

module.exports = Object.freeze({
  TRACE_VERSION,
  builderPerformanceTrace,
  resetBuilderPerformanceTraceForTests: resetForTests,
});
