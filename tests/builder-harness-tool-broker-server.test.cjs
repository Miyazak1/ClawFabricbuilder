'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const {
  createBuilderHarnessToolBrokerServer,
} = require('../electron/builder-harness-tool-broker-server.cjs');
const {
  BuilderAgentTestBrowserRuntimeError,
} = require('../electron/builder-agent-test-browser-runtime.cjs');
const {
  builderPerformanceTrace,
  resetBuilderPerformanceTraceForTests,
} = require('../electron/builder-performance-trace.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingWorkspaceTools,
} = require('../electron/builder-programming-workspace-tools.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const PROVIDER_DIGEST = `sha256:${'a'.repeat(64)}`;

function runtimeDescriptor() {
  return createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness.v1',
    implementation_version: '1.0.0-test.1',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'none',
      native_tool_calls: true,
      steering: 'none',
      cancellation: 'process',
      session_resume: 'none',
      context_compaction: true,
      parallel_read_tools: false,
    },
  });
}

function workspaceTools() {
  const tree = createBuilderProjectSourceTree({
    files: [
      { path: 'src/timer.js', content: 'export const seconds = 30;\n' },
      { path: 'README.md', content: '# Timer\n' },
    ],
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtimeDescriptor(),
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
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
      provider_config_digest: PROVIDER_DIGEST,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 100,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update the timer.',
    },
  });
  return createBuilderProgrammingWorkspaceTools({
    run_contract: runContract,
    source_tree: tree,
  });
}

function controlledWorkspaceTools(overrides = {}) {
  const methods = {
    async read(rawRequest) {
      return {
        result_version: 'builder-programming-workspace-tools.v1',
        tool: 'read',
        status: 'ready',
        resource_id: rawRequest.resource_id,
        content: 'ready\n',
        content_bytes: 6,
        observed_version: `sha256:${'1'.repeat(64)}`,
      };
    },
    async search(rawRequest) {
      return {
        result_version: 'builder-programming-workspace-tools.v1',
        tool: 'search',
        status: 'completed',
        query: rawRequest.query,
        matches: [],
        truncated: false,
        total_matches: 0,
      };
    },
    async edit() {
      return {
        result_version: 'builder-programming-workspace-tools.v1',
        tool: 'edit',
        status: 'unchanged',
        resource_id: 'project:/src/timer.js',
        previous_version: `sha256:${'1'.repeat(64)}`,
        observed_version: `sha256:${'1'.repeat(64)}`,
        added_lines: 0,
        deleted_lines: 0,
        source_tree_digest: `sha256:${'2'.repeat(64)}`,
      };
    },
    async write() {
      return {
        result_version: 'builder-programming-workspace-tools.v1',
        tool: 'write',
        status: 'created',
        resource_id: 'project:/created.js',
        previous_version: null,
        observed_version: `sha256:${'3'.repeat(64)}`,
        added_lines: 1,
        deleted_lines: 0,
        source_tree_digest: `sha256:${'4'.repeat(64)}`,
      };
    },
    ...overrides,
  };
  return Object.freeze({
    service_version: 'builder-programming-workspace-tools.v1',
    read: methods.read,
    search: methods.search,
    edit: methods.edit,
    write: methods.write,
  });
}

async function post(endpoint, token, body, contentType = 'application/json') {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': contentType,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function runningBroker(t, options = {}) {
  const broker = createBuilderHarnessToolBrokerServer({
    workspace_tools: workspaceTools(),
    ...options,
  });
  const access = await broker.start();
  t.after(async () => { await broker.close(); });
  return { broker, access };
}

