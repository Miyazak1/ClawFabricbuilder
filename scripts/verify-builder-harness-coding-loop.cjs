'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  createBuilderHarnessRuntimeComposition,
} = require('../electron/builder-harness-runtime-composition.cjs');
const {
  createBuilderHarnessProcessAdapter,
} = require('../electron/builder-harness-process-adapter.cjs');
const {
  createBuilderHarnessProcessHost,
} = require('../electron/builder-harness-process-host.cjs');
const {
  createBuilderHarnessToolBrokerServer,
} = require('../electron/builder-harness-tool-broker-server.cjs');
const {
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('../electron/builder-programming-runtime-events.cjs');
const {
  createBuilderProgrammingRuntimeMainFactRecorder,
} = require('../electron/builder-programming-runtime-main-fact-recorder.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  projectBuilderContextUsage,
} = require('../electron/builder-context-usage-projection.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}:${UUID}`;
const SOURCE_ROOT_ENV = 'BUILDER_HARNESS_RUNTIME_ROOT';
const CONFIG_PATH_ENV = 'BUILDER_HARNESS_CONFIG_PATH';
const OBSERVED_VERSION_PATTERN = /Observed version:\s*(sha256:[0-9a-f]{64})/gu;
const DEFAULT_MODE = 'coding_loop';
const COMPACTION_MODE = 'compaction';
const MANUAL_COMPACTION_MODE = 'manual_compaction';
const RESUME_MODE = 'resume';
const RESUME_UNKNOWN_MODE = 'resume_unknown';
const COMPACTION_PRIVATE_MARKER = 'HARNESS_COMPACTION_PRIVATE_CANARY_MARKER';
const COMPACTION_REQUEST_MARKER = 'You are now acting as a compaction engine';
const COMPACTION_INPUT_BYTES = 8_000;
const MANUAL_COMPACTION_SOURCE_COMMAND_ID =
  `builder-context-compaction-admission:${'c'.repeat(64)}`;
const MANUAL_COMPACTION_CLOSED_SOURCE_COMMAND_ID =
  `builder-context-compaction-admission:${'e'.repeat(64)}`;

function fail(message) {
  throw new Error(`verify-builder-harness-coding-loop: ${message}`);
}

function runtimeRoot() {
  const value = process.env[SOURCE_ROOT_ENV];
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail(`set ${SOURCE_ROOT_ENV} to a prepared Harness runtime closure or source checkout`);
  }
  const root = path.resolve(value);
  const info = fs.statSync(root);
  if (!info.isDirectory() && !(info.isFile() && path.extname(root).toLowerCase() === '.asar')) {
    fail('runtime root is not a directory or ASAR');
  }
  return root;
}

function parseCanaryMode(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    fail('canary arguments are invalid');
  }
  if (argv.length === 0) return DEFAULT_MODE;
  if (argv.length === 1 && argv[0] === '--compaction') return COMPACTION_MODE;
  if (argv.length === 1 && argv[0] === '--manual-compaction') return MANUAL_COMPACTION_MODE;
  if (argv.length === 1 && argv[0] === '--resume') return RESUME_MODE;
  if (argv.length === 1 && argv[0] === '--resume-unknown') return RESUME_UNKNOWN_MODE;
  fail('unsupported canary mode');
}

function usesCompactionCanaryConfig(mode) {
  return mode === COMPACTION_MODE || mode === MANUAL_COMPACTION_MODE;
}

function harnessConfigPath(mode) {
  const configured = process.env[CONFIG_PATH_ENV];
  const candidate = typeof configured === 'string' && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(
      __dirname,
      usesCompactionCanaryConfig(mode)
        ? '../electron/harness/builder-coding-loop-compaction-canary.cordis.yml'
        : '../electron/harness/builder-coding-loop.cordis.yml',
    );
  if (
    candidate.includes('\0')
    || !path.isAbsolute(candidate)
    || path.normalize(candidate) !== candidate
    || !fs.statSync(candidate).isFile()
  ) fail('Harness config is unavailable');
  return candidate;
}

function toolEvents(callId, name, args, promptTokens = 32) {
  return [
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] }),
    JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: callId,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          }],
        },
      }],
    }),
    JSON.stringify({
      choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: 8 },
    }),
    '[DONE]',
  ];
}

function textEvents(content, promptTokens = 32, completionTokens = 8) {
  return [
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] }),
    JSON.stringify({ choices: [{ delta: { content } }] }),
    JSON.stringify({
      choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    }),
    '[DONE]',
  ];
}

function latestObservedVersion(body) {
  const matches = [...JSON.stringify(body).matchAll(OBSERVED_VERSION_PATTERN)];
  return matches.length === 0 ? null : matches[matches.length - 1][1];
}

