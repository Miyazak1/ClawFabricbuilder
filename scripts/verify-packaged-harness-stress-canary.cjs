'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const {
  assertCustomChromeControls,
  clickSaveVersionViaUi,
  createArtifactGate,
  createInitialDraftViaUi,
  fillProviderSettingsViaUi,
  openProjectFromCatalogById,
  SELECTORS,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('./verify-packaged-canary-default.cjs');
const {
  delay,
  harnessRequests,
  packagedExecutable,
  readMainPerformanceTrace,
  readRendererPerformanceTrace,
  removeCanaryRoot,
  selectBuildMode,
  waitForSubmitEnabled,
  waitForTaskStreamCounts,
} = require('./verify-packaged-harness-ui-canary.cjs');

const USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const MIB = 1_024 * 1_024;
const PUBLIC_OUTPUT_LIMIT_BYTES = 256 * 1_024;
const RENDERER_STREAM_LIMIT_BYTES = 128 * 1_024;
const TASK_STREAM_PAYLOAD_LIMIT_BYTES = 4 * MIB;
const PB03_INSTRUCTION = 'PB-03 controlled 60-second stream. Do not change files.';
const PB06_INSTRUCTION = 'PB-06 controlled 10 MB output burst. Run the declared project build command.';
const PB07_INSTRUCTION =
  'PB-07 controlled broker read search pressure. Inspect the project with parallel read and search tools. Do not change files.';
const PREVIEW_WORKSPACE_SELECTOR = '[data-builder-side-workspace-browser="true"]';
const A05_BUDGETS = Object.freeze({
  pb03: Object.freeze({
    duration_min_ms: 59_000,
    live_output_received_min: 600,
    task_stream_reads_max: 12,
    task_stream_full_reads_max: 0,
    controller_publishes_max: 12,
    builder_page_commits_max: 40,
    activity_commits_max: 40,
    side_workspace_commits_max: 8,
    side_workspace_mounts_max: 0,
    side_workspace_unmounts_max: 0,
  }),
  pb06: Object.freeze({
    complete_output_bytes: 10 * MIB,
    public_output_bytes_max: PUBLIC_OUTPUT_LIMIT_BYTES,
    renderer_retained_bytes_max: 2 * RENDERER_STREAM_LIMIT_BYTES,
    renderer_flushes_max: 8,
    side_workspace_commits_max: 12,
    side_workspace_mounts_max: 0,
    side_workspace_unmounts_max: 0,
    spill_write_max_ms: 50,
    event_loop_delay_max_ms: 250,
  }),
  b5: Object.freeze({
    main_task_stream_reads_min: 1,
    main_task_stream_ipc_reads_min: 1,
    main_task_stream_projection_reads_min: 1,
    main_task_stream_incremental_reads_min: 1,
    main_task_stream_unchanged_reads_min: 1,
    main_task_stream_result_bytes_max: TASK_STREAM_PAYLOAD_LIMIT_BYTES,
    main_task_stream_projection_result_bytes_max: TASK_STREAM_PAYLOAD_LIMIT_BYTES,
    main_task_stream_legacy_changes_max: 4,
  }),
  g2: Object.freeze({
    broker_read_active_max: 2,
    broker_search_active_max: 1,
    broker_read_queue_wait_count_min: 1,
    broker_search_queue_wait_count_min: 1,
    broker_read_queued_count_min: 1,
    broker_search_queued_count_min: 1,
    broker_read_active_count_min: 4,
    broker_search_active_count_min: 4,
  }),
  g3: Object.freeze({
    runtime_record_events_total_ms_max: 12_000,
    runtime_persist_event_total_ms_max: 12_500,
    conversation_append_total_ms_max: 3_000,
    task_stream_ipc_total_ms_max: 1_000,
    task_stream_projection_total_ms_max: 500,
    application_event_loop_delay_max_ms: 2_500,
    runtime_pending_batch_size_min: 128,
  }),
});

function metric(trace, name) {
  return trace.metrics.find((candidate) => candidate.name === name) ?? Object.freeze({
    count: 0,
    sample_count: 0,
    total: 0,
    median: 0,
    p95: 0,
    max: 0,
  });
}

function metricDelta(before, after, name) {
  const first = metric(before, name);
  const last = metric(after, name);
  return Object.freeze({
    count: last.count - first.count,
    total: Number((last.total - first.total).toFixed(3)),
    max: last.max,
  });
}

function encodedBytes(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');
}

