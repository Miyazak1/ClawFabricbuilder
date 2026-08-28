'use strict';

const nodeCrypto = require('node:crypto');
const nodeHttp = require('node:http');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
  BuilderProgrammingWorkspaceToolsError,
} = require('./builder-programming-workspace-tools.cjs');
const {
  BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION,
  BuilderControlledCommandExecutorError,
} = require('./builder-controlled-command-executor.cjs');
const {
  BuilderControlledCommandApprovalServiceError,
} = require('./builder-controlled-command-approval-service.cjs');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');
const {
  BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION,
  BuilderAgentTestBrowserServiceError,
} = require('./builder-agent-test-browser-service.cjs');
const {
  BuilderAgentTestBrowserRuntimeError,
} = require('./builder-agent-test-browser-runtime.cjs');

const BUILDER_HARNESS_TOOL_BROKER_VERSION = 'builder-harness-tool-broker.v1';
const OPTION_KEYS = Object.freeze(['workspace_tools']);
const OPTIONAL_OPTION_KEYS = Object.freeze(['on_user_question', 'command_service', 'browser_service']);
const REQUEST_KEYS = Object.freeze(['method', 'arguments']);
const WORKSPACE_METHODS = Object.freeze(['read', 'search', 'edit', 'write']);
const BASE_METHODS = Object.freeze([...WORKSPACE_METHODS, 'ask_user_question']);
const BROWSER_METHODS = Object.freeze([
  'browser_open_local_app',
  'browser_observe',
  'browser_click',
  'browser_type',
  'browser_select_option',
  'browser_press_key',
  'browser_scroll',
  'browser_reload_latest_source',
  'browser_close',
]);
const MAX_REQUEST_BYTES = 768 * 1_024;
const MAX_RESPONSE_BYTES = 768 * 1_024;
const TOOL_CONCURRENCY_LIMITS = Object.freeze({
  read: 2,
  search: 1,
});
const DIAGNOSTIC_TOOL_DELAY_ENV = 'BUILDER_PACKAGED_CANARY_BROKER_TOOL_DELAY_MS';

async function measureTraceWindow(windowName, metricName, callback) {
  const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
  try {
    return await builderPerformanceTrace.measureAsync(metricName, callback);
  } finally {
    if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
  }
}

function diagnosticToolDelayFromEnvironment() {
  const value = Number.parseInt(process.env[DIAGNOSTIC_TOOL_DELAY_ENV] ?? '0', 10);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000 ? value : 0;
}

