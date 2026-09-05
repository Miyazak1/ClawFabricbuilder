'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
  createBuilderHarnessProcessAdapter,
} = require('./builder-harness-process-adapter.cjs');
const {
  BUILDER_HARNESS_PROCESS_HOST_VERSION,
  createBuilderHarnessProcessHost,
} = require('./builder-harness-process-host.cjs');
const {
  BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
  createBuilderHarnessProgrammingRuntime,
} = require('./builder-harness-programming-runtime.cjs');
const {
  BUILDER_HARNESS_TOOL_BROKER_VERSION,
  createBuilderHarnessToolBrokerServer,
} = require('./builder-harness-tool-broker-server.cjs');
const {
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingWorkspaceTools,
} = require('./builder-programming-workspace-tools.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');
const {
  createBuilderRuntimeWorkspaceSnapshotStore,
} = require('./builder-runtime-workspace-snapshot-store.cjs');
const {
  BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS,
} = require('./builder-programming-runtime-supervision-policy.cjs');
const {
  BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION,
  createBuilderControlledCommandApprovalService,
} = require('./builder-controlled-command-approval-service.cjs');
const {
  BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION,
  createBuilderControlledCommandExecutor,
} = require('./builder-controlled-command-executor.cjs');
const {
  createBuilderCheckRunProcessAdapter,
} = require('./builder-check-run-process-adapter.cjs');
const {
  BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
  createBuilderCheckRuntimeRegistry,
} = require('./builder-check-runtime-identity.cjs');
const {
  createBuilderPackagedCheckRuntimeResolver,
} = require('./builder-packaged-check-runtime-resolver.cjs');
const {
  BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION,
} = require('./builder-agent-test-browser-runtime.cjs');
const {
  createBuilderAgentTestBrowserService,
} = require('./builder-agent-test-browser-service.cjs');

const BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION =
  'builder-harness-runtime-composition.v1';