function isCompactionRequest(body) {
  return body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && JSON.stringify(body).includes(COMPACTION_REQUEST_MARKER);
}

function compactionInput() {
  const instruction = 'Update index.js so ready is true. Preserve this bounded context before editing.\n';
  return `${instruction}${'x'.repeat(COMPACTION_INPUT_BYTES - Buffer.byteLength(instruction, 'utf8'))}`;
}

function initialPromptTokensForMode(mode) {
  if (mode === COMPACTION_MODE) return 17_000;
  if (mode === MANUAL_COMPACTION_MODE) return 10_000;
  return 32;
}

function scriptedEvents(requestIndex, body, mode) {
  if (mode === RESUME_UNKNOWN_MODE && requestIndex >= 2) {
    if (requestIndex === 2) {
      const history = JSON.stringify(body);
      if (!history.includes('edit-initial') || !history.includes('TOOL_OUTCOME_UNKNOWN')) {
        fail('native recovery did not preserve the unresolved tool outcome');
      }
      return toolEvents('read-resumed', 'read', { file_path: 'index.js' });
    }
    if (requestIndex === 3) {
      const lastTool = body.messages.filter(message => message.role === 'tool').at(-1);
      if (!JSON.stringify(lastTool).includes('export const ready = true;')) fail('unknown edit was lost');
      return textEvents('The interrupted edit took effect. Verified the file instead of repeating it.');
    }
    fail('unknown-outcome recovery attempted additional work');
  }
  if (mode === RESUME_MODE && requestIndex >= 2) {
    if (requestIndex === 2) return null;
    if (requestIndex === 3) {
      const history = JSON.stringify(body);
      if (!history.includes('edit-initial') || !history.includes('export const ready = true;')) {
        fail('native resume lost the original tool history');
      }
      return toolEvents('read-resumed', 'read', { file_path: 'index.js' });
    }
    if (requestIndex === 4) {
      const lastTool = body.messages.filter(message => message.role === 'tool').at(-1);
      if (!JSON.stringify(lastTool).includes('export const ready = true;')) fail('edited workspace was not restored');
      return textEvents('The retained edit is verified. No repeated write is needed.');
    }
    fail('resume attempted unexpected additional work');
  }
  if (requestIndex === 0) {
    return toolEvents(
      'read-initial',
      'read',
      { file_path: 'index.js' },
      initialPromptTokensForMode(mode),
    );
  }
  if (requestIndex === 1) {
    const observedVersion = latestObservedVersion(body);
    if (observedVersion === null) fail('initial read result was not returned to the model');
    return toolEvents('edit-initial', 'edit', {
      file_path: 'index.js',
      observed_version: observedVersion,
      content: 'export const ready = true;\n',
    });
  }
  if (requestIndex === 2) {
    return textEvents('Updated index.js and left it ready for Builder checks.');
  }
  if (requestIndex === 3) {
    return toolEvents('read-repair', 'read', { file_path: 'index.js' });
  }
  if (requestIndex === 4) {
    const observedVersion = latestObservedVersion(body);
    if (observedVersion === null) fail('repair read result was not returned to the model');
    return toolEvents('edit-repair', 'edit', {
      file_path: 'index.js',
      observed_version: observedVersion,
      content: 'export const ready = "repaired";\n',
    });
  }
  if (requestIndex === 5) {
    return textEvents('Repaired index.js after the failed Builder check.');
  }
  fail('local provider received an unexpected request');
}

async function createLocalProvider(mode) {
  const requests = [];
  const normalRequests = [];
  const compactionRequests = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try {
        if (request.method !== 'POST' || request.url !== '/chat/completions') {
          response.writeHead(404).end();
          return;
        }
        const body = JSON.parse(raw);
        let events;
        let kind;
        if (isCompactionRequest(body)) {
          if (!usesCompactionCanaryConfig(mode)) fail('unexpected compaction provider request');
          events = textEvents(COMPACTION_PRIVATE_MARKER, 1_000, 64);
          compactionRequests.push(body);
          kind = 'compaction';
        } else {
          events = scriptedEvents(normalRequests.length, body, mode);
          normalRequests.push(body);
          kind = 'normal';
        }
        requests.push(Object.freeze({ body, kind }));
        if (events === null) return;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of events) response.write(`data: ${event}\n\n`);
        response.end();
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }));
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') fail('local provider did not bind');
  return Object.freeze({
    base_url: `http://127.0.0.1:${address.port}`,
    compaction_requests: compactionRequests,
    normal_requests: normalRequests,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  });
}