async function delayDiagnosticToolExecution(delayMs) {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

class BuilderHarnessToolBrokerError extends Error {
  constructor(code = 'builder_harness_tool_broker_invalid') {
    const selected = [
      'builder_harness_tool_broker_invalid',
      'builder_harness_tool_broker_conflict',
      'builder_harness_tool_broker_closed',
    ].includes(code) ? code : 'builder_harness_tool_broker_invalid';
    const messages = {
      builder_harness_tool_broker_invalid: 'The Harness tool broker request could not be verified.',
      builder_harness_tool_broker_conflict: 'The Harness tool broker is already active.',
      builder_harness_tool_broker_closed: 'The Harness tool broker is closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessToolBrokerError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderHarnessToolBrokerError(code);
}

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
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys = []) {
  if (!isPlainObject(value)) fail();
  const allowed = [...requiredKeys, ...optionalKeys];
  const actual = Reflect.ownKeys(value);
  if (
    requiredKeys.some((key) => !actual.includes(key))
    || actual.some((key) => typeof key !== 'string' || !allowed.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of actual) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function checkedWorkspaceTools(value) {
  if (!isPlainObject(value) || value.service_version !== BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION) {
    fail();
  }
  const methods = {};
  for (const method of WORKSPACE_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, method);
    if (
      !descriptor
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function'
      || utilTypes.isProxy(descriptor.value)
    ) fail();
    methods[method] = descriptor.value.bind(value);
  }
  return Object.freeze(methods);
}

function checkedCommandService(value) {
  if (!isPlainObject(value) || value.executor_version !== BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION) {
    fail();
  }
  const execute = value.execute;
  if (typeof execute !== 'function' || utilTypes.isProxy(execute)) fail();
  return Object.freeze({ execute: execute.bind(value) });
}

function checkedBrowserService(value) {
  if (!isPlainObject(value) || value.service_version !== BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION) {
    fail();
  }
  const selected = {};
  for (const method of [
    'open_local_app', 'observe', 'click', 'type', 'select_option', 'press_key', 'scroll',
    'reload_latest_source', 'close',
  ]) {
    const candidate = value[method];
    if (typeof candidate !== 'function' || utilTypes.isProxy(candidate)) fail();
    selected[method] = candidate.bind(value);
  }
  return Object.freeze(selected);
}

function safeQuestionText(value, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  return value;
}

function sanitizeQuestionOption(rawValue) {
  const option = exactObjectWithOptional(rawValue, ['label'], ['description']);
  return Object.freeze({
    label: safeQuestionText(option.label.value, 512),
    ...(Object.hasOwn(option, 'description')
      ? { description: safeQuestionText(option.description.value, 2 * 1_024) }
      : {}),
  });
}

function sanitizeQuestion(rawValue) {
  const question = exactObjectWithOptional(
    rawValue,
    ['id', 'question'],
    ['detail', 'header', 'options', 'multi_select', 'intent'],
  );
  const options = Object.hasOwn(question, 'options') ? question.options.value : [];
  if (!Array.isArray(options) || utilTypes.isProxy(options) || options.length > 3) fail();
  const multiSelect = Object.hasOwn(question, 'multi_select')
    ? question.multi_select.value
    : false;
  if (typeof multiSelect !== 'boolean') fail();
  let intent;
  if (Object.hasOwn(question, 'intent')) {
    const rawIntent = exactObject(question.intent.value, ['kind', 'approve']);
    if (rawIntent.kind.value !== 'plan-review') fail();
    intent = Object.freeze({
      kind: 'plan-review',
      approve: safeQuestionText(rawIntent.approve.value, 512),
    });
  }
  return Object.freeze({
    id: safeQuestionText(question.id.value, 256),
    question: safeQuestionText(question.question.value, 4 * 1_024),
    ...(Object.hasOwn(question, 'detail')
      ? { detail: safeQuestionText(question.detail.value, 16 * 1_024) }
      : {}),
    ...(Object.hasOwn(question, 'header')
      ? { header: safeQuestionText(question.header.value, 512) }
      : {}),
    options: Object.freeze(options.map(sanitizeQuestionOption)),
    multi_select: multiSelect,
    ...(intent === undefined ? {} : { intent }),
  });
}

function sanitizeQuestionRequest(rawValue) {
  const request = exactObject(rawValue, ['questions']);
  const questions = request.questions.value;
  if (!Array.isArray(questions) || utilTypes.isProxy(questions) || questions.length !== 1) fail();
  return Object.freeze({ questions: Object.freeze(questions.map(sanitizeQuestion)) });
}

function safeToken() {
  return nodeCrypto.randomBytes(32).toString('base64url');
}

function tokenMatches(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return candidate.length === wanted.length && nodeCrypto.timingSafeEqual(candidate, wanted);
}

function responseEnvelope(ok, value) {
  return ok
    ? { broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION, ok: true, result: value }
    : { broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION, ok: false, error: value };
}

function createToolLimiter(method, limit) {
  const queue = [];
  let active = 0;
  let closed = false;
  const metricPrefix = `main.harness_tool_broker.tool_${method}`;

  function rejectQueued() {
    while (queue.length > 0) {
      const item = queue.shift();
      item.reject(new BuilderHarnessToolBrokerError('builder_harness_tool_broker_closed'));
    }
  }

  function start(item) {
    if (closed) {
      item.reject(new BuilderHarnessToolBrokerError('builder_harness_tool_broker_closed'));
      return;
    }
    active += 1;
    builderPerformanceTrace.observe(`${metricPrefix}.active_count`, active);
    builderPerformanceTrace.observe(
      `${metricPrefix}.queue_wait.duration_ms`,
      Date.now() - item.enqueuedAtMs,
    );
    Promise.resolve()
      .then(item.callback)
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  }

  function drain() {
    if (closed) {
      rejectQueued();
      return;
    }
    while (active < limit && queue.length > 0) {
      start(queue.shift());
    }
  }

  function run(callback) {
    if (closed) {
      return Promise.reject(new BuilderHarnessToolBrokerError('builder_harness_tool_broker_closed'));
    }
    return new Promise((resolve, reject) => {
      const item = Object.freeze({
        callback,
        enqueuedAtMs: Date.now(),
        reject,
        resolve,
      });
      if (active >= limit) {
        queue.push(item);
        builderPerformanceTrace.increment(`${metricPrefix}.queued_count`);
      } else {
        start(item);
      }
    });
  }

  function close() {
    closed = true;
    rejectQueued();
  }

  function diagnostics() {
    return Object.freeze({
      active,
      limit,
      queued: queue.length,
    });
  }

  return Object.freeze({ close, diagnostics, run });
}

function createBuilderHarnessToolBrokerServer(rawOptions) {
  const options = exactObjectWithOptional(rawOptions, OPTION_KEYS, OPTIONAL_OPTION_KEYS);
  const workspaceTools = checkedWorkspaceTools(options.workspace_tools.value);
  const onUserQuestion = Object.hasOwn(options, 'on_user_question')
    ? options.on_user_question.value
    : () => undefined;
  if (typeof onUserQuestion !== 'function' || utilTypes.isProxy(onUserQuestion)) fail();
  const commandService = Object.hasOwn(options, 'command_service')
    ? checkedCommandService(options.command_service.value)
    : null;
  const browserService = Object.hasOwn(options, 'browser_service')
    ? checkedBrowserService(options.browser_service.value)
    : null;
  const methods = Object.freeze([
    ...BASE_METHODS,
    ...(commandService === null ? [] : ['execute_command']),
    ...(browserService === null ? [] : BROWSER_METHODS),
  ]);
  const bearerToken = safeToken();
  let state = 'idle';
  let server = null;
  let endpoint = null;
  let pendingQuestion = null;
  const toolLimiters = Object.freeze({
    read: createToolLimiter('read', TOOL_CONCURRENCY_LIMITS.read),
    search: createToolLimiter('search', TOOL_CONCURRENCY_LIMITS.search),
  });
  const diagnosticToolDelayMs = diagnosticToolDelayFromEnvironment();

  function publicPendingQuestion() {
    if (pendingQuestion === null) return null;
    return Object.freeze({
      request_id: pendingQuestion.request_id,
      questions: pendingQuestion.questions,
    });
  }

  function rejectPendingQuestion() {
    const pending = pendingQuestion;
    if (pending === null) return;
    pendingQuestion = null;
    pending.reject(new BuilderHarnessToolBrokerError('builder_harness_tool_broker_closed'));
  }

  async function askUserQuestion(rawArguments) {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_tool_broker.user_question.duration_ms',
      () => askUserQuestionImpl(rawArguments),
    );
  }

  async function askUserQuestionImpl(rawArguments) {
    if (pendingQuestion !== null) fail('builder_harness_tool_broker_conflict');
    const request = sanitizeQuestionRequest(rawArguments);
    const requestId = `builder-user-question:${nodeCrypto.randomUUID()}`;
    let resolveQuestion;
    let rejectQuestion;
    const answer = new Promise((resolve, reject) => {
      resolveQuestion = resolve;
      rejectQuestion = reject;
    });
    pendingQuestion = {
      request_id: requestId,
      questions: request.questions,
      resolve: resolveQuestion,
      reject: rejectQuestion,
    };
    try {
      await Promise.resolve(Reflect.apply(onUserQuestion, undefined, [publicPendingQuestion()]));
      return await answer;
    } catch (error) {
      if (pendingQuestion?.request_id === requestId) pendingQuestion = null;
      throw error;
    }
  }

  function answerUserQuestion(rawAnswer) {
    const answer = exactObject(rawAnswer, ['message']);
    const message = safeQuestionText(answer.message.value, 48 * 1_024);
    const pending = pendingQuestion;
    if (pending === null) return false;
    pendingQuestion = null;
    pending.resolve(Object.freeze({
      answers: Object.freeze([Object.freeze({
        id: pending.questions[0].id,
        selected: Object.freeze([]),
        custom: message,
      })]),
    }));
    return true;
  }

  function send(response, statusCode, body) {
    return builderPerformanceTrace.measureSync(
      'main.harness_tool_broker.send_response.duration_ms',
      () => sendImpl(response, statusCode, body),
    );
  }

  function sendImpl(response, statusCode, body) {
    let payload;
    try {
      payload = JSON.stringify(body);
    } catch {
      statusCode = 500;
      payload = JSON.stringify(responseEnvelope(false, {
        code: 'builder_harness_tool_broker_internal',
        message: 'The Builder tool result could not be returned.',
        retryable: false,
      }));
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_RESPONSE_BYTES) {
      statusCode = 500;
      payload = JSON.stringify(responseEnvelope(false, {
        code: 'builder_harness_tool_broker_output_too_large',
        message: 'The Builder tool result exceeded its output limit.',
        retryable: false,
      }));
    }
    response.writeHead(statusCode, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload, 'utf8'),
      'x-content-type-options': 'nosniff',
    });
    response.end(payload);
  }

  function reject(response, statusCode, code, message) {
    send(response, statusCode, responseEnvelope(false, {
      code,
      message,
      retryable: false,
    }));
  }

  async function dispatch(request, response) {
    return await measureTraceWindow(
      'harness_tool_broker_dispatch',
      'main.harness_tool_broker.dispatch.duration_ms',
      () => dispatchImpl(request, response),
    );
  }

  async function dispatchImpl(request, response) {
    if (state !== 'ready') {
      reject(response, 503, 'builder_harness_tool_broker_closed', 'The Builder tool broker is unavailable.');
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/tool') {
      reject(response, 404, 'builder_harness_tool_broker_route_invalid', 'The Builder tool route is unavailable.');
      return;
    }
    if (!tokenMatches(request.headers.authorization, bearerToken)) {
      reject(response, 401, 'builder_harness_tool_broker_unauthorized', 'The Builder tool request was not authorized.');
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) {
      reject(response, 415, 'builder_harness_tool_broker_content_type_invalid', 'The Builder tool request must use JSON.');
      return;
    }

    let body = '';
    let bodyBytes = 0;
    try {
      await builderPerformanceTrace.measureAsync(
        'main.harness_tool_broker.read_request.duration_ms',
        async () => {
          for await (const chunk of request) {
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > MAX_REQUEST_BYTES) {
              reject(response, 413, 'builder_harness_tool_broker_input_too_large', 'The Builder tool request exceeded its input limit.');
              return;
            }
            body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          }
        },
      );
      if (bodyBytes > MAX_REQUEST_BYTES) return;
    } catch {
      reject(response, 400, 'builder_harness_tool_broker_input_invalid', 'The Builder tool request could not be read.');
      return;
    }

    let descriptors;
    try {
      ({ descriptors } = builderPerformanceTrace.measureSync(
        'main.harness_tool_broker.parse_request.duration_ms',
        () => {
          const parsedBody = JSON.parse(body);
          return {
            parsed: parsedBody,
            descriptors: exactObject(parsedBody, REQUEST_KEYS),
          };
        },
      ));
    } catch {
      reject(response, 400, 'builder_harness_tool_broker_input_invalid', 'The Builder tool request was not valid JSON.');
      return;
    }
    const method = descriptors.method.value;
    if (typeof method !== 'string' || !methods.includes(method)) {
      reject(response, 400, 'builder_harness_tool_broker_method_invalid', 'This Builder tool is not available.');
      return;
    }
    try {
      let result;
      result = await measureTraceWindow(
        'harness_tool_broker_execute_tool',
        'main.harness_tool_broker.execute_tool.duration_ms',
        async () => {
          if (method === 'ask_user_question') {
            return await builderPerformanceTrace.measureAsync(
              'main.harness_tool_broker.tool_ask_user_question.duration_ms',
              () => askUserQuestion(descriptors.arguments.value),
            );
          }
          if (method === 'execute_command') {
            return await builderPerformanceTrace.measureAsync(
              'main.harness_tool_broker.tool_execute_command.duration_ms',
              () => commandService.execute(descriptors.arguments.value),
            );
          }
          if (method.startsWith('browser_')) {
            const browserMethod = {
              browser_open_local_app: 'open_local_app',
              browser_observe: 'observe',
              browser_click: 'click',
              browser_type: 'type',
              browser_select_option: 'select_option',
              browser_press_key: 'press_key',
              browser_scroll: 'scroll',
              browser_reload_latest_source: 'reload_latest_source',
              browser_close: 'close',
            }[method];
            return await builderPerformanceTrace.measureAsync(
              `main.harness_tool_broker.tool_${method}.duration_ms`,
              () => browserService[browserMethod](descriptors.arguments.value),
            );
          }
          const metricName = {
            read: 'main.harness_tool_broker.tool_read.duration_ms',
            search: 'main.harness_tool_broker.tool_search.duration_ms',
            edit: 'main.harness_tool_broker.tool_edit.duration_ms',
            write: 'main.harness_tool_broker.tool_write.duration_ms',
          }[method];
          const executeWorkspaceTool = () => builderPerformanceTrace.measureAsync(
            metricName,
            async () => {
              await delayDiagnosticToolExecution(diagnosticToolDelayMs);
              return await workspaceTools[method](descriptors.arguments.value);
            },
          );
          if (method === 'read' || method === 'search') {
            return await toolLimiters[method].run(executeWorkspaceTool);
          }
          return await executeWorkspaceTool();
        },
      );
      send(response, 200, responseEnvelope(true, result));
    } catch (error) {
      if (error instanceof BuilderProgrammingWorkspaceToolsError) {
        send(response, error.retryable ? 409 : 400, responseEnvelope(false, {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        }));
        return;
      }
      if (error instanceof BuilderHarnessToolBrokerError) {
        const conflict = error.code === 'builder_harness_tool_broker_conflict';
        send(response, conflict ? 409 : 400, responseEnvelope(false, {
          code: error.code,
          message: error.message,
          retryable: false,
        }));
        return;
      }
      if (
        error instanceof BuilderControlledCommandApprovalServiceError
        || error instanceof BuilderControlledCommandExecutorError
        || error instanceof BuilderAgentTestBrowserServiceError
        || error instanceof BuilderAgentTestBrowserRuntimeError
      ) {
        send(response, 400, responseEnvelope(false, {
          code: error.code,
          message: error.message,
          retryable: error.retryable === true,
        }));
        return;
      }
      reject(response, 500, 'builder_harness_tool_broker_internal', 'The Builder tool could not be completed.');
    }
  }

  async function start() {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_tool_broker.start.duration_ms',
      startImpl,
    );
  }

  async function startImpl() {
    if (state === 'ready' || state === 'starting') fail('builder_harness_tool_broker_conflict');
    if (state === 'closed') fail('builder_harness_tool_broker_closed');
    state = 'starting';
    server = nodeHttp.createServer((request, response) => {
      void dispatch(request, response);
    });
    // A native Harness user-question tool intentionally keeps this request open
    // while the human decides. Tool and run cancellation close the broker.
    server.requestTimeout = 0;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 1_000;
    try {
      const address = await new Promise((resolve, rejectStart) => {
        const onError = (error) => {
          server.off('listening', onListening);
          rejectStart(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
      });
      if (!isPlainObject(address) || address.address !== '127.0.0.1' || !Number.isSafeInteger(address.port)) {
        fail();
      }
      endpoint = `http://127.0.0.1:${address.port}/v1/tool`;
      state = 'ready';
      return Object.freeze({
        broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION,
        endpoint,
        bearer_token: bearerToken,
      });
    } catch (error) {
      state = 'closed';
      try { server.closeAllConnections(); } catch { /* no accepted connections */ }
      if (error instanceof BuilderHarnessToolBrokerError) throw error;
      fail();
    }
  }

  async function close() {
    if (state === 'closed') return false;
    if (state === 'idle') {
      state = 'closed';
      return false;
    }
    state = 'closing';
    rejectPendingQuestion();
    toolLimiters.read.close();
    toolLimiters.search.close();
    await new Promise((resolve) => {
      server.close(() => resolve());
      try { server.closeAllConnections(); } catch { /* close callback still settles */ }
    });
    state = 'closed';
    return true;
  }

  function diagnostics() {
    return Object.freeze({
      broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION,
      state,
      endpoint: state === 'ready' ? endpoint : null,
      exposes_filesystem: false,
      exposes_process: commandService !== null,
      exposes_browser: browserService !== null,
      allowed_methods: [...methods],
      pending_user_question: pendingQuestion !== null,
      tool_scheduler: {
        read: toolLimiters.read.diagnostics(),
        search: toolLimiters.search.diagnostics(),
      },
    });
  }

  return Object.freeze({
    broker_version: BUILDER_HARNESS_TOOL_BROKER_VERSION,
    start,
    close,
    pending_user_question: publicPendingQuestion,
    answer_user_question: answerUserQuestion,
    diagnostics,
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_TOOL_BROKER_VERSION,
  BuilderHarnessToolBrokerError,
  createBuilderHarnessToolBrokerServer,
});