test('exposes bounded Agent Test browser methods only when a run browser service is present', async (t) => {
  resetBuilderPerformanceTraceForTests();
  t.after(() => resetBuilderPerformanceTraceForTests());
  assert.equal(builderPerformanceTrace.configure({
    enabled: true,
    output_path: path.resolve('ignored-browser-trace.json'),
  }), true);
  const calls = [];
  const observation = Object.freeze({
    observation_version: 'builder-agent-test-browser-observation.v1',
    title: 'Fixture',
    visible_text: 'Ready',
  });
  const browserService = Object.freeze({
    service_version: 'builder-agent-test-browser-service.v1',
    async open_local_app(args) { calls.push(['open', args]); return observation; },
    async observe(args) { calls.push(['observe', args]); return observation; },
    async click(args) { calls.push(['click', args]); return observation; },
    async type(args) { calls.push(['type', args]); return observation; },
    async select_option(args) { calls.push(['select', args]); return observation; },
    async press_key(args) { calls.push(['key', args]); return observation; },
    async scroll(args) { calls.push(['scroll', args]); return observation; },
    async reload_latest_source(args) { calls.push(['reload', args]); return observation; },
    async close(args) { calls.push(['close', args]); return { closed: true }; },
  });
  const { broker, access } = await runningBroker(t, { browser_service: browserService });

  assert.equal(broker.diagnostics().exposes_browser, true);
  assert.equal(broker.diagnostics().allowed_methods.includes('browser_open_local_app'), true);
  assert.equal(broker.diagnostics().allowed_methods.includes('browser_click'), true);
  const opened = await post(access.endpoint, access.bearer_token, {
    method: 'browser_open_local_app', arguments: {},
  });
  const clicked = await post(access.endpoint, access.bearer_token, {
    method: 'browser_click', arguments: { element_ref: `browser-element:${'a'.repeat(64)}` },
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.result.visible_text, 'Ready');
  assert.equal(clicked.status, 200);
  const metricNames = builderPerformanceTrace.snapshot().metrics.map((metric) => metric.name);
  assert.equal(
    metricNames.includes('main.harness_tool_broker.tool_browser_open_local_app.duration_ms'),
    true,
  );
  assert.equal(metricNames.includes('main.harness_tool_broker.tool_browser_click.duration_ms'), true);
  assert.deepEqual(calls, [
    ['open', {}],
    ['click', { element_ref: `browser-element:${'a'.repeat(64)}` }],
  ]);
});

test('preserves retryable Agent Test browser runtime failures', async (t) => {
  const browserService = Object.freeze({
    service_version: 'builder-agent-test-browser-service.v1',
    async open_local_app() {
      const error = new BuilderAgentTestBrowserRuntimeError(
        'builder_agent_test_browser_operation_timeout',
      );
      throw error;
    },
    observe: async () => ({}),
    click: async () => ({}),
    type: async () => ({}),
    select_option: async () => ({}),
    press_key: async () => ({}),
    scroll: async () => ({}),
    reload_latest_source: async () => ({}),
    close: async () => ({ closed: true }),
  });
  const { access } = await runningBroker(t, { browser_service: browserService });

  const response = await post(access.endpoint, access.bearer_token, {
    method: 'browser_open_local_app', arguments: {},
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.deepEqual(response.body.error, {
    code: 'builder_agent_test_browser_operation_timeout',
    message: 'Builder Agent Test browser is unavailable.',
    retryable: true,
  });
});

test('brokers read, version-guarded edit, search, and write through Builder workspace tools', async (t) => {
  const { broker, access } = await runningBroker(t);
  const read = await post(access.endpoint, access.bearer_token, {
    method: 'read',
    arguments: { resource_id: 'project:/src/timer.js' },
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.ok, true);
  assert.equal(read.body.result.content, 'export const seconds = 30;\n');

  const edit = await post(access.endpoint, access.bearer_token, {
    method: 'edit',
    arguments: {
      resource_id: 'project:/src/timer.js',
      observed_version: read.body.result.observed_version,
      content: 'export const seconds = 60;\n',
    },
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.result.status, 'changed');

  const search = await post(access.endpoint, access.bearer_token, {
    method: 'search',
    arguments: { query: 'seconds', max_results: 10 },
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.result.matches[0].resource_id, 'project:/src/timer.js');

  const write = await post(access.endpoint, access.bearer_token, {
    method: 'write',
    arguments: {
      resource_id: 'project:/src/check.js',
      expected_absent: true,
      content: 'export const ready = true;\n',
    },
  });
  assert.equal(write.status, 200);
  assert.equal(write.body.result.status, 'created');

  assert.deepEqual(broker.diagnostics(), {
    broker_version: 'builder-harness-tool-broker.v1',
    state: 'ready',
    endpoint: access.endpoint,
    exposes_filesystem: false,
    exposes_process: false,
    exposes_browser: false,
    allowed_methods: ['read', 'search', 'edit', 'write', 'ask_user_question'],
    pending_user_question: false,
    tool_scheduler: {
      read: { active: 0, limit: 2, queued: 0 },
      search: { active: 0, limit: 1, queued: 0 },
    },
  });
  assert.equal(JSON.stringify(broker.diagnostics()).includes(access.bearer_token), false);
});

test('bounds concurrent Harness read and search pressure per run and records scheduler metrics', async (t) => {
  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-broker-trace-'));
  t.after(() => {
    resetBuilderPerformanceTraceForTests();
    fs.rmSync(traceRoot, { recursive: true, force: true });
  });
  resetBuilderPerformanceTraceForTests();
  assert.equal(builderPerformanceTrace.configure({
    enabled: true,
    output_path: path.join(traceRoot, 'trace.json'),
  }), true);
  let activeSearch = 0;
  let activeRead = 0;
  let maxActiveSearch = 0;
  let maxActiveRead = 0;
  const broker = createBuilderHarnessToolBrokerServer({
    workspace_tools: controlledWorkspaceTools({
      async search(rawRequest) {
        activeSearch += 1;
        maxActiveSearch = Math.max(maxActiveSearch, activeSearch);
        await delay(20);
        activeSearch -= 1;
        return {
          result_version: 'builder-programming-workspace-tools.v1',
          tool: 'search',
          status: 'completed',
          query: rawRequest.query,
          matches: [],
          truncated: false,
          total_matches: 0,
        };
      },
      async read(rawRequest) {
        activeRead += 1;
        maxActiveRead = Math.max(maxActiveRead, activeRead);
        await delay(20);
        activeRead -= 1;
        return {
          result_version: 'builder-programming-workspace-tools.v1',
          tool: 'read',
          status: 'ready',
          resource_id: rawRequest.resource_id,
          content: 'ready\n',
          content_bytes: 6,
          observed_version: `sha256:${'5'.repeat(64)}`,
        };
      },
    }),
  });
  const access = await broker.start();
  t.after(async () => { await broker.close(); });

  const searchRequests = Array.from({ length: 4 }, (_item, index) => post(
    access.endpoint,
    access.bearer_token,
    { method: 'search', arguments: { query: `query-${index}`, max_results: 1 } },
  ));
  const readRequests = Array.from({ length: 4 }, (_item, index) => post(
    access.endpoint,
    access.bearer_token,
    { method: 'read', arguments: { resource_id: `project:/src/file-${index}.js` } },
  ));
  const responses = await Promise.all([...searchRequests, ...readRequests]);

  assert.equal(responses.every((response) => response.status === 200 && response.body.ok === true), true);
  assert.equal(maxActiveSearch, 1);
  assert.equal(maxActiveRead, 2);
  assert.deepEqual(broker.diagnostics().tool_scheduler, {
    read: { active: 0, limit: 2, queued: 0 },
    search: { active: 0, limit: 1, queued: 0 },
  });
  const metrics = new Map(builderPerformanceTrace.snapshot().metrics.map((metric) => [metric.name, metric]));
  assert.ok((metrics.get('main.harness_tool_broker.tool_search.queued_count')?.count ?? 0) >= 1);
  assert.ok((metrics.get('main.harness_tool_broker.tool_search.queue_wait.duration_ms')?.count ?? 0) >= 4);
  assert.ok((metrics.get('main.harness_tool_broker.tool_search.active_count')?.max ?? 0) <= 1);
  assert.ok((metrics.get('main.harness_tool_broker.tool_read.queued_count')?.count ?? 0) >= 1);
  assert.ok((metrics.get('main.harness_tool_broker.tool_read.queue_wait.duration_ms')?.count ?? 0) >= 4);
  assert.ok((metrics.get('main.harness_tool_broker.tool_read.active_count')?.max ?? 0) <= 2);
});

test('keeps packaged-canary broker diagnostic delay behind a bounded environment flag', async (t) => {
  const previousDelay = process.env.BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS;
  t.after(() => {
    if (previousDelay === undefined) {
      delete process.env.BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS;
    } else {
      process.env.BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS = previousDelay;
    }
  });
  process.env.BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS = '25';
  const tools = controlledWorkspaceTools({
    async read() {
      return Object.freeze({
        status: 'ok',
        resource_id: 'project:/index.html',
        content: '',
        content_bytes: 0,
        observed_version: `sha256:${'a'.repeat(64)}`,
        total_lines: 0,
      });
    },
  });
  const broker = createBuilderHarnessToolBrokerServer({
    workspace_tools: tools,
  });
  t.after(() => broker.close());
  const { endpoint, bearer_token: bearerToken } = await broker.start();
  const startedAt = Date.now();
  const response = await post(endpoint, bearerToken, {
    method: 'read',
    arguments: { resource_id: 'project:/index.html' },
  });
  assert.equal(response.status, 200);
  assert.ok(Date.now() - startedAt >= 20);
});

test('keeps a native Harness user question pending until Builder answers it', async (t) => {
  let notifyQuestion;
  const notified = new Promise((resolve) => { notifyQuestion = resolve; });
  const observed = [];
  const { broker, access } = await runningBroker(t, {
    on_user_question(request) {
      observed.push(request);
      notifyQuestion();
    },
  });
  const responsePromise = post(access.endpoint, access.bearer_token, {
    method: 'ask_user_question',
    arguments: {
      questions: [{
        id: 'framework',
        question: 'Which framework should I use?',
        detail: 'The existing project has no framework files.',
        header: 'Framework',
        options: [
          { label: 'React', description: 'Use the existing frontend toolchain.' },
          { label: 'Vanilla', description: 'Keep the project dependency-free.' },
        ],
        multi_select: false,
      }],
    },
  });

  await notified;
  assert.equal(broker.diagnostics().pending_user_question, true);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].questions[0].question, 'Which framework should I use?');
  assert.deepEqual(broker.pending_user_question(), observed[0]);
  assert.equal(broker.answer_user_question({ message: 'Use React.' }), true);

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result, {
    answers: [{ id: 'framework', selected: [], custom: 'Use React.' }],
  });
  assert.equal(broker.pending_user_question(), null);
  assert.equal(broker.answer_user_question({ message: 'Too late.' }), false);
});

test('rejects missing credentials, unknown methods, malformed bodies, and non-JSON input', async (t) => {
  const { access } = await runningBroker(t);
  const unauthorizedResponse = await fetch(access.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'read', arguments: { resource_id: 'project:/README.md' } }),
  });
  assert.equal(unauthorizedResponse.status, 401);

  const unknown = await post(access.endpoint, access.bearer_token, {
    method: 'command',
    arguments: { command: 'npm test' },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'builder_harness_tool_broker_method_invalid');

  const malformed = await post(access.endpoint, access.bearer_token, '{not-json');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'builder_harness_tool_broker_input_invalid');

  const wrongType = await post(
    access.endpoint,
    access.bearer_token,
    JSON.stringify({ method: 'read', arguments: { resource_id: 'project:/README.md' } }),
    'text/plain',
  );
  assert.equal(wrongType.status, 415);
});

