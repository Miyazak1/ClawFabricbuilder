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

const UUID = '12345678-1234-4234-8234-123456789abc';
const SOURCE_ROOT_ENV = 'BUILDER_HARNESS_RUNTIME_ROOT';
const CONFIG_PATH_ENV = 'BUILDER_HARNESS_CONFIG_PATH';
const OBSERVED_VERSION_PATTERN = /Observed version:\s*(sha256:[0-9a-f]{64})/gu;
const DEFAULT_MODE = 'coding_loop';
const COMPACTION_MODE = 'compaction';
const COMPACTION_PRIVATE_MARKER = 'HARNESS_COMPACTION_PRIVATE_CANARY_MARKER';
const COMPACTION_REQUEST_MARKER = 'You are now acting as a compaction engine';
const COMPACTION_INPUT_BYTES = 8_000;

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
  fail('unsupported canary mode');
}

function harnessConfigPath(mode) {
  const configured = process.env[CONFIG_PATH_ENV];
  const candidate = typeof configured === 'string' && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(
      __dirname,
      mode === COMPACTION_MODE
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

function scriptedEvents(requestIndex, body, mode) {
  if (requestIndex === 0) {
    return toolEvents(
      'read-initial',
      'read',
      { file_path: 'index.js' },
      mode === COMPACTION_MODE ? 17_000 : 32,
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
          if (mode !== COMPACTION_MODE) fail('unexpected compaction provider request');
          events = textEvents(COMPACTION_PRIVATE_MARKER, 1_000, 64);
          compactionRequests.push(body);
          kind = 'compaction';
        } else {
          events = scriptedEvents(normalRequests.length, body, mode);
          normalRequests.push(body);
          kind = 'normal';
        }
        requests.push(Object.freeze({ body, kind }));
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
    close: () => new Promise((resolve) => server.close(resolve)),
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
      text: mode === COMPACTION_MODE ? compactionInput() : 'Update index.js so ready is true.',
    },
  });
}

function compactionLifecycleEvidence(rawNotifications) {
  const events = rawNotifications.flatMap((notification) => (
    notification?.method === 'session.event'
      && notification.params?.event !== null
      && typeof notification.params?.event === 'object'
      && !Array.isArray(notification.params.event)
      ? [notification.params.event]
      : []
  ));
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

async function main(mode = parseCanaryMode()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-harness-loop-'));
  const executionRoot = path.join(root, 'execution');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(executionRoot);
  const provider = await createLocalProvider(mode);
  const rawNotifications = [];
  const composition = createBuilderHarnessRuntimeComposition({
    runtime_root: runtimeRoot(),
    config_path: harnessConfigPath(mode),
    execution_root: executionRoot,
    session_root: sessionRoot,
    clock: Date.now,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
    process_adapter: createBuilderHarnessProcessAdapter({
      spawn_process: childProcess.spawn,
      platform: process.platform,
      windows_root: process.platform === 'win32' ? path.resolve(process.env.SystemRoot) : null,
    }),
    create_broker: createBuilderHarnessToolBrokerServer,
    create_host(options) {
      return createBuilderHarnessProcessHost({
        ...options,
        async on_notification(notification) {
          rawNotifications.push(notification);
          return await options.on_notification(notification);
        },
      });
    },
  });
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
  } finally {
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
    process.stderr.write(`${error instanceof Error ? error.message : 'Harness coding loop failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  COMPACTION_INPUT_BYTES,
  COMPACTION_MODE,
  COMPACTION_PRIVATE_MARKER,
  DEFAULT_MODE,
  compactionInput,
  compactionLifecycleEvidence,
  isCompactionRequest,
  main,
  parseCanaryMode,
});
