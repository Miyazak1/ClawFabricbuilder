'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
} = require('../electron/builder-harness-process-adapter.cjs');
const {
  BUILDER_HARNESS_PROCESS_HOST_VERSION,
} = require('../electron/builder-harness-process-host.cjs');
const {
  BUILDER_HARNESS_TOOL_BROKER_VERSION,
} = require('../electron/builder-harness-tool-broker-server.cjs');
const {
  createBuilderHarnessRuntimeComposition,
  createDefaultBuilderHarnessRuntimeComposition,
  resolveBuilderHarnessPackagedRuntime,
} = require('../electron/builder-harness-runtime-composition.cjs');
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

test('resolves deployed, source-workspace carrier, and package-root Harness artifacts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-artifacts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layouts = [
    ['deployed_closure', 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js'],
    [
      'source_workspace_node_carrier',
      'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
    ],
    ['package_root', 'lib/packaged-bin.js'],
  ];
  for (const [layout, relativePath] of layouts) {
    const runtimeRoot = path.join(root, layout);
    const packagedBin = path.join(runtimeRoot, relativePath);
    fs.mkdirSync(path.dirname(packagedBin), { recursive: true });
    fs.writeFileSync(packagedBin, '// fixture\n');
    assert.deepEqual(resolveBuilderHarnessPackagedRuntime(runtimeRoot), {
      artifact_version: 'builder-harness-packaged-runtime-artifact.v1',
      runtime_root: runtimeRoot,
      packaged_bin: packagedBin,
      layout,
    });
  }
});

test('fails closed when the Harness runtime root has no known built artifact', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-missing-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => resolveBuilderHarnessPackagedRuntime(root),
    (error) => error?.code === 'builder_harness_runtime_composition_unavailable',
  );
});

test('default composition initializes the controlled command runtime', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-default-composition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const packagedBin = path.join(
    runtimeRoot,
    'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  );
  const executionRoot = path.join(root, 'execution');
  const sessionRoot = path.join(root, 'sessions');
  const configPath = path.join(root, 'builder.cordis.yml');
  const workerPath = path.resolve('electron', 'builder-packaged-check-script-worker.cjs');
  fs.mkdirSync(path.dirname(packagedBin), { recursive: true });
  fs.mkdirSync(executionRoot, { recursive: true });
  fs.writeFileSync(packagedBin, '// fixture\n');
  fs.writeFileSync(configPath, '# fixture\n');

  const composition = createDefaultBuilderHarnessRuntimeComposition({
    runtime_root: runtimeRoot,
    config_path: configPath,
    execution_root: executionRoot,
    session_root: sessionRoot,
    worker_path: workerPath,
    on_command_approval_requested() {},
    on_command_output() {},
  });
  t.after(() => composition.dispose());

  assert.equal(composition.diagnostics().runtime_available, true);
  assert.equal(composition.diagnostics().shell_available, true);
  assert.equal(composition.diagnostics().allowed_tools.includes('command'), true);
});

test('default composition requires a physical controlled-command worker path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-worker-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const packagedBin = path.join(
    runtimeRoot,
    'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  );
  const executionRoot = path.join(root, 'execution');
  const sessionRoot = path.join(root, 'sessions');
  const configPath = path.join(root, 'builder.cordis.yml');
  fs.mkdirSync(path.dirname(packagedBin), { recursive: true });
  fs.mkdirSync(executionRoot, { recursive: true });
  fs.writeFileSync(packagedBin, '// fixture\n');
  fs.writeFileSync(configPath, '# fixture\n');

  assert.throws(
    () => createDefaultBuilderHarnessRuntimeComposition({
      runtime_root: runtimeRoot,
      config_path: configPath,
      execution_root: executionRoot,
      session_root: sessionRoot,
      worker_path: path.join(root, 'app.asar', 'electron', 'builder-packaged-check-script-worker.cjs'),
    }),
    (error) => error?.code === 'builder_harness_runtime_composition_unavailable',
  );
});

function notify(onNotification, sessionId, type, seq, data) {
  return onNotification({
    method: 'session.event',
    params: { sessionId, event: { type, seq, time: 100 + seq, data } },
  });
}