function runContract(composition, sourceTree, providerConfig, mode) {
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: composition.descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: providerConfig.config_digest,
      allowed_tools: ['read', 'search', 'edit', 'write', 'question'],
      limits: {
        max_steps: 16,
        max_duration_ms: 60_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: Date.now(),
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: usesCompactionCanaryConfig(mode) ? compactionInput() : 'Update index.js so ready is true.',
    },
  });
}

function harnessSessionIdForRunId(runId) {
  return `builder-harness-${runId.slice('builder-run:'.length)}`;
}

function sessionEvents(rawNotifications) {
  return rawNotifications.flatMap((notification) => (
    notification?.method === 'session.event'
      && notification.params?.event !== null
      && typeof notification.params?.event === 'object'
      && !Array.isArray(notification.params.event)
      ? [notification.params.event]
      : []
  ));
}

async function waitForNativeSessionStatus(rawNotifications, sessionId, status) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const matched = rawNotifications.some((notification) => (
      notification?.method === 'session.status'
      && notification.params?.sessionId === sessionId
      && notification.params?.status === status
    ));
    if (matched) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

function compactionLifecycleEvidence(rawNotifications) {
  const events = sessionEvents(rawNotifications);
  const count = (type) => events.filter((event) => event.type === type).length;
  const replacements = events.filter((event) => (
    event.type === 'user/message'
    && event.surfaceOp?.op === 'replace'
  ));
  return Object.freeze({
    compaction_end_count: count('compaction/end'),
    compaction_start_count: count('compaction/start'),
    compaction_summary_count: count('compaction/summary'),
    replacement_count: replacements.length,
  });
}

function manualCompactionLifecycleEvidence(rawNotifications, sourceCommandId) {
  const events = sessionEvents(rawNotifications);
  const manualIds = new Set(events.flatMap((event) => (
    ['compaction/start', 'compaction/end'].includes(event.type)
      && (
        event.data?.sourceCommandId === sourceCommandId
        || JSON.stringify(event).includes(sourceCommandId)
        || event.data?.turn === null
      )
      && typeof event.data?.compactionId === 'string'
      ? [event.data.compactionId]
      : []
  )));
  const matching = events.filter((event) => (
    ['compaction/start', 'compaction/summary', 'compaction/end'].includes(event.type)
    && typeof event.data?.compactionId === 'string'
    && manualIds.has(event.data.compactionId)
  ));
  const count = (type) => matching.filter((event) => event.type === type).length;
  const starts = matching.filter((event) => event.type === 'compaction/start');
  const ends = matching.filter((event) => event.type === 'compaction/end');
  return Object.freeze({
    manual_compaction_start_count: count('compaction/start'),
    manual_compaction_summary_count: count('compaction/summary'),
    manual_compaction_end_count: count('compaction/end'),
    manual_compaction_turn_null_observed:
      starts.length === 1
      && ends.length === 1
      && starts[0].data?.turn === null
      && ends[0].data?.turn === null,
    manual_compaction_source_command_observed:
      JSON.stringify(matching).includes(sourceCommandId),
  });
}

function diagnosticNotificationSummary(rawNotifications) {
  return rawNotifications.slice(-40).flatMap((notification) => {
    if (notification?.method === 'session.status') {
      return [Object.freeze({
        method: 'session.status',
        session_id: notification.params?.sessionId ?? null,
        status: notification.params?.status ?? null,
      })];
    }
    if (notification?.method === 'session.context-usage') {
      return [Object.freeze({
        method: 'session.context-usage',
        session_id: notification.params?.sessionId ?? null,
        seq: notification.params?.projectionSeq ?? null,
        pressure_tokens: notification.params?.pressureTokens ?? null,
        projected_tokens: notification.params?.projectedTokens ?? null,
        context_window_tokens: notification.params?.contextWindowTokens ?? null,
      })];
    }
    const event = notification?.method === 'session.event' ? notification.params?.event : null;
    if (event === null || event === undefined) return [];
    return [Object.freeze({
      method: 'session.event',
      session_id: notification.params?.sessionId ?? null,
      type: event.type ?? null,
      seq: event.seq ?? null,
      turn: Number.isSafeInteger(event.data?.turn) ? event.data.turn : null,
      step: Number.isSafeInteger(event.data?.step) ? event.data.step : null,
      compaction_id: typeof event.data?.compactionId === 'string' ? event.data.compactionId : null,
      source_command_observed: typeof event.data?.sourceCommandId === 'string',
      surface_op: typeof event.data?.surfaceOp === 'string' ? event.data.surfaceOp : event.data?.surfaceOp?.op ?? null,
      error_observed: event.data?.error !== undefined,
    })];
  });
}