test('returns fixed workspace failures and preserves stale-edit retryability', async (t) => {
  const { access } = await runningBroker(t);
  const read = await post(access.endpoint, access.bearer_token, {
    method: 'read',
    arguments: { resource_id: 'project:/src/timer.js' },
  });
  await post(access.endpoint, access.bearer_token, {
    method: 'edit',
    arguments: {
      resource_id: 'project:/src/timer.js',
      observed_version: read.body.result.observed_version,
      content: 'export const seconds = 45;\n',
    },
  });
  const stale = await post(access.endpoint, access.bearer_token, {
    method: 'edit',
    arguments: {
      resource_id: 'project:/src/timer.js',
      observed_version: read.body.result.observed_version,
      content: 'export const seconds = 90;\n',
    },
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.error, {
    code: 'builder_programming_workspace_stale_file',
    message: 'The file changed after it was read. Read it again before editing.',
    retryable: true,
  });

  const escaped = await post(access.endpoint, access.bearer_token, {
    method: 'read',
    arguments: { resource_id: 'project:/../secret.txt' },
  });
  assert.equal(escaped.status, 400);
  assert.equal(escaped.body.error.code, 'builder_programming_workspace_tool_invalid');
  assert.equal(JSON.stringify(escaped.body).includes('secret.txt'), false);

  const protectedPath = await post(access.endpoint, access.bearer_token, {
    method: 'write',
    arguments: {
      resource_id: 'project:/images/placeholder.png',
      expected_absent: true,
      content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    },
  });
  assert.equal(protectedPath.status, 409);
  assert.deepEqual(protectedPath.body.error, {
    code: 'builder_programming_workspace_path_denied',
    message: 'This path is protected by Builder. Use an ordinary UTF-8 project file instead; use .svg for text image placeholders.',
    retryable: true,
  });
});

test('rejects oversized request bodies before dispatch', async (t) => {
  const { access } = await runningBroker(t);
  const oversized = JSON.stringify({
    method: 'write',
    arguments: {
      resource_id: 'project:/large.txt',
      expected_absent: true,
      content: 'x'.repeat(769 * 1_024),
    },
  });
  const result = await post(access.endpoint, access.bearer_token, oversized);
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'builder_harness_tool_broker_input_too_large');
});