const RUNTIME_WORKSPACE_SNAPSHOT_DIRECTORY = 'workspace-snapshots-v1';
const CONTROLLED_COMMAND_WORKSPACE_DIRECTORY = 'controlled-command-workspaces-v1';
const HARNESS_PACKAGED_RUNTIME_LAYOUTS = Object.freeze([
  Object.freeze({
    layout: 'deployed_closure',
    relative_path: 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  }),
  Object.freeze({
    layout: 'source_workspace_node_carrier',
    relative_path: 'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  }),
  Object.freeze({
    layout: 'package_root',
    relative_path: 'lib/packaged-bin.js',
  }),
]);
const OPTION_KEYS = Object.freeze([
  'runtime_root', 'config_path', 'execution_root', 'session_root',
  'clock', 'set_timeout', 'clear_timeout', 'process_adapter',
  'create_host', 'create_broker',
]);
const START_KEYS = Object.freeze([
  'run_contract', 'source_tree', 'provider_config', 'credential', 'event_sink',
]);
const REPAIR_KEYS = Object.freeze(['failure_summary']);
const HANDLE_KEYS = Object.freeze([
  'composition_version', 'runtime_version', 'runtime_kind', 'run_id', 'completion',
]);
const FILE_TOOL_BROKER_METHODS = Object.freeze(['read', 'search', 'edit', 'write', 'ask_user_question']);
const AGENT_TEST_BROWSER_BROKER_METHODS = Object.freeze([
  'browser_open_local_app', 'browser_observe', 'browser_click', 'browser_type',
  'browser_select_option', 'browser_press_key', 'browser_scroll',
  'browser_reload_latest_source', 'browser_close',
]);

class BuilderHarnessRuntimeCompositionError extends Error {
  constructor(code = 'builder_harness_runtime_composition_invalid') {
    const selected = [
      'builder_harness_runtime_composition_invalid',
      'builder_harness_runtime_composition_unavailable',
      'builder_harness_runtime_composition_conflict',
      'builder_harness_runtime_composition_closed',
    ].includes(code) ? code : 'builder_harness_runtime_composition_invalid';
    const messages = {
      builder_harness_runtime_composition_invalid: 'The Harness coding runtime request is invalid.',
      builder_harness_runtime_composition_unavailable: 'The Harness coding runtime is unavailable.',
      builder_harness_runtime_composition_conflict: 'The Harness coding runtime is already active.',
      builder_harness_runtime_composition_closed: 'The Harness coding runtime is closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessRuntimeCompositionError';
    this.code = selected;
    this.retryable = selected === 'builder_harness_runtime_composition_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderHarnessRuntimeCompositionError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys) {
  if (!isPlainObject(value)) fail();
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const actual = Reflect.ownKeys(value);
  if (
    requiredKeys.some((key) => !actual.includes(key))
    || actual.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function optionalValueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function requiredFunction(value, key) {
  const candidate = valueAt(value, key);
  if (typeof candidate !== 'function' || utilTypes.isProxy(candidate)) fail();
  return candidate;
}

function requiredMethod(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value.bind(value);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      if (!(nested instanceof Promise)) freezeDeep(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > 1_024
    || value.includes('\0') || !path.isAbsolute(value) || path.normalize(value) !== value
  ) fail();
  return value;
}

function existingPath(value, kind) {
  const candidate = safeAbsolutePath(value);
  let info;
  try { info = fs.statSync(candidate); } catch { fail('builder_harness_runtime_composition_unavailable'); }
  if ((kind === 'file' && !info.isFile()) || (kind === 'directory' && !info.isDirectory())) {
    fail('builder_harness_runtime_composition_unavailable');
  }
  return candidate;
}

function existingRuntimeRoot(value) {
  const candidate = safeAbsolutePath(value);
  let info;
  try { info = fs.statSync(candidate); } catch { fail('builder_harness_runtime_composition_unavailable'); }
  if (info.isDirectory()) return candidate;
  if (info.isFile() && path.extname(candidate).toLowerCase() === '.asar') return candidate;
  fail('builder_harness_runtime_composition_unavailable');
}

function resolveBuilderHarnessPackagedRuntime(rawRuntimeRoot) {
  const runtimeRoot = existingRuntimeRoot(rawRuntimeRoot);
  for (const candidate of HARNESS_PACKAGED_RUNTIME_LAYOUTS) {
    const packagedBin = path.resolve(runtimeRoot, candidate.relative_path);
    let info;
    try { info = fs.statSync(packagedBin); } catch { continue; }
    if (!info.isFile()) continue;
    return freezeDeep({
      artifact_version: 'builder-harness-packaged-runtime-artifact.v1',
      runtime_root: runtimeRoot,
      packaged_bin: packagedBin,
      layout: candidate.layout,
    });
  }
  fail('builder_harness_runtime_composition_unavailable');
}

function sessionDirectory(value) {
  const candidate = safeAbsolutePath(value);
  try { fs.mkdirSync(candidate, { recursive: true }); } catch {
    fail('builder_harness_runtime_composition_unavailable');
  }
  try {
    const info = fs.lstatSync(candidate);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail('builder_harness_runtime_composition_unavailable');
    }
    return path.resolve(fs.realpathSync.native(candidate));
  } catch (error) {
    if (error instanceof BuilderHarnessRuntimeCompositionError) throw error;
    fail('builder_harness_runtime_composition_unavailable');
  }
}

function safeCredential(value) {
  if (
    typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || value.length > 16 * 1_024 || Buffer.byteLength(value, 'utf8') > 16 * 1_024
    || Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  ) fail();
  return value;
}

function envValue(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 32 * 1_024) fail();
  return value;
}

function checkedProcessAdapter(value) {
  if (!isPlainObject(value) || value.adapter_version !== BUILDER_HARNESS_PROCESS_ADAPTER_VERSION) fail();
  requiredMethod(value, 'spawn_runtime');
  requiredMethod(value, 'terminate_process_tree');
  return value;
}

function checkedBroker(value) {
  if (!isPlainObject(value) || value.broker_version !== BUILDER_HARNESS_TOOL_BROKER_VERSION) fail();
  return Object.freeze({
    value,
    start: requiredMethod(value, 'start'),
    close: requiredMethod(value, 'close'),
    pending_user_question: requiredMethod(value, 'pending_user_question'),
    answer_user_question: requiredMethod(value, 'answer_user_question'),
  });
}

function checkedHost(value) {
  if (!isPlainObject(value) || value.host_version !== BUILDER_HARNESS_PROCESS_HOST_VERSION) fail();
  for (const method of ['start', 'prompt', 'when_terminated', 'shutdown', 'cancel', 'diagnostics']) {
    requiredMethod(value, method);
  }
  return value;
}

function checkedCommandRuntime(value) {
  if (!isPlainObject(value)) fail();
  const approvalService = value.approval_service;
  const executor = value.executor;
  if (
    !isPlainObject(approvalService)
    || approvalService.service_version !== BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION
    || !isPlainObject(executor)
    || executor.executor_version !== BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION
  ) fail();
  for (const method of ['request_approval', 'decide', 'pending_for_run', 'cancel_run']) {
    requiredMethod(approvalService, method);
  }
  for (const method of ['execute', 'cancel']) requiredMethod(executor, method);
  return Object.freeze({ approval_service: approvalService, executor });
}

function createBuilderHarnessRuntimeComposition(rawOptions) {
  const options = exactObjectWithOptional(rawOptions, OPTION_KEYS, [
    'supervision_policy', 'command_runtime', 'agent_test_browser_runtime',
  ]);
  const runtimeRoot = existingRuntimeRoot(valueAt(options, 'runtime_root'));
  const configPath = existingPath(valueAt(options, 'config_path'), 'file');
  const executionRoot = existingPath(valueAt(options, 'execution_root'), 'directory');
  const sessionRoot = sessionDirectory(valueAt(options, 'session_root'));
  const clock = requiredFunction(options, 'clock');
  const setTimer = requiredFunction(options, 'set_timeout');
  const clearTimer = requiredFunction(options, 'clear_timeout');
  const createHost = requiredFunction(options, 'create_host');
  const createBroker = requiredFunction(options, 'create_broker');
  const processAdapter = checkedProcessAdapter(valueAt(options, 'process_adapter'));
  const rawSupervisionPolicy = optionalValueAt(options, 'supervision_policy');
  const rawCommandRuntime = optionalValueAt(options, 'command_runtime');
  const commandRuntime = rawCommandRuntime === undefined ? null : checkedCommandRuntime(rawCommandRuntime);
  const rawBrowserRuntime = optionalValueAt(options, 'agent_test_browser_runtime');
  const agentTestBrowserRuntime = rawBrowserRuntime === undefined ? null : rawBrowserRuntime;
  if (
    agentTestBrowserRuntime !== null
    && (!isPlainObject(agentTestBrowserRuntime)
      || agentTestBrowserRuntime.runtime_version !== BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION)
  ) fail();
  const runtimeIdleTimeoutMs = rawSupervisionPolicy === undefined
    ? BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.runtime_idle_timeout_ms
    : (() => {
      const policy = exactObject(rawSupervisionPolicy, ['runtime_idle_timeout_ms']);
      const timeoutMs = valueAt(policy, 'runtime_idle_timeout_ms');
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60 * 60 * 1_000) fail();
      return timeoutMs;
    })();
  const runtimeArtifact = resolveBuilderHarnessPackagedRuntime(runtimeRoot);
  const packagedBin = runtimeArtifact.packaged_bin;
  const entries = new Map();
  const snapshotStore = createBuilderRuntimeWorkspaceSnapshotStore({
    root_directory: path.join(sessionRoot, RUNTIME_WORKSPACE_SNAPSHOT_DIRECTORY),
    now_ms: clock,
  });
  let disposed = false;

  function snapshotIdentity(runContract) {
    return {
      project_id: runContract.admission.project_id,
      conversation_id: runContract.admission.conversation_id,
      run_id: runContract.admission.run_id,
    };
  }

  async function recordWorkspaceSnapshot(runContract, sourceTree) {
    return snapshotStore.record_source_tree({
      ...snapshotIdentity(runContract),
      source_tree: sourceTree,
    });
  }

  function trackedWorkspaceTools(runContract, sourceTree) {
    const tools = createBuilderProgrammingWorkspaceTools({
      run_contract: runContract,
      source_tree: sourceTree,
    });
    return Object.freeze({
      service_version: tools.service_version,
      workspace_ref: tools.workspace_ref,
      read: tools.read,
      search: tools.search,
      async edit(request) {
        const result = await tools.edit(request);
        await recordWorkspaceSnapshot(runContract, await tools.snapshot());
        return result;
      },
      async write(request) {
        const result = await tools.write(request);
        await recordWorkspaceSnapshot(runContract, await tools.snapshot());
        return result;
      },
      snapshot: tools.snapshot,
      close: tools.close,
      authority: tools.authority,
    });
  }

  async function closeEntryBroker(entry, reason = 'completed') {
    if (entry.broker === null || entry.broker_closed) return;
    entry.broker_closed = true;
    try { await entry.broker.close(); } catch { /* process settlement remains authoritative */ }
    try { await entry.browser_service?.close({ reason }); } catch { /* browser cleanup is surfaced by runtime diagnostics */ }
  }

  const runtime = createBuilderHarnessProgrammingRuntime({
    async host_factory({ run_contract: runContract, session_id: sessionId, on_notification: onNotification }) {
      const entry = entries.get(runContract.admission.run_id);
      if (!entry || entry.session_id !== sessionId) fail('builder_harness_runtime_composition_conflict');
      const broker = checkedBroker(await Promise.resolve(Reflect.apply(createBroker, undefined, [{
        workspace_tools: entry.workspace_tools,
        ...(agentTestBrowserRuntime === null ? {} : {
          browser_service: (entry.browser_service = createBuilderAgentTestBrowserService({
            browser_runtime: agentTestBrowserRuntime,
            run_contract: runContract,
            workspace_tools: entry.workspace_tools,
            now_ms: clock,
          })),
        }),
        async on_user_question(questionRequest) {
          entry.pending_user_question = questionRequest;
          const requestId = questionRequest.request_id.slice('builder-user-question:'.length);
          await entry.event_sink.emit({
            protocol_version: 'builder-programming-runtime.v1',
            runtime_event_ref: `user-question.${requestId}.blocked`,
            run_id: runContract.admission.run_id,
            occurred_at_ms: Number(Reflect.apply(clock, undefined, [])),
            turn_id: runContract.admission.turn_id,
            step_id: null,
            tool_call_id: null,
            event_type: 'run_blocked',
            payload: {
              blocker_class: 'user_input_required',
              safe_message: questionRequest.questions[0].question,
            },
          });
        },
      }])));
      entry.broker = broker;
      const access = await broker.start();
      if (!isPlainObject(access) || typeof access.endpoint !== 'string' || typeof access.bearer_token !== 'string') {
        fail();
      }
      const allowedBrokerMethods = Object.freeze([
        ...FILE_TOOL_BROKER_METHODS,
        ...(agentTestBrowserRuntime === null ? [] : AGENT_TEST_BROWSER_BROKER_METHODS),
      ]);
      const allowedHarnessToolNames = Object.freeze([
        'read',
        'grep',
        'edit',
        'write',
        ...(agentTestBrowserRuntime === null ? [] : AGENT_TEST_BROWSER_BROKER_METHODS),
        'ask_user_question',
      ]);
      const environment = {
        PATH: envValue(process.env.PATH ?? path.dirname(process.execPath)),
        ELECTRON_RUN_AS_NODE: '1',
        BUILDER_TOOL_BROKER_URL: envValue(access.endpoint),
        BUILDER_TOOL_BROKER_TOKEN: envValue(access.bearer_token),
        BUILDER_TOOL_BROKER_ALLOWED_METHODS: JSON.stringify(allowedBrokerMethods),
        DEEPSEEK_API_KEY: entry.credential,
        DEEPSEEK_BASE_URL: entry.provider_config.base_url,
        DSH_CWD: executionRoot,
        DSH_SESSION_ROOT: sessionRoot,
        DSH_SYSTEM_PROMPT: [
          'You are the coding runtime inside ClawFabric Builder.',
          'Implement the current Builder request and summarize the result.',
          'For create-new-project, approved-plan, or empty-project requests, an empty or sparse source tree is a normal starting point. Do not stop because README, package.json, src, or an entry file is absent; use write to create the files required by the request.',
          'Use read or grep only when existing content is needed to avoid overwriting or to make a targeted edit. Repeated searches that only prove files are absent are not progress.',
          'Before each meaningful tool batch, give at most one short user-facing sentence about what you are about to do and why.',
          'After an important tool result, give at most one short user-facing sentence about what changed or what comes next.',
          'These are concise public progress updates, not private chain-of-thought or hidden reasoning.',
          'Match every user-facing natural-language response to the language of the original end-user change request for the run. If that request is written in Chinese or asks for Chinese, use Simplified Chinese for every public progress update and the final summary. Internal Builder tool results, check diagnostics, repair prompts, and compaction messages must not change the response language. Keep code, identifiers, project-relative paths, commands, and literal technical tokens unchanged.',
          'Do not publish self-talk, policy deliberation, internal constraint counting, or phrases such as "I need to", "Let me think", or "Actually".',
          'Never claim that a file changed or a command ran until the corresponding Builder tool result confirms it.',
          'Use project-relative paths in public progress updates.',
          `Use only the tools Builder exposes for this run: ${allowedHarnessToolNames.join(', ')}. Builder runs checks after the turn.`,
          'End a completed turn with one concise final summary in the end-user language. State what changed, mention only verification you actually observed, and never invent a passing check.',
          'When the inspected project files reveal a reliable entry point or run command, include one short instruction explaining how the user can open, run, or use the result. Do not guess when the project files do not establish it.',
        ].join(' '),
      };
      if (process.platform === 'win32') {
        environment.SystemRoot = envValue(process.env.SystemRoot ?? '');
      }
      const rawHost = checkedHost(await Promise.resolve(Reflect.apply(createHost, undefined, [{
        process_adapter: processAdapter,
        launch: {
          executable: path.resolve(process.execPath),
          args: [packagedBin, configPath],
          cwd: executionRoot,
          env: environment,
        },
        initialize: {
          cwd: executionRoot,
          provider: 'deepseek-official',
          model: entry.provider_config.model,
          max_tokens: entry.provider_config.max_tokens,
        },
        on_notification: onNotification,
        request_timeouts: {
          initialize_ms: BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.initialize_timeout_ms,
          session_prompt_ms: null,
          shutdown_ms: BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.shutdown_timeout_ms,
        },
        shutdown_grace_ms: BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.shutdown_grace_ms,
        eof_grace_ms: BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.eof_grace_ms,
        set_timeout: setTimer,
        clear_timeout: clearTimer,
      }])));
      const start = requiredMethod(rawHost, 'start');
      const prompt = requiredMethod(rawHost, 'prompt');
      const resume = (request) => requiredMethod(rawHost, 'resume')(request);
      const manualCompact = Reflect.ownKeys(rawHost).includes('manual_compact')
        ? (request) => requiredMethod(rawHost, 'manual_compact')(request)
        : null;
      const whenTerminated = requiredMethod(rawHost, 'when_terminated');
      const shutdown = requiredMethod(rawHost, 'shutdown');
      const cancel = requiredMethod(rawHost, 'cancel');
      const diagnostics = requiredMethod(rawHost, 'diagnostics');
      async function closeBroker(reason) {
        await closeEntryBroker(entry, reason);
      }
      return Object.freeze({
        host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
        start,
        prompt,
        recover_empty_output: (request) => requiredMethod(rawHost, 'recover_empty_output')(request),
        resume,
        ...(manualCompact === null ? {} : { manual_compact: manualCompact }),
        when_terminated: whenTerminated,
        async shutdown() { try { return await shutdown(); } finally { await closeBroker('completed'); } },
        async cancel() { try { return await cancel(); } finally { await closeBroker('cancelled'); } },
        diagnostics,
      });
    },
    workspace_resolver(workspaceRef) {
      return { root: executionRoot, source_tree_digest: workspaceRef.source_tree_digest };
    },
    clock,
    set_timeout: setTimer,
    clear_timeout: clearTimer,
    supervision_policy: {
      runtime_idle_timeout_ms: runtimeIdleTimeoutMs,
    },
  });

  function checkedHandle(rawHandle) {
    const handle = exactObject(rawHandle, HANDLE_KEYS);
    if (
      valueAt(handle, 'composition_version') !== BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION
      || valueAt(handle, 'runtime_version') !== BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION
      || valueAt(handle, 'runtime_kind') !== runtime.descriptor.runtime_kind
      || !(valueAt(handle, 'completion') instanceof Promise)
    ) fail();
    const entry = entries.get(valueAt(handle, 'run_id'));
    if (!entry) fail('builder_harness_runtime_composition_closed');
    return entry;
  }

  async function closeWorkspace(entry) {
    try {
      const sourceTree = await entry.workspace_tools.close();
      await recordWorkspaceSnapshot(entry.run_contract, sourceTree);
      return sourceTree;
    }
    catch { return null; }
  }

  async function startRun(rawRequest) {
    if (disposed) fail('builder_harness_runtime_composition_closed');
    const request = exactObject(rawRequest, START_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(valueAt(request, 'run_contract'));
    if (runContract.runtime_descriptor.descriptor_id !== runtime.descriptor.descriptor_id) fail();
    const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(request, 'source_tree'));
    const providerConfig = sanitizeBuilderProviderConfig(valueAt(request, 'provider_config'));
    const credential = safeCredential(valueAt(request, 'credential'));
    const eventSink = valueAt(request, 'event_sink');
    requiredMethod(eventSink, 'emit');
    const runId = runContract.admission.run_id;
    if (entries.has(runId)) fail('builder_harness_runtime_composition_conflict');
    if (
      runContract.admission.mode !== 'build'
      || runContract.admission.provider_config_digest !== providerConfig.config_digest
      || runContract.admission.workspace_ref.source_tree_digest !== sourceTree.source_tree_digest
      || runContract.admission.allowed_tools.join(',') !== [
        'read',
        'search',
        'edit',
        'write',
        ...(commandRuntime === null ? [] : ['command']),
        ...(agentTestBrowserRuntime === null ? [] : ['browser']),
        'question',
      ].join(',')
    ) fail();
    const entry = {
      run_contract: runContract,
      provider_config: providerConfig,
      credential,
      event_sink: eventSink,
      workspace_tools: trackedWorkspaceTools(runContract, sourceTree),
      session_id: `builder-harness-${(runContract.input.resume_session_run_id ?? runId).slice('builder-run:'.length)}`,
      broker: null,
      broker_closed: false,
      browser_service: null,
      pending_user_question: null,
      pending_command_approval: null,
      runtime_handle: null,
      status: 'starting',
    };
    entries.set(runId, entry);
    try {
      const originRunId = runContract.input.resume_session_run_id;
      const resume = originRunId === undefined
        ? { session_run_id: runId, base_source_tree: sourceTree }
        : (await snapshotStore.read_run_source_tree({
          ...snapshotIdentity(runContract), run_id: originRunId,
        })).resume;
      if (resume === undefined) fail('builder_harness_runtime_composition_unavailable');
      await snapshotStore.record_source_tree({ ...snapshotIdentity(runContract), source_tree: sourceTree, resume });
      entry.runtime_handle = await runtime.startRun({ run_contract: runContract, event_sink: eventSink });
      entry.status = 'running';
    } catch (error) {
      entries.delete(runId);
      await closeWorkspace(entry);
      await closeEntryBroker(entry);
      throw error;
    }
    const completion = entry.runtime_handle.completion.then(async (result) => {
      if (result.status !== 'awaiting_reconciliation') {
        entry.status = result.status;
        entries.delete(runId);
        const resultingSourceTree = await closeWorkspace(entry);
        return freezeDeep({
          composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
          ...result,
          resulting_source_tree: result.status === 'failed' ? resultingSourceTree : null,
        });
      }
      const resultingSourceTree = await entry.workspace_tools.snapshot();
      entry.status = 'awaiting_reconciliation';
      return freezeDeep({
        composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
        ...result,
        resulting_source_tree: resultingSourceTree,
      });
    });
    entry.completion = completion;
    return freezeDeep({
      composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
      runtime_version: BUILDER_HARNESS_PROGRAMMING_RUNTIME_VERSION,
      runtime_kind: runtime.descriptor.runtime_kind,
      run_id: runId,
      completion,
    });
  }

  async function reconcileRun(rawHandle, rawCompletion) {
    const entry = checkedHandle(rawHandle);
    if (entry.status !== 'awaiting_reconciliation') fail('builder_harness_runtime_composition_conflict');
    await closeWorkspace(entry);
    try { return await runtime.reconcileRun(entry.runtime_handle, rawCompletion); }
    finally { entries.delete(entry.run_contract.admission.run_id); }
  }

  async function repairRun(rawHandle, rawRepair) {
    const entry = checkedHandle(rawHandle);
    if (entry.status !== 'awaiting_reconciliation') {
      fail('builder_harness_runtime_composition_conflict');
    }
    const repair = exactObject(rawRepair, REPAIR_KEYS);
    const result = await runtime.repairRun(entry.runtime_handle, {
      failure_summary: valueAt(repair, 'failure_summary'),
    });
    if (result.status !== 'awaiting_reconciliation') {
      entry.status = result.status;
      entries.delete(entry.run_contract.admission.run_id);
      await closeWorkspace(entry);
      return freezeDeep({
        composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
        ...result,
        resulting_source_tree: null,
      });
    }
    const resultingSourceTree = await entry.workspace_tools.snapshot();
    entry.status = 'awaiting_reconciliation';
    return freezeDeep({
      composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
      ...result,
      resulting_source_tree: resultingSourceTree,
    });
  }

  async function cancelRun(rawHandle, rawReason) {
    const entry = checkedHandle(rawHandle);
    if (commandRuntime !== null) {
      commandRuntime.approval_service.cancel_run(entry.run_contract.admission.run_id);
      commandRuntime.executor.cancel({ run_id: entry.run_contract.admission.run_id });
    }
    const workspaceSettlement = closeWorkspace(entry);
    try {
      const [result] = await Promise.all([
        runtime.cancelRun(entry.runtime_handle, rawReason),
        workspaceSettlement,
      ]);
      return result;
    }
    finally {
      entries.delete(entry.run_contract.admission.run_id);
      await closeEntryBroker(entry);
    }
  }

  function pendingUserQuestion(rawRunId) {
    if (typeof rawRunId !== 'string') fail();
    const entry = entries.get(rawRunId);
    if (entry === undefined || entry.broker === null) return null;
    return entry.broker.pending_user_question();
  }

  function answerUserQuestion(rawRequest) {
    const request = exactObject(rawRequest, ['run_id', 'message']);
    const runId = valueAt(request, 'run_id');
    const message = valueAt(request, 'message');
    if (typeof runId !== 'string' || typeof message !== 'string') fail();
    const entry = entries.get(runId);
    if (entry === undefined || entry.broker === null) return false;
    const answered = entry.broker.answer_user_question({ message });
    if (answered) entry.pending_user_question = null;
    return answered;
  }

  function pendingCommandApproval(rawRunId) {
    if (typeof rawRunId !== 'string') fail();
    return commandRuntime === null
      ? null
      : commandRuntime.approval_service.pending_for_run(rawRunId);
  }

  function decideCommandApproval(rawRequest) {
    if (commandRuntime === null) return false;
    return commandRuntime.approval_service.decide(rawRequest);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await Promise.all([...entries.values()].map(closeWorkspace));
    try { await runtime.dispose(); } finally {
      await Promise.all([...entries.values()].map(async (entry) => {
        await closeEntryBroker(entry);
      }));
      entries.clear();
    }
  }

  return freezeDeep({
    composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
    descriptor: runtime.descriptor,
    startRun,
    repairRun,
    reconcileRun,
    manual_compact(request) {
      return runtime.manual_compact(request);
    },
    cancelRun,
    pendingUserQuestion,
    answerUserQuestion,
    pendingCommandApproval,
    decideCommandApproval,
    bindToolFile(request) {
      return snapshotStore.bind_tool_file(request);
    },
    recordRuntimeSourceTree(request) {
      return snapshotStore.record_source_tree(request);
    },
    readRuntimeToolFile(request) {
      return snapshotStore.read_tool_file(request);
    },
    readRuntimeSourceTree(request) {
      return snapshotStore.read_source_tree(request);
    },
    async prepareResume(request) {
      const value = exactObject(request, ['project_id', 'conversation_id', 'run_id', 'session_run_id', 'current_source_tree']);
      const record = await snapshotStore.read_run_source_tree({
        project_id: value.project_id, conversation_id: value.conversation_id, run_id: value.run_id,
      });
      const currentTree = sanitizeBuilderProjectSourceTree(value.current_source_tree);
      if (record.resume === undefined || record.resume.session_run_id !== value.session_run_id) {
        fail('builder_harness_runtime_composition_unavailable');
      }
      // An external edit must never be silently overwritten by the paused snapshot.
      if (record.resume.base_source_tree.source_tree_digest !== currentTree.source_tree_digest) {
        fail('builder_harness_runtime_composition_conflict');
      }
      return record.source_tree;
    },
    async prepareContinuation(request) {
      const value = exactObject(request, [
        'project_id', 'conversation_id', 'run_id', 'session_run_id', 'current_source_tree',
      ]);
      const record = await snapshotStore.read_run_source_tree({
        project_id: value.project_id,
        conversation_id: value.conversation_id,
        run_id: value.run_id,
      });
      const currentTree = sanitizeBuilderProjectSourceTree(value.current_source_tree);
      if (
        record.resume === undefined
        || record.resume.session_run_id !== value.session_run_id
      ) fail('builder_harness_runtime_composition_unavailable');
      if (record.source_tree.source_tree_digest !== currentTree.source_tree_digest) {
        fail('builder_harness_runtime_composition_conflict');
      }
      const filesByPath = new Map(record.source_tree.files.map((file) => [file.path, file]));
      const observed = [...new Set(Object.values(record.tools))]
        .map((toolPath) => filesByPath.get(toolPath))
        .filter((file) => file !== undefined)
        .map((file) => freezeDeep({
          path: file.path,
          content_digest: file.content_digest,
          freshness: 'unchanged',
        }));
      return freezeDeep({
        projection_version: 'builder-session-continuation-projection.v1',
        continuity_status: 'native_resumed',
        reason: 'previous_harness_session_available',
        session_run_id: value.session_run_id,
        source_tree_digest: record.source_tree.source_tree_digest,
        source_freshness: 'unchanged',
        observed_working_set: observed,
      });
    },
    dispose,
    diagnostics() {
      return freezeDeep({
        composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
        runtime_available: true,
        active_run_count: entries.size,
        provider_route: 'deepseek-official',
        allowed_tools: [
          'read',
          'search',
          'edit',
          'write',
          ...(commandRuntime === null ? [] : ['command']),
          ...(agentTestBrowserRuntime === null ? [] : ['browser']),
          'question',
        ],
        shell_available: commandRuntime !== null,
        renderer_authority: false,
        runtime: typeof runtime.diagnostics === 'function' ? runtime.diagnostics() : null,
      });
    },
  });
}

function createDefaultBuilderHarnessRuntimeComposition(rawOptions) {
  const options = exactObjectWithOptional(rawOptions, [
    'runtime_root', 'config_path', 'execution_root', 'session_root', 'worker_path',
  ], [
    'supervision_policy', 'on_command_approval_requested', 'on_command_output',
    'agent_test_browser_runtime',
  ]);
  const windowsRoot = process.platform === 'win32'
    ? existingPath(path.resolve(process.env.SystemRoot), 'directory')
    : null;
  const sessionRoot = sessionDirectory(valueAt(options, 'session_root'));
  const commandClock = Object.freeze({
    clock_version: 'builder-clock.v1',
    now_ms: Date.now,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
  });
  const commandRegistry = createBuilderCheckRuntimeRegistry();
  if (commandRegistry.registry_version !== BUILDER_CHECK_RUNTIME_REGISTRY_VERSION) fail();
  const commandResolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: commandRegistry,
    launcher_path: path.resolve(process.execPath),
    worker_path: existingPath(valueAt(options, 'worker_path'), 'file'),
    clock: commandClock,
  });
  const commandApprovalService = createBuilderControlledCommandApprovalService({
    now_ms: Date.now,
    on_approval_requested: optionalValueAt(options, 'on_command_approval_requested') ?? (() => undefined),
  });
  const commandProcessAdapter = createBuilderCheckRunProcessAdapter({
    spawn_process: childProcess.spawn,
    platform: process.platform,
    windows_root: windowsRoot,
  });
  const commandExecutor = createBuilderControlledCommandExecutor({
    approval_service: commandApprovalService,
    runtime_resolver: commandResolver,
    runtime_registry: commandRegistry,
    process_adapter: commandProcessAdapter,
    command_root: path.join(sessionRoot, CONTROLLED_COMMAND_WORKSPACE_DIRECTORY),
    clock: commandClock,
    on_output: optionalValueAt(options, 'on_command_output') ?? (() => undefined),
  });
  return createBuilderHarnessRuntimeComposition({
    runtime_root: valueAt(options, 'runtime_root'),
    config_path: valueAt(options, 'config_path'),
    execution_root: valueAt(options, 'execution_root'),
    session_root: sessionRoot,
    clock: Date.now,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
    process_adapter: createBuilderHarnessProcessAdapter({
      spawn_process: childProcess.spawn,
      platform: process.platform,
      windows_root: windowsRoot,
    }),
    create_host: createBuilderHarnessProcessHost,
    create_broker: createBuilderHarnessToolBrokerServer,
    command_runtime: Object.freeze({
      approval_service: commandApprovalService,
      executor: commandExecutor,
    }),
    ...(optionalValueAt(options, 'agent_test_browser_runtime') === undefined ? {} : {
      agent_test_browser_runtime: optionalValueAt(options, 'agent_test_browser_runtime'),
    }),
    supervision_policy: optionalValueAt(options, 'supervision_policy'),
  });
}

module.exports = freezeDeep({
  BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
  CONTROLLED_COMMAND_WORKSPACE_DIRECTORY,
  BuilderHarnessRuntimeCompositionError,
  createBuilderHarnessRuntimeComposition,
  createDefaultBuilderHarnessRuntimeComposition,
  resolveBuilderHarnessPackagedRuntime,
});