function diagnosticProcessSummary(processDiagnostics) {
  return processDiagnostics.slice(-30).flatMap((chunk) => String(chunk).split(/\r?\n/u).flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      const frame = JSON.parse(line);
      if (frame.method === 'session.event') {
        const event = frame.params?.event;
        return [Object.freeze({
          jsonrpc: true,
          method: 'session.event',
          type: event?.type ?? null,
          seq: event?.seq ?? null,
          turn: Number.isSafeInteger(event?.data?.turn) ? event.data.turn : null,
          step: Number.isSafeInteger(event?.data?.step) ? event.data.step : null,
          compaction_id: typeof event?.data?.compactionId === 'string' ? event.data.compactionId : null,
          source_command_observed: typeof event?.data?.sourceCommandId === 'string',
          error_observed: event?.data?.error !== undefined,
        })];
      }
      if (frame.method === 'session.status') {
        return [Object.freeze({
          jsonrpc: true,
          method: 'session.status',
          status: frame.params?.status ?? null,
        })];
      }
      if (frame.method === 'session.context-usage') {
        return [Object.freeze({
          jsonrpc: true,
          method: 'session.context-usage',
          seq: frame.params?.projectionSeq ?? null,
          pressure_tokens: frame.params?.pressureTokens ?? null,
          projected_tokens: frame.params?.projectedTokens ?? null,
        })];
      }
      if (Number.isSafeInteger(frame.id)) {
        return [Object.freeze({
          jsonrpc: true,
          id: frame.id,
          has_result: Object.hasOwn(frame, 'result'),
          has_error: Object.hasOwn(frame, 'error'),
          error_code: frame.error?.code ?? null,
          error_message: typeof frame.error?.message === 'string' ? frame.error.message.slice(0, 160) : null,
        })];
      }
    } catch {
      return [Object.freeze({ raw: line.slice(0, 240) })];
    }
    return [];
  }));
}

async function nativeManualCompactionEvidence(composition, contract, provider, rawNotifications) {
  const beforeCompactionRequests = provider.compaction_requests.length;
  if (beforeCompactionRequests !== 0) fail('automatic compaction ran before the manual canary command');
  const sessionId = harnessSessionIdForRunId(contract.admission.run_id);
  if (!(await waitForNativeSessionStatus(rawNotifications, sessionId, 'idle'))) {
    fail('manual compact canary never observed the native session become idle');
  }
  const completed = await composition.manual_compact({
    session_id: sessionId,
    source_command_id: MANUAL_COMPACTION_SOURCE_COMMAND_ID,
    abort_signal: null,
  });
  if (completed === null) fail('manual compact unexpectedly returned no-op before the native completed gate');
  if (
    completed.sourceCommandId !== MANUAL_COMPACTION_SOURCE_COMMAND_ID
    || !(completed.startSeq < completed.summarySeq && completed.summarySeq < completed.endSeq)
    || completed.shadowedTokenCount <= 0
  ) fail(`manual compact result was malformed: ${JSON.stringify(completed)}`);
  if (provider.compaction_requests.length !== beforeCompactionRequests + 1) {
    fail('manual compact did not dispatch exactly one Harness-owned compaction request');
  }
  return Object.freeze({
    manual_compaction_session_id: sessionId,
    manual_compaction_completed: true,
    manual_compaction_source_command_echoed: true,
    manual_compaction_shadowed_token_count: completed.shadowedTokenCount,
    manual_compaction_start_seq: completed.startSeq,
    manual_compaction_summary_seq: completed.summarySeq,
    manual_compaction_end_seq: completed.endSeq,
    ...manualCompactionLifecycleEvidence(rawNotifications, MANUAL_COMPACTION_SOURCE_COMMAND_ID),
  });
}

async function manualCompactionClosedFailureEvidence(composition, contract) {
  try {
    await composition.manual_compact({
      session_id: harnessSessionIdForRunId(contract.admission.run_id),
      source_command_id: MANUAL_COMPACTION_CLOSED_SOURCE_COMMAND_ID,
      abort_signal: null,
    });
  } catch (error) {
    return Object.freeze({
      manual_compaction_closed_failure_observed: true,
      manual_compaction_closed_failure_code: error?.code ?? 'unknown',
    });
  }
  fail('manual compact unexpectedly succeeded after reconciliation closed the native session');
}