function toolResult(callId) {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', text: 'ok' }],
    source: { callId },
  };
}

function fixture({
  hold_prompt: holdPrompt = false,
  fail_after_edit: failAfterEdit = false,
  agent_test_browser: agentTestBrowser = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-composition-'));
  const runtimeRoot = path.join(root, 'runtime');
  const packagedDirectory = path.join(
    runtimeRoot,
    'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib',
  );
  const executionRoot = path.join(root, 'execution');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(packagedDirectory, { recursive: true });
  fs.mkdirSync(executionRoot, { recursive: true });
  fs.writeFileSync(path.join(packagedDirectory, 'packaged-bin.js'), '// fixture\n');
  const configPath = path.join(root, 'builder.cordis.yml');
  fs.writeFileSync(configPath, '# fixture\n');
  const processAdapter = Object.freeze({
    adapter_version: BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
    spawn_runtime() { throw new Error('not used by the fake host'); },
    terminate_process_tree() { return Promise.resolve(true); },
  });
  let workspaceTools = null;
  let brokerCloseCount = 0;
  let launch = null;
  let promptCount = 0;
  let releaseHeldPrompt = null;
  let hostCancelCount = 0;
  let brokerPendingQuestion = null;
  let brokerQuestionHandler = null;
  let brokerAnswer = null;
  let browserService = null;
  let browserCloseCount = 0;
  const browserCloseRequests = [];
  let resolveHostTermination;
  const hostTermination = new Promise((resolve) => { resolveHostTermination = resolve; });
  const agentTestBrowserRuntime = Object.freeze({
    runtime_version: 'builder-agent-test-browser-runtime.v1',
    async start() {
      return Object.freeze({
        async observe() { return Object.freeze({ visible_text: 'Browser ready' }); },
        async click() { return Object.freeze({ visible_text: 'Clicked' }); },
        async type() { return Object.freeze({ visible_text: 'Typed' }); },
        async select_option() { return Object.freeze({ visible_text: 'Selected' }); },
        async press_key() { return Object.freeze({ visible_text: 'Key pressed' }); },
        async scroll() { return Object.freeze({ visible_text: 'Scrolled' }); },
        async close(request) {
          browserCloseCount += 1;
          browserCloseRequests.push(request);
          return true;
        },
      });
    },
  });
  const composition = createBuilderHarnessRuntimeComposition({
    runtime_root: runtimeRoot,
    config_path: configPath,
    execution_root: executionRoot,
    session_root: sessionRoot,
    clock: (() => { let now = 1_000; return () => ++now; })(),
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
    process_adapter: processAdapter,
    ...(agentTestBrowser ? { agent_test_browser_runtime: agentTestBrowserRuntime } : {}),
    create_broker({ workspace_tools: tools, on_user_question: onUserQuestion, browser_service: runBrowserService }) {
      workspaceTools = tools;
      brokerQuestionHandler = onUserQuestion;
      browserService = runBrowserService ?? null;
      return Object.freeze({
        broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION,
        async start() {
          return Object.freeze({
            endpoint: 'http://127.0.0.1:43123/v1/tool',
            bearer_token: 'a'.repeat(43),
          });
        },
        async close() { brokerCloseCount += 1; return true; },
        pending_user_question() { return brokerPendingQuestion; },
        answer_user_question({ message }) {
          if (brokerPendingQuestion === null) return false;
          brokerAnswer = message;
          brokerPendingQuestion = null;
          return true;
        },
        diagnostics() { return Object.freeze({ state: 'ready' }); },
      });
    },
    create_host(options) {
      launch = options;
      return Object.freeze({
        host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
        async start() {
          return Object.freeze({ runtime_name: 'deepseek-harness-sdk-runtime', runtime_version: '0.0.1' });
        },
        async prompt({ session_id: sessionId }) {
          promptCount += 1;
          if (holdPrompt && promptCount === 1) {
            await new Promise((resolve) => { releaseHeldPrompt = resolve; });
            return Object.freeze({ session_id: sessionId, message_id: 'cancelled-user-message' });
          }
          if (promptCount === 2) {
            await notify(options.on_notification, sessionId, 'turn/start', 10, { turn: 2 });
            await notify(options.on_notification, sessionId, 'step/start', 11, { turn: 2, step: 1 });
            await notify(options.on_notification, sessionId, 'tool/call', 12, {
              turn: 2,
              step: 1,
              callId: 'repair-read-call',
              name: 'read',
              arguments: JSON.stringify({ file_path: 'index.js' }),
            });
            const repairRead = await workspaceTools.read({ resource_id: 'project:/index.js' });
            await notify(options.on_notification, sessionId, 'tool/result', 13, {
              turn: 2,
              step: 1,
              message: toolResult('repair-read-call'),
            });
            await notify(options.on_notification, sessionId, 'tool/call', 14, {
              turn: 2,
              step: 1,
              callId: 'repair-edit-call',
              name: 'edit',
              arguments: JSON.stringify({ file_path: 'index.js' }),
            });
            await workspaceTools.edit({
              resource_id: 'project:/index.js',
              observed_version: repairRead.observed_version,
              content: 'export const ready = "repaired";\n',
            });
            await notify(options.on_notification, sessionId, 'tool/result', 15, {
              turn: 2,
              step: 1,
              message: toolResult('repair-edit-call'),
            });
            const repairText = 'Repaired index.js after the failed check.';
            await notify(options.on_notification, sessionId, 'assistant/message', 16, {
              turn: 2,
              step: 1,
              message: {
                id: 'repair-assistant-message',
                role: 'assistant',
                content: [{ type: 'text', text: repairText }],
                source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
              },
            });
            await notify(options.on_notification, sessionId, 'step/end', 17, { turn: 2, step: 1 });
            await notify(options.on_notification, sessionId, 'turn/end', 18, {
              turn: 2,
              reason: { kind: 'completed' },
            });
            return Object.freeze({ session_id: sessionId, message_id: 'repair-user-message' });
          }
          await notify(options.on_notification, sessionId, 'turn/start', 1, { turn: 1 });
          await notify(options.on_notification, sessionId, 'step/start', 2, { turn: 1, step: 1 });
          await notify(options.on_notification, sessionId, 'tool/call', 3, {
            turn: 1,
            step: 1,
            callId: 'read-call',
            name: 'read',
            arguments: JSON.stringify({ file_path: 'index.js' }),
          });
          const read = await workspaceTools.read({ resource_id: 'project:/index.js' });
          await notify(options.on_notification, sessionId, 'tool/result', 4, {
            turn: 1,
            step: 1,
            message: toolResult('read-call'),
          });
          await notify(options.on_notification, sessionId, 'tool/call', 5, {
            turn: 1,
            step: 1,
            callId: 'edit-call',
            name: 'edit',
            arguments: JSON.stringify({ file_path: 'index.js' }),
          });
          await workspaceTools.edit({
            resource_id: 'project:/index.js',
            observed_version: read.observed_version,
            content: 'export const ready = true;\n',
          });
          await notify(options.on_notification, sessionId, 'tool/result', 6, {
            turn: 1,
            step: 1,
            message: toolResult('edit-call'),
          });
          if (failAfterEdit) throw new Error('fixture runtime stopped after a verified edit');
          const text = 'Updated index.js and left the project ready for checks.';
          await notify(options.on_notification, sessionId, 'assistant/message', 7, {
            turn: 1,
            step: 1,
            message: {
              id: 'assistant-message',
              role: 'assistant',
              content: [{ type: 'text', text }],
              source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
            },
          });
          await notify(options.on_notification, sessionId, 'step/end', 8, { turn: 1, step: 1 });
          await notify(options.on_notification, sessionId, 'turn/end', 9, {
            turn: 1,
            reason: { kind: 'completed' },
          });
          return Object.freeze({ session_id: sessionId, message_id: 'user-message' });
        },
        async shutdown() { return true; },
        when_terminated() { return hostTermination; },
        async cancel() {
          hostCancelCount += 1;
          resolveHostTermination({ reason: 'cancelled', exit_code: null });
          if (releaseHeldPrompt !== null) {
            releaseHeldPrompt();
            releaseHeldPrompt = null;
          }
          return true;
        },
        diagnostics() { return Object.freeze({ state: 'ready' }); },
      });
    },
  });
  return {
    root,
    composition,
    getBrokerCloseCount: () => brokerCloseCount,
    getHostCancelCount: () => hostCancelCount,
    getLaunch: () => launch,
    getWorkspaceTools: () => workspaceTools,
    async askUserQuestion(questionRequest) {
      brokerPendingQuestion = questionRequest;
      await brokerQuestionHandler(questionRequest);
    },
    getBrokerAnswer: () => brokerAnswer,
    getBrowserService: () => browserService,
    getBrowserCloseCount: () => browserCloseCount,
    getBrowserCloseRequests: () => [...browserCloseRequests],
  };
}

function providerConfig() {
  return createBuilderProviderConfig({
    base_url: 'https://api.deepseek.com',
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
}

function runContract(composition, tree, config) {
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: composition.descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}:22345678-1234-4234-8234-123456789abc`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: tree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: config.config_digest,
      allowed_tools: composition.diagnostics().allowed_tools,
      limits: {
        max_steps: 16,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update index.js.',
    },
  });
}

test('returns the Builder-owned workspace snapshot and waits for reconciliation', async (t) => {
  const fixtureValue = fixture();
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
  const handle = await fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: config,
    credential: 'configured-test-credential',
    event_sink: { emit: (candidate) => journal.append(candidate, candidate.occurred_at_ms + 1) },
  });

  const result = await handle.completion;

  assert.equal(result.status, 'awaiting_reconciliation');
  assert.equal(result.resulting_source_tree.files[0].content, 'export const ready = true;\n');
  assert.equal(journal.snapshot().status, 'running');
  assert.equal(fixtureValue.getBrokerCloseCount(), 0);
  assert.equal(fixtureValue.getLaunch().launch.env.DEEPSEEK_API_KEY, 'configured-test-credential');
  assert.equal(fixtureValue.getLaunch().launch.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(
    JSON.parse(fixtureValue.getLaunch().launch.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS),
    ['read', 'search', 'edit', 'write', 'ask_user_question'],
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /at most one short user-facing sentence/u,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Do not publish self-talk, policy deliberation, internal constraint counting/u,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /use Simplified Chinese for every public progress update and the final summary/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /repair prompts, and compaction messages must not change the response language/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /include one short instruction explaining how the user can open, run, or use the result/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /empty or sparse source tree is a normal starting point/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /use write to create the files required by the request/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Repeated searches that only prove files are absent are not progress/iu,
  );
  assert.doesNotMatch(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Inspect the project with Builder tools/u,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /never invent a passing check/iu,
  );
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Use only the tools Builder exposes for this run: read, grep, edit, write, ask_user_question/u,
  );
  assert.doesNotMatch(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Use read, grep, edit, write, bash/u,
  );
  assert.doesNotMatch(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /pauses for one-time user approval/u,
  );
  assert.doesNotMatch(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /at most 12 changed files/u,
  );
  assert.deepEqual(fixtureValue.getLaunch().request_timeouts, {
    initialize_ms: 30_000,
    session_prompt_ms: null,
    shutdown_ms: 5_000,
  });
  assert.equal(JSON.stringify(fixtureValue.composition.diagnostics()).includes('configured-test-credential'), false);

  const runtimeToolCallId = `builder-tool-call:${UUID}`;
  await fixtureValue.composition.bindToolFile({
    project_id: contract.admission.project_id,
    conversation_id: contract.admission.conversation_id,
    run_id: contract.admission.run_id,
    tool_call_id: runtimeToolCallId,
    path: 'index.js',
  });
  const runtimeFile = await fixtureValue.composition.readRuntimeToolFile({
    project_id: contract.admission.project_id,
    conversation_id: contract.admission.conversation_id,
    run_id: contract.admission.run_id,
    tool_call_id: runtimeToolCallId,
  });
  assert.equal(runtimeFile.selected_path, 'index.js');
  assert.equal(runtimeFile.source_tree.files[0].content, 'export const ready = true;\n');

  const recorder = createBuilderProgrammingRuntimeMainFactRecorder({
    run_contract: contract,
    append_main_fact: (candidate) => journal.appendMainFact(candidate, candidate.occurred_at_ms + 1),
    clock: (() => { let now = 2_000; return () => ++now; })(),
  });
  await recorder.record_check({
    verification_step_id: result.verification_step_id,
    command_display: 'npm test',
    status: 'failed',
    duration_ms: 840,
    summary: 'One project test failed.',
  });

  const repaired = await fixtureValue.composition.repairRun(handle, {
    failure_summary: 'One project test failed.',
  });
  assert.equal(repaired.status, 'awaiting_reconciliation');
  assert.equal(
    repaired.resulting_source_tree.files[0].content,
    'export const ready = "repaired";\n',
  );
  assert.notEqual(repaired.verification_step_id, result.verification_step_id);
  assert.equal(fixtureValue.getBrokerCloseCount(), 0);
  await recorder.record_check({
    verification_step_id: repaired.verification_step_id,
    command_display: 'npm test',
    status: 'passed',
    duration_ms: 410,
    summary: 'The project check completed successfully.',
  });

  await fixtureValue.composition.reconcileRun(handle, { checkpoint_status: 'updated' });
  assert.equal(fixtureValue.getBrokerCloseCount(), 1);
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.deepEqual(
    journal.snapshot().events.slice(-6).map((event) => event.event_type),
    [
      'tool_call_started',
      'check_result_recorded',
      'tool_call_completed',
      'step_completed',
      'turn_completed',
      'run_completed',
    ],
  );
  assert.equal(fixtureValue.composition.diagnostics().active_run_count, 0);
});

test('projects a native Harness user question and resumes the same run after Builder answers', async (t) => {
  const fixtureValue = fixture({ hold_prompt: true });
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const events = [];
  const handle = await fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: config,
    credential: 'configured-test-credential',
    event_sink: { async emit(candidate) { events.push(candidate); } },
  });
  const questionRequest = Object.freeze({
    request_id: 'builder-user-question:22345678-1234-4234-8234-123456789abc',
    questions: Object.freeze([Object.freeze({
      id: 'framework',
      question: 'Which framework should I use?',
      options: Object.freeze([]),
      multi_select: false,
    })]),
  });

  await fixtureValue.askUserQuestion(questionRequest);
  assert.deepEqual(
    fixtureValue.composition.pendingUserQuestion(contract.admission.run_id),
    questionRequest,
  );
  assert.deepEqual(events.at(-1), {
    protocol_version: 'builder-programming-runtime.v1',
    runtime_event_ref: 'user-question.22345678-1234-4234-8234-123456789abc.blocked',
    run_id: contract.admission.run_id,
    occurred_at_ms: events.at(-1).occurred_at_ms,
    turn_id: contract.admission.turn_id,
    step_id: null,
    tool_call_id: null,
    event_type: 'run_blocked',
    payload: {
      blocker_class: 'user_input_required',
      safe_message: 'Which framework should I use?',
    },
  });
  assert.equal(Number.isSafeInteger(events.at(-1).occurred_at_ms), true);
  assert.equal(fixtureValue.composition.answerUserQuestion({
    run_id: contract.admission.run_id,
    message: 'Use React.',
  }), true);
  assert.equal(fixtureValue.getBrokerAnswer(), 'Use React.');
  assert.equal(fixtureValue.composition.pendingUserQuestion(contract.admission.run_id), null);

  await fixtureValue.composition.cancelRun(handle, 'user_requested');
  assert.equal((await handle.completion).status, 'cancelled');
});

test('preserves the Builder-owned workspace snapshot after a non-cancelled runtime failure', async (t) => {
  const fixtureValue = fixture({ fail_after_edit: true });
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
  const handle = await fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: config,
    credential: 'configured-test-credential',
    event_sink: { emit: (candidate) => journal.append(candidate, candidate.occurred_at_ms + 1) },
  });

  const completion = await handle.completion;

  assert.equal(completion.status, 'failed');
  assert.equal(completion.runtime_code, 'builder_harness_programming_runtime_failed');
  assert.equal(
    completion.resulting_source_tree.files[0].content,
    'export const ready = true;\n',
  );
  assert.equal(fixtureValue.getBrokerCloseCount(), 1);
  assert.equal(fixtureValue.composition.diagnostics().active_run_count, 0);
  assert.equal(journal.snapshot().status, 'run_failed');
});

test('cancellation closes workspace tools before the Harness process settles', async (t) => {
  const fixtureValue = fixture({ hold_prompt: true });
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
  const handle = await fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: config,
    credential: 'configured-test-credential',
    event_sink: { emit: (candidate) => journal.append(candidate, candidate.occurred_at_ms + 1) },
  });

  const cancellation = fixtureValue.composition.cancelRun(handle, 'user_requested');
  const tools = fixtureValue.getWorkspaceTools();
  await assert.rejects(
    tools.read({ resource_id: 'project:/index.js' }),
    (error) => error?.code === 'builder_programming_workspace_closed',
  );
  await assert.rejects(
    tools.edit({
      resource_id: 'project:/index.js',
      observed_version: sourceTree.files[0].content_digest,
      content: 'export const ready = "late";\n',
    }),
    (error) => error?.code === 'builder_programming_workspace_closed',
  );

  const [cancelled, completion] = await Promise.all([cancellation, handle.completion]);
  assert.equal(cancelled.cancellation_requested, true);
  assert.equal(completion.status, 'cancelled');
  assert.equal(completion.resulting_source_tree, null);
  assert.equal((await tools.snapshot()).source_tree_digest, sourceTree.source_tree_digest);
  assert.equal(fixtureValue.getHostCancelCount(), 1);
  assert.equal(fixtureValue.getBrokerCloseCount(), 1);
  assert.equal(fixtureValue.composition.diagnostics().active_run_count, 0);
  assert.equal(journal.snapshot().status, 'run_cancelled');
});

test('binds one Agent Test browser service to the run and closes it on cancellation', async (t) => {
  const fixtureValue = fixture({ hold_prompt: true, agent_test_browser: true });
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
    { path: 'index.html', content: '<h1>Browser ready</h1>\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
  const handle = await fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: config,
    credential: 'configured-test-credential',
    event_sink: { emit: (candidate) => journal.append(candidate, candidate.occurred_at_ms + 1) },
  });

  const browserService = fixtureValue.getBrowserService();
  assert.equal(browserService.service_version, 'builder-agent-test-browser-service.v1');
  assert.deepEqual(await browserService.open_local_app(), { visible_text: 'Browser ready' });
  const allowedMethods = JSON.parse(
    fixtureValue.getLaunch().launch.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS,
  );
  assert.equal(allowedMethods.includes('browser_open_local_app'), true);
  assert.equal(allowedMethods.includes('browser_reload_latest_source'), true);
  assert.match(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /browser_open_local_app, browser_observe, browser_click/u,
  );
  assert.doesNotMatch(
    fixtureValue.getLaunch().launch.env.DSH_SYSTEM_PROMPT,
    /Use only read, grep, edit, write, and ask_user_question/u,
  );

  await fixtureValue.composition.cancelRun(handle, 'user_requested');
  assert.equal(fixtureValue.getBrowserCloseCount(), 1);
  assert.deepEqual(fixtureValue.getBrowserCloseRequests(), [{ reason: 'cancelled' }]);
});

test('rejects a provider digest that does not match the admitted run', async (t) => {
  const fixtureValue = fixture();
  t.after(async () => {
    await fixtureValue.composition.dispose();
    fs.rmSync(fixtureValue.root, { recursive: true, force: true });
  });
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.js', content: 'export const ready = false;\n' },
  ] });
  const config = providerConfig();
  const contract = runContract(fixtureValue.composition, sourceTree, config);
  const other = createBuilderProviderConfig({
    base_url: config.base_url,
    model: 'deepseek-v4-pro',
    timeout_ms: config.timeout_ms,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    secret_ref: config.secret_ref,
  });
  await assert.rejects(fixtureValue.composition.startRun({
    run_contract: contract,
    source_tree: sourceTree,
    provider_config: other,
    credential: 'configured-test-credential',
    event_sink: { emit() {} },
  }));
});