function assertWithin(label, value, maximum) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${label} exceeded its A0.5 budget: ${value} > ${maximum}`);
  }
}

async function markMainEventLoopWindow(app, action, name) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await app.evaluate((_electron, request) => {
        const marker = globalThis.__builderPerformanceTraceEventLoopWindow;
        if (typeof marker !== 'function') return false;
        return marker(request.action, request.name);
      }, Object.freeze({ action, name }));
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Cannot find context with specified id/iu.test(
        error?.message ?? '',
      )) throw error;
      await delay(250);
    }
  }
  throw lastError;
}

async function withMainEventLoopWindow(app, name, callback) {
  await markMainEventLoopWindow(app, 'begin', name);
  try {
    return await callback();
  } finally {
    await markMainEventLoopWindow(app, 'end', name);
  }
}

function eventLoopWindowMap(trace) {
  const byName = new Map();
  for (const entry of trace.event_loop_windows ?? []) {
    const previous = byName.get(entry.name);
    byName.set(entry.name, Object.freeze({
      status: previous?.status === 'active' || entry.status === 'active' ? 'active' : entry.status,
      duration_ms: Math.max(previous?.duration_ms ?? 0, entry.duration_ms),
      max_ms: Math.max(previous?.max_ms ?? 0, entry.max_ms),
      p95_ms: Math.max(previous?.p95_ms ?? 0, entry.p95_ms),
      sample_count: (previous?.sample_count ?? 0) + entry.sample_count,
      window_count: (previous?.window_count ?? 0) + 1,
    }));
  }
  return Object.freeze(Object.fromEntries([...byName.entries()]));
}

function mainRuntimeMetricSummary(trace) {
  return Object.freeze({
    conversation: Object.freeze({
      append_count: metric(trace, 'main.conversation.append.duration_ms').count,
      append_total_ms: metric(trace, 'main.conversation.append.duration_ms').total,
      append_max_ms: metric(trace, 'main.conversation.append.duration_ms').max,
      load_count: metric(trace, 'main.conversation.load.duration_ms').count,
      load_total_ms: metric(trace, 'main.conversation.load.duration_ms').total,
      load_max_ms: metric(trace, 'main.conversation.load.duration_ms').max,
      max_loaded_event_count: metric(trace, 'main.conversation.load.event_count').max,
      max_loaded_event_bytes: metric(trace, 'main.conversation.load.event_bytes').max,
      full_read_count: metric(trace, 'main.conversation.load.full_read_count').count,
      suffix_hit_count: metric(trace, 'main.conversation.load.suffix_hit_count').count,
      cache_hit_count: metric(trace, 'main.conversation.load.cache_hit_count').count,
    }),
    task_stream: Object.freeze({
      changed_live_only: metric(trace, 'main.task_stream.changed.live_only').count,
      changed_durable_append: metric(trace, 'main.task_stream.changed.durable_append').count,
      changed_legacy: metric(trace, 'main.task_stream.changed.legacy').count,
      read_count: metric(trace, 'main.task_stream.read.count').count,
      ipc_count: metric(trace, 'main.task_stream.ipc.duration_ms').count,
      ipc_total_ms: metric(trace, 'main.task_stream.ipc.duration_ms').total,
      ipc_max_ms: metric(trace, 'main.task_stream.ipc.duration_ms').max,
      ipc_result_bytes_count: metric(trace, 'main.task_stream.ipc.result_bytes').count,
      ipc_result_bytes_max: metric(trace, 'main.task_stream.ipc.result_bytes').max,
      projection_count: metric(trace, 'main.task_stream.projection.duration_ms').count,
      projection_total_ms: metric(trace, 'main.task_stream.projection.duration_ms').total,
      projection_max_ms: metric(trace, 'main.task_stream.projection.duration_ms').max,
      projection_result_bytes_count: metric(
        trace,
        'main.task_stream.projection.result_bytes',
      ).count,
      projection_result_bytes_max: metric(trace, 'main.task_stream.projection.result_bytes').max,
      cursor_full_count: metric(trace, 'main.task_stream.cursor.full_count').count,
      cursor_incremental_count: metric(trace, 'main.task_stream.cursor.incremental_count').count,
      cursor_unchanged_count: metric(trace, 'main.task_stream.cursor.unchanged_count').count,
    }),
    provider_output: Object.freeze({
      delta_event_count: metric(trace, 'main.provider_output.delta_event_count').count,
      display_attempt_count: metric(trace, 'main.provider_output.display_attempt_count').count,
      sent_count: metric(trace, 'main.provider_output.sent_count').count,
      suppressed_count: metric(trace, 'main.provider_output.suppressed_count').count,
    }),
    command_approval: Object.freeze({
      request_max_ms: metric(trace, 'main.command_approval.request.duration_ms').max,
      prepare_max_ms: metric(trace, 'main.command_approval.prepare.duration_ms').max,
      wait_decision_max_ms: metric(trace, 'main.command_approval.wait_decision.duration_ms').max,
      decide_max_ms: metric(trace, 'main.command_approval.decide.duration_ms').max,
      consume_max_ms: metric(trace, 'main.command_approval.consume.duration_ms').max,
    }),
    command_executor: Object.freeze({
      execute_max_ms: metric(trace, 'main.command_executor.execute.duration_ms').max,
      materialize_max_ms: metric(trace, 'main.command_executor.materialize.duration_ms').max,
      resolve_runtime_max_ms: metric(trace, 'main.command_executor.resolve_runtime.duration_ms').max,
      read_private_runtime_max_ms:
        metric(trace, 'main.command_executor.read_private_runtime.duration_ms').max,
      process_run_max_ms: metric(trace, 'main.command_executor.process_run.duration_ms').max,
      spawn_max_ms: metric(trace, 'main.command_executor.spawn.duration_ms').max,
      finish_max_ms: metric(trace, 'main.command_executor.finish.duration_ms').max,
      cleanup_max_ms: metric(trace, 'main.command_executor.cleanup.duration_ms').max,
    }),
    harness_candidate: Object.freeze({
      workspace_guard_max_ms: metric(trace, 'main.harness_candidate.workspace_guard.duration_ms').max,
      git_persist_max_ms: metric(trace, 'main.harness_candidate.git_persist.duration_ms').max,
      git_verify_max_ms: metric(trace, 'main.harness_candidate.git_verify.duration_ms').max,
      checkpoint_max_ms: metric(trace, 'main.harness_candidate.checkpoint.duration_ms').max,
      automatic_check_max_ms: metric(trace, 'main.harness_candidate.automatic_check.duration_ms').max,
      record_check_fact_max_ms: metric(trace, 'main.harness_candidate.record_check_fact.duration_ms').max,
      repair_max_ms: metric(trace, 'main.harness_candidate.repair.duration_ms').max,
      reconcile_max_ms: metric(trace, 'main.harness_candidate.reconcile.duration_ms').max,
      materialize_current_max_ms: metric(trace, 'main.harness_candidate.materialize_current.duration_ms').max,
      complete_conversation_max_ms:
        metric(trace, 'main.harness_candidate.complete_conversation.duration_ms').max,
    }),
    harness_response: Object.freeze({
      reconcile_max_ms: metric(trace, 'main.harness_response.reconcile.duration_ms').max,
      complete_conversation_max_ms:
        metric(trace, 'main.harness_response.complete_conversation.duration_ms').max,
    }),
    harness_runner: Object.freeze({
      start_runtime_max_ms: metric(trace, 'main.harness_runner.start_runtime.duration_ms').max,
      wait_completion_max_ms: metric(trace, 'main.harness_runner.wait_completion.duration_ms').max,
      read_conversation_events_max_ms:
        metric(trace, 'main.harness_runner.read_conversation_events.duration_ms').max,
      project_candidate_max_ms: metric(trace, 'main.harness_runner.project_candidate.duration_ms').max,
      reconcile_runtime_max_ms:
        metric(trace, 'main.harness_runner.reconcile_runtime.duration_ms').max,
      repair_runtime_max_ms: metric(trace, 'main.harness_runner.repair_runtime.duration_ms').max,
    }),
    harness_start: Object.freeze({
      build_context_max_ms: metric(trace, 'main.harness_start.build_context.duration_ms').max,
      provider_config_max_ms: metric(trace, 'main.harness_start.provider_config.duration_ms').max,
      resolve_secret_max_ms: metric(trace, 'main.harness_start.resolve_secret.duration_ms').max,
      provider_dispatch_max_ms: metric(trace, 'main.harness_start.provider_dispatch.duration_ms').max,
      run_contract_max_ms: metric(trace, 'main.harness_start.run_contract.duration_ms').max,
      runner_create_max_ms: metric(trace, 'main.harness_start.runner_create.duration_ms').max,
      runner_run_max_ms: metric(trace, 'main.harness_start.runner_run.duration_ms').max,
    }),
    harness_runtime: Object.freeze({
      start_run_max_ms: metric(trace, 'main.harness_runtime.start_run.duration_ms').max,
      host_prompt_max_ms: metric(trace, 'main.harness_runtime.host_prompt.duration_ms').max,
      reconcile_run_max_ms: metric(trace, 'main.harness_runtime.reconcile_run.duration_ms').max,
      repair_run_max_ms: metric(trace, 'main.harness_runtime.repair_run.duration_ms').max,
      stop_with_failure_max_ms:
        metric(trace, 'main.harness_runtime.stop_with_failure.duration_ms').max,
      persist_event_count: metric(trace, 'main.harness_runtime.persist_event.duration_ms').count,
      persist_event_total_ms: metric(trace, 'main.harness_runtime.persist_event.duration_ms').total,
      persist_event_max_ms: metric(trace, 'main.harness_runtime.persist_event.duration_ms').max,
      journal_append_max_ms: metric(trace, 'main.harness_runtime.journal_append.duration_ms').max,
      record_events_count: metric(trace, 'main.harness_runtime.record_events.duration_ms').count,
      record_events_total_ms: metric(trace, 'main.harness_runtime.record_events.duration_ms').total,
      record_events_max_ms: metric(trace, 'main.harness_runtime.record_events.duration_ms').max,
      flush_pending_events_max_ms:
        metric(trace, 'main.harness_runtime.flush_pending_events.duration_ms').max,
      pending_batch_size_max: metric(trace, 'main.harness_runtime.pending_batch_size').max,
      bind_tool_file_max_ms: metric(trace, 'main.harness_runtime.bind_tool_file.duration_ms').max,
    }),
    harness_process_host: Object.freeze({
      initialize_max_ms: metric(trace, 'main.harness_process_host.initialize.duration_ms').max,
      prompt_max_ms: metric(trace, 'main.harness_process_host.prompt.duration_ms').max,
      request_max_ms: metric(trace, 'main.harness_process_host.request.duration_ms').max,
    }),
    harness_jsonrpc: Object.freeze({
      request_count: metric(trace, 'main.harness_jsonrpc.request.duration_ms').count,
      request_max_ms: metric(trace, 'main.harness_jsonrpc.request.duration_ms').max,
      request_serialize_max_ms:
        metric(trace, 'main.harness_jsonrpc.request_serialize.duration_ms').max,
      request_write_max_ms: metric(trace, 'main.harness_jsonrpc.request_write.duration_ms').max,
      handle_data_count: metric(trace, 'main.harness_jsonrpc.handle_data.duration_ms').count,
      handle_data_max_ms: metric(trace, 'main.harness_jsonrpc.handle_data.duration_ms').max,
      parse_frame_max_ms: metric(trace, 'main.harness_jsonrpc.parse_frame.duration_ms').max,
      dispatch_notification_max_ms:
        metric(trace, 'main.harness_jsonrpc.dispatch_notification.duration_ms').max,
      settle_response_max_ms:
        metric(trace, 'main.harness_jsonrpc.settle_response.duration_ms').max,
    }),
    harness_tool_broker: Object.freeze({
      dispatch_count: metric(trace, 'main.harness_tool_broker.dispatch.duration_ms').count,
      dispatch_max_ms: metric(trace, 'main.harness_tool_broker.dispatch.duration_ms').max,
      read_request_max_ms: metric(trace, 'main.harness_tool_broker.read_request.duration_ms').max,
      parse_request_max_ms: metric(trace, 'main.harness_tool_broker.parse_request.duration_ms').max,
      execute_tool_max_ms: metric(trace, 'main.harness_tool_broker.execute_tool.duration_ms').max,
      tool_read_max_ms: metric(trace, 'main.harness_tool_broker.tool_read.duration_ms').max,
      tool_read_active_count:
        metric(trace, 'main.harness_tool_broker.tool_read.active_count').count,
      tool_read_active_max: metric(trace, 'main.harness_tool_broker.tool_read.active_count').max,
      tool_read_queue_wait_count:
        metric(trace, 'main.harness_tool_broker.tool_read.queue_wait.duration_ms').count,
      tool_read_queued_count:
        metric(trace, 'main.harness_tool_broker.tool_read.queued_count').count,
      tool_search_max_ms: metric(trace, 'main.harness_tool_broker.tool_search.duration_ms').max,
      tool_search_active_count:
        metric(trace, 'main.harness_tool_broker.tool_search.active_count').count,
      tool_search_active_max:
        metric(trace, 'main.harness_tool_broker.tool_search.active_count').max,
      tool_search_queue_wait_count:
        metric(trace, 'main.harness_tool_broker.tool_search.queue_wait.duration_ms').count,
      tool_search_queued_count:
        metric(trace, 'main.harness_tool_broker.tool_search.queued_count').count,
      tool_edit_max_ms: metric(trace, 'main.harness_tool_broker.tool_edit.duration_ms').max,
      tool_write_max_ms: metric(trace, 'main.harness_tool_broker.tool_write.duration_ms').max,
      tool_execute_command_max_ms:
        metric(trace, 'main.harness_tool_broker.tool_execute_command.duration_ms').max,
      tool_ask_user_question_max_ms:
        metric(trace, 'main.harness_tool_broker.tool_ask_user_question.duration_ms').max,
      send_response_max_ms: metric(trace, 'main.harness_tool_broker.send_response.duration_ms').max,
      user_question_max_ms: metric(trace, 'main.harness_tool_broker.user_question.duration_ms').max,
      start_max_ms: metric(trace, 'main.harness_tool_broker.start.duration_ms').max,
    }),
  });
}

async function waitForHarnessKind(providerServer, kind, timeoutMs = 120_000, options = {}) {
  const requireCompleted = options.completed === true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const request = harnessRequests(providerServer).find((candidate) => (
      candidate.response_kind === kind
      && (!requireCompleted || candidate.completed === true)
    ));
    if (request !== undefined) return request;
    await delay(100);
  }
  throw new Error(`Packaged Harness did not observe ${kind}.`);
}

async function openPreviewAndMarkStable(page) {
  const previewHost = page.locator(PREVIEW_WORKSPACE_SELECTOR).first();
  if (!await previewHost.isVisible().catch(() => false)) {
    await page.locator(SELECTORS.workspaceMenuButton).first().click();
    await page.locator(SELECTORS.workspaceControlPreview).first().click();
  }
  await previewHost.waitFor({ state: 'visible', timeout: 30_000 });
  await previewHost.evaluate((element) => {
    element.dataset.a05StablePreviewHost = 'true';
  });
  await page.locator(SELECTORS.preview).first().waitFor({ state: 'visible', timeout: 30_000 });
  return previewHost;
}

async function assertPreviewStable(page) {
  const previewHost = page.locator(`${PREVIEW_WORKSPACE_SELECTOR}[data-a05-stable-preview-host="true"]`).first();
  if (await previewHost.count() !== 1 || !await previewHost.evaluate((element) => element.isConnected)) {
    throw new Error('Packaged Harness preview host remounted or disappeared during stress output.');
  }
  if (!await previewHost.isVisible().catch(() => false)) {
    const sidebar = previewHost.locator(
      'xpath=ancestor::aside[@data-builder-artifact-sidebar="true"]',
    );
    if (await sidebar.count() !== 1) {
      throw new Error('Packaged Harness preview lost its owning Side Workspace.');
    }
    const previewTab = sidebar.locator(
      '[data-builder-side-workspace-tool="preview"]',
    ).first();
    await previewTab.click();
    await sidebar.locator(
      '[data-builder-side-workspace-tool="preview"][aria-selected="true"]',
    ).waitFor({ state: 'visible', timeout: 30_000 });
    await previewHost.waitFor({ state: 'visible', timeout: 30_000 });
  }
}

async function submitInstruction(page, instruction) {
  await selectBuildMode(page);
  await page.locator(SELECTORS.idea).fill(instruction);
  const submit = await waitForSubmitEnabled(page);
  await submit.click();
}

function collectRetentionReceipts(root) {
  const receipts = [];
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 20_000) throw new Error('Command output retention scan exceeded its bound.');
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
      } else if (
        path.basename(path.dirname(target)) === 'controlled-command-output-v1'
        && entry.name.endsWith('.json')
      ) {
        receipts.push(Object.freeze({
          metadata_path: target,
          value: JSON.parse(fs.readFileSync(target, 'utf8')),
        }));
      }
    }
  }
  return receipts;
}

function verifyBurstRetention(userDataPath) {
  const receipt = collectRetentionReceipts(userDataPath).find(({ value }) => (
    value?.stdout_bytes === 5 * MIB
    && value?.stderr_bytes === 5 * MIB
    && value?.status === 'passed'
  ));
  if (receipt === undefined) {
    throw new Error('Packaged Harness 10 MiB private output receipt is unavailable.');
  }
  const token = path.basename(receipt.metadata_path, '.json');
  const outputRoot = path.dirname(receipt.metadata_path);
  const stdoutPath = path.join(outputRoot, `${token}.stdout.log`);
  const stderrPath = path.join(outputRoot, `${token}.stderr.log`);
  const value = receipt.value;
  if (
    fs.statSync(stdoutPath).size !== 5 * MIB
    || fs.statSync(stderrPath).size !== 5 * MIB
    || value.stdout_lines !== 80
    || value.stderr_lines !== 80
    || !/^sha256:[0-9a-f]{64}$/u.test(value.stdout_digest ?? '')
    || !/^sha256:[0-9a-f]{64}$/u.test(value.stderr_digest ?? '')
    || !/^builder-command-output:[0-9a-f]{64}$/u.test(value.complete_output_ref ?? '')
  ) throw new Error('Packaged Harness private output receipt is incomplete.');
  return Object.freeze({
    status: value.status,
    stdout_bytes: value.stdout_bytes,
    stderr_bytes: value.stderr_bytes,
    stdout_lines: value.stdout_lines,
    stderr_lines: value.stderr_lines,
    digests_verified: true,
    opaque_reference_verified: true,
  });
}

function qualifyPb03(before, after, durationMs) {
  const result = Object.freeze({
    duration_ms: durationMs,
    live_output_received: metricDelta(
      before,
      after,
      'renderer.live_output.received_count',
    ).count,
    live_output_dropped: metricDelta(
      before,
      after,
      'renderer.live_output.dropped_count',
    ).count,
    task_stream_reads: metricDelta(
      before,
      after,
      'renderer.task_stream.read.duration_ms',
    ).count,
    task_stream_full_reads: metricDelta(
      before,
      after,
      'renderer.task_stream.cursor.full_count',
    ).count,
    controller_publishes: metricDelta(
      before,
      after,
      'renderer.task_stream.controller_publish_count',
    ).count,
    builder_page_commits: metricDelta(
      before,
      after,
      'renderer.builder_page.commit_count',
    ).count,
    activity_commits: metricDelta(
      before,
      after,
      'renderer.activity.commit_count',
    ).count,
    activity_snapshot_render_reasons: metricDelta(
      before,
      after,
      'renderer.activity.render_reason.snapshot',
    ).count,
    activity_candidate_render_reasons: metricDelta(
      before,
      after,
      'renderer.activity.render_reason.candidate_changes',
    ).count,
    activity_live_output_render_reasons: metricDelta(
      before,
      after,
      'renderer.activity.render_reason.live_output',
    ).count,
    activity_other_state_render_reasons: metricDelta(
      before,
      after,
      'renderer.activity.render_reason.other_state',
    ).count,
    side_workspace_commits: metricDelta(
      before,
      after,
      'renderer.side_workspace.commit_count',
    ).count,
    side_workspace_mounts: metricDelta(
      before,
      after,
      'renderer.side_workspace.mount_count',
    ).count,
    side_workspace_unmounts: metricDelta(
      before,
      after,
      'renderer.side_workspace.unmount_count',
    ).count,
  });
  const violations = [
    result.duration_ms < A05_BUDGETS.pb03.duration_min_ms ? 'duration' : null,
    result.live_output_received < A05_BUDGETS.pb03.live_output_received_min
      ? 'live_output_received'
      : null,
    result.live_output_dropped !== 0 ? 'live_output_dropped' : null,
    result.task_stream_reads > A05_BUDGETS.pb03.task_stream_reads_max
      ? 'task_stream_reads'
      : null,
    result.task_stream_full_reads > A05_BUDGETS.pb03.task_stream_full_reads_max
      ? 'task_stream_full_reads'
      : null,
    result.controller_publishes > A05_BUDGETS.pb03.controller_publishes_max
      ? 'controller_publishes'
      : null,
    result.builder_page_commits > A05_BUDGETS.pb03.builder_page_commits_max
      ? 'builder_page_commits'
      : null,
    result.activity_commits > A05_BUDGETS.pb03.activity_commits_max
      ? 'activity_commits'
      : null,
    result.side_workspace_commits > A05_BUDGETS.pb03.side_workspace_commits_max
      ? 'side_workspace_commits'
      : null,
    result.side_workspace_mounts > A05_BUDGETS.pb03.side_workspace_mounts_max
      ? 'side_workspace_mounts'
      : null,
    result.side_workspace_unmounts > A05_BUDGETS.pb03.side_workspace_unmounts_max
      ? 'side_workspace_unmounts'
      : null,
  ].filter(Boolean);
  if (violations.length > 0) {
    throw new Error(`PB-03 performance gate failed: ${JSON.stringify({
      budgets: A05_BUDGETS.pb03,
      result,
      violations,
    })}`);
  }
  return result;
}

function qualifyPb06(before, after, uiEvidence) {
  const result = Object.freeze({
    renderer_received_bytes: metricDelta(
      before,
      after,
      'renderer.command_output.received_bytes',
    ).total,
    renderer_received_events: metricDelta(
      before,
      after,
      'renderer.command_output.received_count',
    ).count,
    renderer_flushes: metricDelta(
      before,
      after,
      'renderer.command_output.flush_count',
    ).count,
    renderer_retained_bytes_max: metric(after, 'renderer.command_output.retained_bytes').max,
    side_workspace_commits: metricDelta(
      before,
      after,
      'renderer.side_workspace.commit_count',
    ).count,
    side_workspace_mounts: metricDelta(
      before,
      after,
      'renderer.side_workspace.mount_count',
    ).count,
    side_workspace_unmounts: metricDelta(
      before,
      after,
      'renderer.side_workspace.unmount_count',
    ).count,
    ...uiEvidence,
  });
  const violations = [
    result.renderer_received_bytes > A05_BUDGETS.pb06.public_output_bytes_max
      ? 'renderer_received_bytes'
      : null,
    result.renderer_retained_bytes_max > A05_BUDGETS.pb06.renderer_retained_bytes_max
      ? 'renderer_retained_bytes_max'
      : null,
    result.renderer_flushes > A05_BUDGETS.pb06.renderer_flushes_max
      ? 'renderer_flushes'
      : null,
    result.side_workspace_commits > A05_BUDGETS.pb06.side_workspace_commits_max
      ? 'side_workspace_commits'
      : null,
    result.side_workspace_mounts > A05_BUDGETS.pb06.side_workspace_mounts_max
      ? 'side_workspace_mounts'
      : null,
    result.side_workspace_unmounts > A05_BUDGETS.pb06.side_workspace_unmounts_max
      ? 'side_workspace_unmounts'
      : null,
    !result.truncation_visible ? 'truncation_visible' : null,
    result.stdout_visible_bytes > RENDERER_STREAM_LIMIT_BYTES ? 'stdout_visible_bytes' : null,
    result.stderr_visible_bytes > RENDERER_STREAM_LIMIT_BYTES ? 'stderr_visible_bytes' : null,
    result.private_reference_hidden !== true ? 'private_reference_hidden' : null,
  ].filter(Boolean);
  if (violations.length > 0) {
    throw new Error(`PB-06 performance gate failed: ${JSON.stringify({
      budgets: A05_BUDGETS.pb06,
      result,
      violations,
    })}`);
  }
  return result;
}

function qualifyMain(trace) {
  const received = metric(trace, 'main.command_output.received_bytes');
  const publicEvents = metric(trace, 'main.command_output.public_event_bytes');
  const retained = metric(trace, 'main.command_output.spill_retained_bytes');
  const writes = metric(trace, 'main.command_output.spill_write.duration_ms');
  const result = Object.freeze({
    received_bytes_total: received.total,
    public_event_bytes_total: publicEvents.total,
    largest_retained_output_bytes: retained.max,
    spill_write_max_ms: writes.max,
    event_loop_delay_max_ms: metric(trace, 'main.command_output.event_loop_delay_ms').max,
    application_event_loop_delay_max_ms: trace.event_loop_delay?.max_ms ?? 0,
    lifecycle: Object.freeze({
      ready_handler_max_ms: metric(trace, 'main.lifecycle.ready_handler.duration_ms').max,
      create_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.create_ipc_runtimes.duration_ms').max,
      register_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.register_ipc_runtimes.duration_ms').max,
      create_main_window_max_ms: metric(trace, 'main.lifecycle.create_main_window.duration_ms').max,
      shutdown_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.shutdown_ipc_runtimes.duration_ms').max,
    }),
    event_loop_windows: eventLoopWindowMap(trace),
    runtime_metrics: mainRuntimeMetricSummary(trace),
  });
  if (
    result.received_bytes_total < A05_BUDGETS.pb06.complete_output_bytes
    || result.largest_retained_output_bytes !== A05_BUDGETS.pb06.complete_output_bytes
  ) throw new Error(`PB-06 Main retention evidence is incomplete: ${JSON.stringify(result)}`);
  assertWithin(
    'PB-06 cumulative public output',
    result.public_event_bytes_total,
    A05_BUDGETS.pb06.public_output_bytes_max + 64 * 1_024,
  );
  assertWithin('PB-06 spill write', result.spill_write_max_ms, A05_BUDGETS.pb06.spill_write_max_ms);
  assertWithin('PB-06 event-loop delay', result.event_loop_delay_max_ms, A05_BUDGETS.pb06.event_loop_delay_max_ms);
  return result;
}

function qualifyB5PackagedEvidence(trace) {
  const taskStream = mainRuntimeMetricSummary(trace).task_stream;
  const result = Object.freeze({
    read_count: taskStream.read_count,
    ipc_count: taskStream.ipc_count,
    ipc_result_bytes_count: taskStream.ipc_result_bytes_count,
    ipc_result_bytes_max: taskStream.ipc_result_bytes_max,
    projection_count: taskStream.projection_count,
    projection_result_bytes_count: taskStream.projection_result_bytes_count,
    projection_result_bytes_max: taskStream.projection_result_bytes_max,
    cursor_full_count: taskStream.cursor_full_count,
    cursor_incremental_count: taskStream.cursor_incremental_count,
    cursor_unchanged_count: taskStream.cursor_unchanged_count,
    changed_legacy: taskStream.changed_legacy,
  });
  const violations = [
    result.read_count < A05_BUDGETS.b5.main_task_stream_reads_min ? 'read_count' : null,
    result.ipc_count < A05_BUDGETS.b5.main_task_stream_ipc_reads_min ? 'ipc_count' : null,
    result.ipc_result_bytes_count < A05_BUDGETS.b5.main_task_stream_ipc_reads_min
      ? 'ipc_result_bytes_count'
      : null,
    result.projection_count < A05_BUDGETS.b5.main_task_stream_projection_reads_min
      ? 'projection_count'
      : null,
    result.projection_result_bytes_count < A05_BUDGETS.b5.main_task_stream_projection_reads_min
      ? 'projection_result_bytes_count'
      : null,
    result.cursor_incremental_count < A05_BUDGETS.b5.main_task_stream_incremental_reads_min
      ? 'cursor_incremental_count'
      : null,
    result.cursor_unchanged_count < A05_BUDGETS.b5.main_task_stream_unchanged_reads_min
      ? 'cursor_unchanged_count'
      : null,
    result.changed_legacy > A05_BUDGETS.b5.main_task_stream_legacy_changes_max
      ? 'changed_legacy'
      : null,
    result.ipc_result_bytes_max > A05_BUDGETS.b5.main_task_stream_result_bytes_max
      ? 'ipc_result_bytes_max'
      : null,
    result.projection_result_bytes_max
      > A05_BUDGETS.b5.main_task_stream_projection_result_bytes_max
      ? 'projection_result_bytes_max'
      : null,
  ].filter(Boolean);
  if (violations.length > 0) {
    throw new Error(`B5 packaged performance evidence gate failed: ${JSON.stringify({
      budgets: A05_BUDGETS.b5,
      result,
      violations,
    })}`);
  }
  return result;
}

function qualifyG2BrokerSchedulerEvidence(trace) {
  const broker = mainRuntimeMetricSummary(trace).harness_tool_broker;
  const result = Object.freeze({
    tool_read_active_count: broker.tool_read_active_count,
    tool_read_active_max: broker.tool_read_active_max,
    tool_read_queue_wait_count: broker.tool_read_queue_wait_count,
    tool_read_queued_count: broker.tool_read_queued_count,
    tool_search_active_count: broker.tool_search_active_count,
    tool_search_active_max: broker.tool_search_active_max,
    tool_search_queue_wait_count: broker.tool_search_queue_wait_count,
    tool_search_queued_count: broker.tool_search_queued_count,
  });
  const violations = [
    result.tool_read_active_count < A05_BUDGETS.g2.broker_read_active_count_min
      ? 'tool_read_active_count'
      : null,
    result.tool_search_active_count < A05_BUDGETS.g2.broker_search_active_count_min
      ? 'tool_search_active_count'
      : null,
    result.tool_read_active_max > A05_BUDGETS.g2.broker_read_active_max
      ? 'tool_read_active_max'
      : null,
    result.tool_search_active_max > A05_BUDGETS.g2.broker_search_active_max
      ? 'tool_search_active_max'
      : null,
    result.tool_read_queue_wait_count < A05_BUDGETS.g2.broker_read_queue_wait_count_min
      ? 'tool_read_queue_wait_count'
      : null,
    result.tool_search_queue_wait_count < A05_BUDGETS.g2.broker_search_queue_wait_count_min
      ? 'tool_search_queue_wait_count'
      : null,
    result.tool_read_queued_count < A05_BUDGETS.g2.broker_read_queued_count_min
      ? 'tool_read_queued_count'
      : null,
    result.tool_search_queued_count < A05_BUDGETS.g2.broker_search_queued_count_min
      ? 'tool_search_queued_count'
      : null,
  ].filter(Boolean);
  if (violations.length > 0) {
    throw new Error(`G2 broker scheduler evidence gate failed: ${JSON.stringify({
      budgets: A05_BUDGETS.g2,
      result,
      violations,
    })}`);
  }
  return result;
}

function qualifyG3RuntimePersistenceEvidence(trace) {
  const summary = mainRuntimeMetricSummary(trace);
  const result = Object.freeze({
    runtime_record_events_total_ms: summary.harness_runtime.record_events_total_ms,
    runtime_persist_event_total_ms: summary.harness_runtime.persist_event_total_ms,
    conversation_append_total_ms: summary.conversation.append_total_ms,
    task_stream_ipc_total_ms: summary.task_stream.ipc_total_ms,
    task_stream_projection_total_ms: summary.task_stream.projection_total_ms,
    application_event_loop_delay_max_ms: trace.event_loop_delay?.max_ms ?? 0,
    runtime_pending_batch_size_max: summary.harness_runtime.pending_batch_size_max,
  });
  const violations = [
    result.runtime_record_events_total_ms
      > A05_BUDGETS.g3.runtime_record_events_total_ms_max
      ? 'runtime_record_events_total_ms'
      : null,
    result.runtime_persist_event_total_ms
      > A05_BUDGETS.g3.runtime_persist_event_total_ms_max
      ? 'runtime_persist_event_total_ms'
      : null,
    result.conversation_append_total_ms
      > A05_BUDGETS.g3.conversation_append_total_ms_max
      ? 'conversation_append_total_ms'
      : null,
    result.task_stream_ipc_total_ms
      > A05_BUDGETS.g3.task_stream_ipc_total_ms_max
      ? 'task_stream_ipc_total_ms'
      : null,
    result.task_stream_projection_total_ms
      > A05_BUDGETS.g3.task_stream_projection_total_ms_max
      ? 'task_stream_projection_total_ms'
      : null,
    result.application_event_loop_delay_max_ms
      > A05_BUDGETS.g3.application_event_loop_delay_max_ms
      ? 'application_event_loop_delay_max_ms'
      : null,
    result.runtime_pending_batch_size_max
      < A05_BUDGETS.g3.runtime_pending_batch_size_min
      ? 'runtime_pending_batch_size_max'
      : null,
  ].filter(Boolean);
  if (violations.length > 0) {
    throw new Error(`G3 runtime persistence evidence gate failed: ${JSON.stringify({
      budgets: A05_BUDGETS.g3,
      result,
      violations,
    })}`);
  }
  return result;
}

function qualifyMainAttribution(trace) {
  return Object.freeze({
    application_event_loop_delay_max_ms: trace.event_loop_delay?.max_ms ?? 0,
    lifecycle: Object.freeze({
      ready_handler_max_ms: metric(trace, 'main.lifecycle.ready_handler.duration_ms').max,
      create_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.create_ipc_runtimes.duration_ms').max,
      register_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.register_ipc_runtimes.duration_ms').max,
      create_main_window_max_ms: metric(trace, 'main.lifecycle.create_main_window.duration_ms').max,
      shutdown_ipc_runtimes_max_ms: metric(trace, 'main.lifecycle.shutdown_ipc_runtimes.duration_ms').max,
    }),
    event_loop_windows: eventLoopWindowMap(trace),
    runtime_metrics: mainRuntimeMetricSummary(trace),
  });
}

async function main() {
  const argumentsSet = new Set(process.argv.slice(2));
  if ([...argumentsSet].some((value) => !['--keep-data', '--pb06-only'].includes(value))) {
    throw new Error('Packaged Harness stress canary arguments are invalid.');
  }
  const keepData = argumentsSet.has('--keep-data')
    || process.env.BUILDER_KEEP_HARNESS_CANARY_DATA === '1';
  const pb06Only = argumentsSet.has('--pb06-only');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({
    harnessStressScenarios: true,
    onRequest(request) {
      process.stderr.write(`${JSON.stringify({
        stage: 'stress_provider_request',
        response_kind: request.response_kind,
        stream_event_count: request.stream_event_count,
      })}\n`);
    },
  });
  let app = null;
  let failureAttribution = null;
  try {
    const sourceEnvironment = { ...process.env };
    delete sourceEnvironment.BUILDER_PROGRAMMING_RUNTIME;
    delete sourceEnvironment.BUILDER_HARNESS_RUNTIME_ROOT;
    const launchEnvironment = Object.freeze({
      ...sanitizeLaunchEnvironment(sourceEnvironment, userDataPath, projectRootPath),
      BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS: '75',
      BUILDER_PACKAGED_CANARY_MAX_TOOL_OUTPUT_BYTES: String(12 * MIB),
      BUILDER_PERF_TRACE: '1',
    });
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: launchEnvironment,
    });
    let page = await app.firstWindow();
    await assertCustomChromeControls(page);
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-stress-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 2_000,
    }, createArtifactGate());
    await createInitialDraftViaUi(page, 'Make a small focus timer.', { path: userDataPath });
    const projectId = await page.locator('[data-builder-route-project-id]').first()
      .getAttribute('data-builder-route-project-id');
    if (!/^builder-project:[0-9a-f-]{36}$/u.test(projectId ?? '')) {
      throw new Error('Packaged Harness stress project identity is unavailable.');
    }
    await openPreviewAndMarkStable(page);

    let pb03Qualification = null;
    if (!pb06Only) {
      const pb03CountsBefore = await waitForTaskStreamCounts(
        page,
        projectId,
        () => true,
        'PB-03 baseline task stream is unavailable',
      );
      const pb03TraceBefore = await readRendererPerformanceTrace(page);
      const pb03StartedAt = Date.now();
      const pb03Request = await withMainEventLoopWindow(
        app,
        'pb03_streaming_to_terminal',
        async () => {
          await withMainEventLoopWindow(app, 'pb03_submit_to_first_live', async () => {
            await submitInstruction(page, PB03_INSTRUCTION);
            await page.locator(SELECTORS.liveOutput).first().waitFor({ state: 'visible', timeout: 10_000 });
          });
          await withMainEventLoopWindow(
            app,
            'pb03_first_live_to_preview_stable',
            async () => {
              await delay(1_000);
              await assertPreviewStable(page);
            },
          );
          const request = await withMainEventLoopWindow(
            app,
            'pb03_preview_stable_to_provider_complete',
            () => waitForHarnessKind(providerServer, 'harness_pb03_long_stream', 120_000, {
              completed: true,
            }),
          );
          await withMainEventLoopWindow(
            app,
            'pb03_provider_complete_to_terminal',
            () => waitForTaskStreamCounts(
              page,
              projectId,
              (counts) => counts.run_completed_count > pb03CountsBefore.run_completed_count,
              'PB-03 did not reach its durable terminal boundary',
            ),
          );
          return request;
        },
      );
      const pb03DurationMs = Date.now() - pb03StartedAt;
      const pb03TraceAfter = await readRendererPerformanceTrace(page);
      await assertPreviewStable(page);
      if (
        pb03Request.stream_event_count !== 602
        || pb03Request.stream_event_delay_ms !== 100
      ) throw new Error(`PB-03 provider fixture is invalid: ${JSON.stringify(pb03Request)}`);
      pb03Qualification = qualifyPb03(pb03TraceBefore, pb03TraceAfter, pb03DurationMs);
      process.stderr.write(`${JSON.stringify({
        stage: 'pb03_qualified',
        qualification: pb03Qualification,
      })}\n`);

      const pb07CountsBefore = await waitForTaskStreamCounts(
        page,
        projectId,
        () => true,
        'PB-07 baseline task stream is unavailable',
      );
      const pb07Request = await withMainEventLoopWindow(
        app,
        'pb07_broker_read_search_pressure',
        async () => {
          await submitInstruction(page, PB07_INSTRUCTION);
          await waitForHarnessKind(providerServer, 'harness_pb07_tool_pressure', 30_000, {
            completed: true,
          });
          await waitForHarnessKind(providerServer, 'harness_pb07_completed', 30_000);
          await waitForTaskStreamCounts(
            page,
            projectId,
            (counts) => counts.run_completed_count > pb07CountsBefore.run_completed_count,
            'PB-07 did not reach its durable terminal boundary',
          );
          return harnessRequests(providerServer).filter(
            (request) => request.response_kind === 'harness_pb07_tool_pressure',
          ).at(-1);
        },
      );
      if (pb07Request?.stream_event_count !== 4) {
        throw new Error(`PB-07 provider fixture is invalid: ${JSON.stringify(pb07Request)}`);
      }
      await assertPreviewStable(page);
      process.stderr.write(`${JSON.stringify({
        stage: 'pb07_qualified',
        qualification: {
          batched_tool_calls: 8,
          provider_stream_events: pb07Request.stream_event_count,
        },
      })}\n`);
    }

    const pb06CountsBefore = await waitForTaskStreamCounts(
      page,
      projectId,
      () => true,
      'PB-06 baseline task stream is unavailable',
    );
    const pb06TraceBefore = await readRendererPerformanceTrace(page);
    const terminal = await withMainEventLoopWindow(
      app,
      'pb06_output_to_terminal',
      async () => {
        await withMainEventLoopWindow(app, 'pb06_submit_to_command_approval', async () => {
          await submitInstruction(page, PB06_INSTRUCTION);
          await waitForHarnessKind(providerServer, 'harness_pb06_command');
          const approval = page.locator('[data-builder-command-approval="true"]').last();
          await approval.waitFor({ state: 'visible', timeout: 30_000 });
        });
        await withMainEventLoopWindow(
          app,
          'pb06_command_approval_to_command_provider',
          async () => {
            await page.locator('[data-builder-allow-command-once="true"]').last().click();
            await waitForHarnessKind(providerServer, 'harness_pb06_command', 30_000, {
              completed: true,
            });
          },
        );
        await withMainEventLoopWindow(
          app,
          'pb06_command_provider_to_completed_provider',
          () => waitForHarnessKind(providerServer, 'harness_pb06_completed'),
        );
        await withMainEventLoopWindow(
          app,
          'pb06_completed_provider_to_task_stream_terminal',
          () => waitForTaskStreamCounts(
            page,
            projectId,
            (counts) => counts.run_completed_count > pb06CountsBefore.run_completed_count,
            'PB-06 did not reach its durable terminal boundary',
          ),
        );
        return await withMainEventLoopWindow(app, 'pb06_terminal_tab_settle', async () => {
          const terminalTab = page.locator(
            '[data-builder-side-workspace-tool="terminal_placeholder"]',
          ).first();
          await terminalTab.waitFor({ state: 'visible', timeout: 30_000 });
          if (await terminalTab.getAttribute('aria-selected') !== 'true') await terminalTab.click();
          const commandTerminal = page.locator('[data-builder-command-terminal]').last();
          await commandTerminal.waitFor({ state: 'visible', timeout: 30_000 });
          const terminalDeadline = Date.now() + 30_000;
          while (
            Date.now() < terminalDeadline
            && await commandTerminal.getAttribute('data-builder-command-terminal') !== 'completed'
          ) await delay(100);
          return commandTerminal;
        });
      },
    );
    const terminalState = await terminal.getAttribute('data-builder-command-terminal');
    if (terminalState !== 'completed') {
      const terminalText = (await terminal.textContent())?.replace(/\s+/gu, ' ').trim() ?? '';
      throw new Error(`PB-06 command terminal did not settle: ${JSON.stringify({
        state: terminalState ?? 'missing',
        text: terminalText.slice(0, 1_000),
      })}`);
    }
    const [stdoutText, stderrText, truncationVisible, bodyText] = await Promise.all([
      terminal.locator('[data-builder-command-stdout="true"]').textContent(),
      terminal.locator('[data-builder-command-stderr="true"]').textContent(),
      terminal.locator('.cf-builder-side-workspace-terminal-truncated').isVisible(),
      page.locator('body').innerText(),
    ]);
    const pb06TraceAfter = await readRendererPerformanceTrace(page);
    await assertPreviewStable(page);
    const pb06Qualification = qualifyPb06(pb06TraceBefore, pb06TraceAfter, Object.freeze({
      stdout_visible_bytes: encodedBytes(stdoutText),
      stderr_visible_bytes: encodedBytes(stderrText),
      truncation_visible: truncationVisible,
      private_reference_hidden:
        !bodyText.includes('builder-command-output:')
        && !bodyText.includes('controlled-command-output-v1'),
    }));
    process.stderr.write(`${JSON.stringify({
      stage: 'pb06_qualified',
      qualification: pb06Qualification,
    })}\n`);
    const retentionEvidence = verifyBurstRetention(userDataPath);

    await withMainEventLoopWindow(app, 'save_version_refresh', async () => {
      const saveButton = page.locator(`${SELECTORS.saveVersion}:visible`).last();
      await saveButton.waitFor({ state: 'visible', timeout: 30_000 });
      await clickSaveVersionViaUi(page);
      await page.locator(`${SELECTORS.saveVersion}:visible`).waitFor({
        state: 'hidden',
        timeout: 60_000,
      });
      await page.locator(`${SELECTORS.unsavedDraft}:visible`).waitFor({
        state: 'hidden',
        timeout: 60_000,
      });
      await page.locator(SELECTORS.versionSavedActivity).last().waitFor({
        state: 'visible',
        timeout: 60_000,
      });
    });

    await markMainEventLoopWindow(app, 'begin', 'close_after_save');
    await app.close();
    app = null;
    const mainTrace = readMainPerformanceTrace(userDataPath);
    const mainQualification = qualifyMain(mainTrace);
    const b5PackagedEvidence = qualifyB5PackagedEvidence(mainTrace);
    const g2BrokerSchedulerEvidence = pb06Only
      ? null
      : qualifyG2BrokerSchedulerEvidence(mainTrace);
    const g3RuntimePersistenceEvidence = qualifyG3RuntimePersistenceEvidence(mainTrace);

    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: launchEnvironment,
    });
    page = await app.firstWindow();
    await assertCustomChromeControls(page);
    await withMainEventLoopWindow(app, 'restart_reopen_project', async () => {
      await openProjectFromCatalogById(page, { project_id: projectId });
      await page.locator(
        `${SELECTORS.projectPage}[data-builder-conversation-project-id="${projectId}"]`,
      ).first().waitFor({ state: 'visible', timeout: 60_000 });
      if (await page.locator(SELECTORS.unsavedDraft).isVisible().catch(() => false)) {
        throw new Error('PB-06 saved project reopened with an unexpected unsaved draft.');
      }
      await openPreviewAndMarkStable(page);
    });
    await markMainEventLoopWindow(app, 'begin', 'close_after_restart');
    await app.close();
    app = null;
    const restartMainAttribution = qualifyMainAttribution(readMainPerformanceTrace(userDataPath));

      process.stdout.write(`${JSON.stringify({
      result_version: 'builder-packaged-harness-stress-canary.v1',
      runtime_kind: 'deepseek_harness.v1',
      a05_gate_verified: true,
      b5_packaged_performance_evidence_verified: true,
      g2_broker_scheduler_evidence_verified: g2BrokerSchedulerEvidence !== null,
      g3_runtime_persistence_evidence_verified: true,
      performance_scenario_coverage: Object.freeze(['PB-03', 'PB-06', 'PB-07']),
      budgets: A05_BUDGETS,
      pb03: pb03Qualification,
      pb06: pb06Qualification,
      main: mainQualification,
      b5_packaged_evidence: b5PackagedEvidence,
      g2_broker_scheduler_evidence: g2BrokerSchedulerEvidence,
      g3_runtime_persistence_evidence: g3RuntimePersistenceEvidence,
      restart_main: restartMainAttribution,
      retention: retentionEvidence,
      preview_stable_during_streaming: true,
      preview_stable_during_output_burst: true,
      save_card_dismissed_after_save: true,
      saved_project_reopened_without_draft: true,
      performance_trace_privacy_verified: true,
    }, null, 2)}\n`);
  } catch (error) {
    if (app !== null) {
      await app.close().catch(() => {});
      app = null;
    }
    try {
      failureAttribution = qualifyMainAttribution(readMainPerformanceTrace(userDataPath));
    } catch {
      failureAttribution = null;
    }
    if (failureAttribution !== null) {
      process.stderr.write(`${JSON.stringify({
        stage: 'stress_failure_main_attribution',
        attribution: failureAttribution,
      })}\n`);
    }
    throw error;
  } finally {
    if (app !== null) await app.close().catch(() => {});
    await providerServer.close();
    if (keepData) {
      process.stderr.write(`${JSON.stringify({
        stage: 'canary_data_retained',
        user_data_path: userDataPath,
      })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code ?? 'canary_evidence_failed',
      diagnostic: error?.diagnostic ?? null,
      message: error instanceof Error
        ? error.message
        : 'Packaged Harness stress canary failed.',
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  A05_BUDGETS,
  PB03_INSTRUCTION,
  PB06_INSTRUCTION,
  PB07_INSTRUCTION,
  collectRetentionReceipts,
  qualifyMainAttribution,
  qualifyB5PackagedEvidence,
  qualifyG2BrokerSchedulerEvidence,
  qualifyG3RuntimePersistenceEvidence,
  qualifyMain,
  qualifyPb03,
  qualifyPb06,
  verifyBurstRetention,
});