function contextUsageLifecycleEvidence(runtimeEvents) {
  const conversationEvents = runtimeEvents.map((runtimeEvent) => (
    runtimeEvent?.event_type === 'context_compaction_recorded'
      ? runtimeEvent
      : {
        event_type: 'programming_runtime_event_recorded',
        payload: { runtime_event: runtimeEvent },
      }
  ));
  const isActivity = (event, activityKind) => (
    event?.event_type === 'runtime_activity_status'
    && event.payload?.activity_kind === activityKind
  );
  const compactingIndex = runtimeEvents.findIndex(
    (event) => isActivity(event, 'context_compacting'),
  );
  const compactedIndex = runtimeEvents.findIndex(
    (event) => isActivity(event, 'context_compacted'),
  );
  if (
    compactingIndex < 0
    || compactedIndex <= compactingIndex
  ) fail('canonical context usage lifecycle was incomplete');
  const projectAt = (index) => projectBuilderContextUsage({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    events: conversationEvents.slice(0, index + 1),
  });
  const before = runtimeEvents.slice(0, compactingIndex).reduce((match, event, index) => {
    if (event?.event_type !== 'context_usage_projected') return match;
    const projected = projectAt(index);
    if (
      projected === null
      || projected.measurement_state !== 'ready'
      || projected.usage_percent === null
    ) return match;
    return match === null || projected.usage_percent > match.usage_percent ? projected : match;
  }, null);
  const compacting = projectAt(compactingIndex);
  const compacted = projectAt(compactedIndex);
  const after = runtimeEvents.slice(compactedIndex + 1).reduce((match, event, offset) => {
    if (match !== null || event?.event_type !== 'context_usage_projected') return match;
    const projected = projectAt(compactedIndex + 1 + offset);
    return projected !== null
      && projected.compaction_state === 'compacted'
      && projected.measurement_state === 'ready'
      && before !== null
      && before.usage_percent !== null
      && projected.usage_percent !== null
      && projected.usage_percent < before.usage_percent
      ? projected
      : null;
  }, null);
  if (
    before === null
    || compacting === null
    || compacted === null
    || after === null
    || before.measurement_state !== 'ready'
    || compacting.compaction_state !== 'compacting'
    || compacted.compaction_state !== 'compacted'
    || compacted.measurement_state !== 'awaiting_post_compaction_projection'
    || after.compaction_state !== 'compacted'
    || after.measurement_state !== 'ready'
    || before.context_window_tokens === null
    || after.context_window_tokens !== before.context_window_tokens
    || before.usage_percent === null
    || after.usage_percent === null
    || after.usage_percent >= before.usage_percent
  ) fail('Main-owned context usage projection did not recover after compaction');
  return Object.freeze({
    context_window_tokens: before.context_window_tokens,
    usage_before_compaction_percent: before.usage_percent,
    compacting_state_observed: true,
    post_compaction_usage_refresh_observed: true,
    usage_after_compaction_percent: after.usage_percent,
    usage_drop_observed: true,
  });
}

async function main(mode = parseCanaryMode()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-harness-loop-'));
  const executionRoot = path.join(root, 'execution');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(executionRoot);
  const provider = await createLocalProvider(mode);
  const rawNotifications = [];
  const processDiagnostics = [];
  let editAwaitingReceipt = false;
  let releaseEditReceipt;
  const compositionOptions = {
    runtime_root: runtimeRoot(),
    config_path: harnessConfigPath(mode),
    execution_root: executionRoot,
    session_root: sessionRoot,
    clock: Date.now,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
    process_adapter: createBuilderHarnessProcessAdapter({
      spawn_process(...args) {
        const child = childProcess.spawn(...args);
        for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => {
          processDiagnostics.push(String(data));
          if (processDiagnostics.length > 80) processDiagnostics.shift();
        });
        return child;
      },
      platform: process.platform,
      windows_root: process.platform === 'win32' ? path.resolve(process.env.SystemRoot) : null,
    }),
    create_broker(options) {
      if (mode !== RESUME_UNKNOWN_MODE) return createBuilderHarnessToolBrokerServer(options);
      const workspace = options.workspace_tools;
      return createBuilderHarnessToolBrokerServer({ ...options, workspace_tools: { ...workspace,
        async edit(request) {
          const result = await workspace.edit(request);
          editAwaitingReceipt = true;
          await new Promise(resolve => { releaseEditReceipt = resolve; });
          return result;
        },
      } });
    },
    create_host(options) {
      return createBuilderHarnessProcessHost({
        ...options,
        async on_notification(notification) {
          rawNotifications.push(notification);
          return await options.on_notification(notification);
        },
      });
    },
  };
  let composition = createBuilderHarnessRuntimeComposition(compositionOptions);
  try {
    const sourceTree = createBuilderProjectSourceTree({
      files: [{ path: 'index.js', content: 'export const ready = false;\n' }],
    });
    const providerConfig = createBuilderProviderConfig({
      base_url: provider.base_url,
      model: 'deepseek-v4-flash',
      timeout_ms: 30_000,
      temperature: null,
      max_tokens: 4_096,
      secret_ref: {
        ref_version: 'builder-provider-secret-ref.v1',
        provider_id: 'builder-default',
        secret_id: 'builder-provider-secret:default',
      },
    });
    const contract = runContract(composition, sourceTree, providerConfig, mode);
    const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
    const handle = await composition.startRun({
      run_contract: contract,
      source_tree: sourceTree,
      provider_config: providerConfig,
      credential: 'local-harness-canary-credential',
      event_sink: { emit: (event) => journal.append(event, Date.now()) },
    });
    if ([RESUME_MODE, RESUME_UNKNOWN_MODE].includes(mode)) {
      const unknown = mode === RESUME_UNKNOWN_MODE;
      const deadline = Date.now() + 25_000;
      while (!(unknown ? editAwaitingReceipt : provider.requests.length === 3) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!(unknown ? editAwaitingReceipt : provider.requests.length === 3)) fail('first process did not reach the pause checkpoint');
      await composition.cancelRun(handle, 'shutdown');
      await handle.completion;
      releaseEditReceipt?.();
      await composition.dispose();
      composition = createBuilderHarnessRuntimeComposition(compositionOptions);
      const resumeRequest = { project_id: contract.admission.project_id,
        conversation_id: contract.admission.conversation_id, run_id: contract.admission.run_id,
        session_run_id: contract.admission.run_id, current_source_tree: sourceTree };
      await require('node:assert/strict').rejects(composition.prepareResume({ ...resumeRequest,
        current_source_tree: createBuilderProjectSourceTree({ files: [{ path: 'index.js', content: 'external edit' }] }) }));
      const retained = await composition.prepareResume(resumeRequest);
      const resumedContract = createBuilderProgrammingRuntimeRunContract({
        runtime_descriptor: composition.descriptor,
        admission: { ...contract.admission, run_id: `builder-run:${UUID.slice(0, -1)}d`,
          workspace_ref: { ...contract.admission.workspace_ref, source_tree_digest: retained.source_tree_digest } },
        input: {
          ...contract.input,
          resume_session_run_id: contract.admission.run_id,
          resume_kind: 'interrupted_recovery',
        },
      });
      const resumedJournal = createBuilderProgrammingRuntimeEventJournal({ run_contract: resumedContract });
      const resumedHandle = await composition.startRun({ run_contract: resumedContract, source_tree: retained,
        provider_config: providerConfig, credential: 'local-harness-canary-credential',
        event_sink: { emit: event => resumedJournal.append(event, Date.now()) } });
      const result = await resumedHandle.completion;
      if (result.status !== 'awaiting_reconciliation') fail(`native resume failed: ${JSON.stringify(result)}; events=${JSON.stringify(resumedJournal.snapshot())}`);
      await composition.reconcileRun(resumedHandle, { checkpoint_status: 'updated' });
      const repeatedWrites = resumedJournal.snapshot().events.filter(event => event.event_type === 'tool_call_started'
        && ['edit', 'write'].includes(event.payload.tool_kind));
      if (repeatedWrites.length !== 0 || provider.requests.length !== (unknown ? 4 : 5)) fail('resumption repeated completed work');
      process.stdout.write(`${JSON.stringify({ result_version: 'builder-harness-native-resume-canary.v1',
        provider_scope: 'loopback_deterministic', cold_process_restart: true, native_tool_history_restored: true,
        edited_workspace_restored: true, external_edit_rejected: true, resumed_write_count: repeatedWrites.length,
        unknown_tool_outcome_verified: unknown,
        provider_request_count: provider.requests.length, terminal_status: resumedJournal.snapshot().status,
      }, null, 2)}\n`);
      return;
    }
    const first = await handle.completion;
    if (
      first.status !== 'awaiting_reconciliation'
      || first.resulting_source_tree.files[0].content !== 'export const ready = true;\n'
    ) fail(`initial tool-driven edit did not complete: ${JSON.stringify({
      status: first.status,
      content: first.resulting_source_tree?.files?.[0]?.content ?? null,
      provider_request_count: provider.requests.length,
      event_types: journal.snapshot().events.map((event) => event.event_type),
      terminal_event: journal.snapshot().events.at(-1),
      runtime_notifications: rawNotifications.slice(0, 12),
    })}`);

    const manualCompactionEvidence = mode === MANUAL_COMPACTION_MODE
      ? await nativeManualCompactionEvidence(composition, contract, provider, rawNotifications)
      : null;

    const recorder = createBuilderProgrammingRuntimeMainFactRecorder({
      run_contract: contract,
      append_main_fact: (event) => journal.appendMainFact(event, Date.now()),
      clock: Date.now,
    });
    await recorder.record_check({
      verification_step_id: first.verification_step_id,
      command_display: 'npm test',
      status: 'failed',
      duration_ms: 480,
      summary: 'The local canary check failed.',
    });
    const repaired = await composition.repairRun(handle, {
      failure_summary: 'The local canary check failed. Make ready a repaired string.',
    });
    if (
      repaired.status !== 'awaiting_reconciliation'
      || repaired.resulting_source_tree.files[0].content !== 'export const ready = "repaired";\n'
    ) fail('failed-check repair did not complete');
    await recorder.record_check({
      verification_step_id: repaired.verification_step_id,
      command_display: 'npm test',
      status: 'passed',
      duration_ms: 260,
      summary: 'The local canary check passed after repair.',
    });
    await composition.reconcileRun(handle, { checkpoint_status: 'updated' });
    const snapshot = journal.snapshot();
    const manualCompactionClosedFailure = mode === MANUAL_COMPACTION_MODE
      ? await manualCompactionClosedFailureEvidence(composition, contract)
      : null;
    const eventTypes = snapshot.events.map((event) => event.event_type);
    for (const required of [
      'tool_call_started',
      'tool_call_completed',
      'assistant_text_delta',
      'check_result_recorded',
      'run_completed',
    ]) {
      if (!eventTypes.includes(required)) fail(`canonical event missing: ${required}`);
    }
    const editToolFacts = snapshot.events.filter((event) => (
      event.event_type === 'tool_call_started'
      && event.payload.tool_kind === 'edit'
      && event.payload.target_label === 'index.js'
    ));
    if (editToolFacts.length !== 2) fail('canonical edit tool facts did not cover initial and repair turns');
    if (provider.normal_requests.length !== 6) {
      fail('local provider normal request count did not match the two-turn loop');
    }
    if (mode === COMPACTION_MODE) {
      const lifecycle = compactionLifecycleEvidence(rawNotifications);
      const contextUsageLifecycle = contextUsageLifecycleEvidence(snapshot.events);
      const lifecycleDiagnostics = rawNotifications.flatMap((notification) => {
        const event = notification?.method === 'session.event' ? notification.params?.event : null;
        if (![
          'assistant/message',
          'compaction/start',
          'compaction/summary',
          'compaction/end',
          'request/context',
        ].includes(event?.type)) return [];
        return [Object.freeze({
          type: event.type,
          turn: Number.isSafeInteger(event.data?.turn) ? event.data.turn : null,
          context_window: Number.isSafeInteger(event.data?.contextWindow)
            ? event.data.contextWindow
            : null,
          input_tokens: Number.isSafeInteger(event.data?.usage?.inputTokens)
            ? event.data.usage.inputTokens
            : null,
          output_tokens: Number.isSafeInteger(event.data?.usage?.outputTokens)
            ? event.data.usage.outputTokens
            : null,
          shadowed_token_count: Number.isSafeInteger(event.data?.shadowedTokenCount)
            ? event.data.shadowedTokenCount
            : null,
          failed: event.data?.error !== undefined,
        })];
      });
      const compactionIndex = provider.requests.findIndex((request) => request.kind === 'compaction');
      const continuedAfterCompaction = compactionIndex >= 0
        && provider.requests.slice(compactionIndex + 1).some((request) => request.kind === 'normal');
      const assistantDeltaCount = snapshot.events.filter(
        (event) => event.event_type === 'assistant_text_delta',
      ).length;
      if (
        provider.compaction_requests.length !== 1
        || lifecycle.compaction_start_count !== 1
        || lifecycle.compaction_summary_count !== 1
        || lifecycle.compaction_end_count !== 1
        || lifecycle.replacement_count !== 1
        || !continuedAfterCompaction
      ) fail(`Harness compaction lifecycle was incomplete: ${JSON.stringify({
        lifecycle,
        lifecycle_diagnostics: lifecycleDiagnostics,
        provider_request_kinds: provider.requests.map((request) => request.kind),
      })}`);
      if (assistantDeltaCount !== 2) fail('compaction created duplicate public assistant output');
      if (JSON.stringify(snapshot).includes(COMPACTION_PRIVATE_MARKER)) {
        fail('private Harness compaction summary reached the canonical journal');
      }
      process.stdout.write(`${JSON.stringify({
        result_version: 'builder-harness-compaction-canary.v1',
        runtime_kind: composition.descriptor.runtime_kind,
        provider_scope: 'loopback_deterministic',
        provider_request_count: provider.requests.length,
        provider_normal_request_count: provider.normal_requests.length,
        provider_compaction_request_count: provider.compaction_requests.length,
        ...lifecycle,
        ...contextUsageLifecycle,
        continuation_request_observed: continuedAfterCompaction,
        canonical_assistant_delta_count: assistantDeltaCount,
        canonical_edit_tool_fact_count: editToolFacts.length,
        canonical_event_count: snapshot.events.length,
        private_summary_hidden: true,
        terminal_status: snapshot.status,
        external_network_required: false,
      }, null, 2)}\n`);
      return;
    }
    if (mode === MANUAL_COMPACTION_MODE) {
      const lifecycle = compactionLifecycleEvidence(rawNotifications);
      const contextUsageLifecycle = contextUsageLifecycleEvidence(snapshot.events);
      const compactionIndex = provider.requests.findIndex((request) => request.kind === 'compaction');
      const continuedAfterCompaction = compactionIndex >= 0
        && provider.requests.slice(compactionIndex + 1).some((request) => request.kind === 'normal');
      const assistantDeltaCount = snapshot.events.filter(
        (event) => event.event_type === 'assistant_text_delta',
      ).length;
      if (
        manualCompactionEvidence === null
        || manualCompactionClosedFailure === null
        || provider.compaction_requests.length !== 1
        || lifecycle.compaction_start_count !== 1
        || lifecycle.compaction_summary_count !== 1
        || lifecycle.compaction_end_count !== 1
        || lifecycle.replacement_count !== 1
        || !continuedAfterCompaction
        || manualCompactionEvidence.manual_compaction_start_count !== 1
        || manualCompactionEvidence.manual_compaction_summary_count !== 1
        || manualCompactionEvidence.manual_compaction_end_count !== 1
        || !manualCompactionEvidence.manual_compaction_turn_null_observed
      ) fail(`Harness manual compaction lifecycle was incomplete: ${JSON.stringify({
        lifecycle,
        manual_compaction_evidence: manualCompactionEvidence,
        provider_request_kinds: provider.requests.map((request) => request.kind),
      })}`);
      if (assistantDeltaCount !== 2) fail('manual compaction created duplicate public assistant output');
      if (JSON.stringify(snapshot).includes(COMPACTION_PRIVATE_MARKER)) {
        fail('private manual Harness compaction summary reached the canonical journal');
      }
      process.stdout.write(`${JSON.stringify({
        result_version: 'builder-harness-manual-compaction-canary.v1',
        runtime_kind: composition.descriptor.runtime_kind,
        provider_scope: 'loopback_deterministic',
        provider_request_count: provider.requests.length,
        provider_normal_request_count: provider.normal_requests.length,
        provider_compaction_request_count: provider.compaction_requests.length,
        ...lifecycle,
        ...contextUsageLifecycle,
        ...manualCompactionEvidence,
        ...manualCompactionClosedFailure,
        continuation_request_observed: continuedAfterCompaction,
        canonical_assistant_delta_count: assistantDeltaCount,
        canonical_edit_tool_fact_count: editToolFacts.length,
        canonical_event_count: snapshot.events.length,
        private_summary_hidden: true,
        terminal_status: snapshot.status,
        external_network_required: false,
      }, null, 2)}\n`);
      return;
    }
    if (provider.requests.length !== 6) fail('local provider request count did not match the two-turn loop');
    process.stdout.write(`${JSON.stringify({
      result_version: 'builder-harness-coding-loop-canary.v1',
      runtime_kind: composition.descriptor.runtime_kind,
      provider_scope: 'loopback_deterministic',
      provider_request_count: provider.requests.length,
      initial_edit_observed: true,
      failed_check_recorded: true,
      repair_turn_observed: true,
      repaired_edit_observed: true,
      canonical_edit_tool_fact_count: editToolFacts.length,
      passed_check_recorded: true,
      canonical_event_count: snapshot.events.length,
      terminal_status: snapshot.status,
      external_network_required: false,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(JSON.stringify({
      code: error?.code,
      cause_code: error?.cause_code,
      requests: provider.requests.length,
      composition_diagnostics: typeof composition?.diagnostics === 'function'
        ? composition.diagnostics()
        : null,
      notification_summary: diagnosticNotificationSummary(rawNotifications),
      process_diagnostics: diagnosticProcessSummary(processDiagnostics),
    }) + '\n');
    throw error;
  } finally {
    releaseEditReceipt?.();
    await composition.dispose();
    await provider.close();
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}clawfabric-harness-loop-`;
    if (path.resolve(root).startsWith(expectedPrefix)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : 'Harness coding loop failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  COMPACTION_INPUT_BYTES,
  COMPACTION_MODE,
  COMPACTION_PRIVATE_MARKER,
  DEFAULT_MODE,
  MANUAL_COMPACTION_MODE,
  compactionInput,
  compactionLifecycleEvidence,
  contextUsageLifecycleEvidence,
  isCompactionRequest,
  manualCompactionLifecycleEvidence,
  main,
  parseCanaryMode,
});
