'use strict';

const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_HARNESS_JSONRPC_PEER_VERSION,
  createBuilderHarnessJsonRpcPeer,
} = require('./builder-harness-jsonrpc-peer.cjs');
const {
  BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
} = require('./builder-harness-process-adapter.cjs');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');

const BUILDER_HARNESS_PROCESS_HOST_VERSION = 'builder-harness-process-host.v1';
const OPTION_KEYS = Object.freeze([
  'process_adapter',
  'launch',
  'initialize',
  'on_notification',
  'request_timeouts',
  'shutdown_grace_ms',
  'eof_grace_ms',
  'set_timeout',
  'clear_timeout',
]);
const LAUNCH_KEYS = Object.freeze(['executable', 'args', 'cwd', 'env']);
const INITIALIZE_KEYS = Object.freeze(['cwd', 'provider', 'model', 'max_tokens']);
const PROMPT_KEYS = Object.freeze(['session_id', 'text']);
const REQUEST_TIMEOUT_KEYS = Object.freeze([
  'initialize_ms',
  'session_prompt_ms',
  'shutdown_ms',
]);
const MAX_STDERR_BYTES = 32 * 1_024;
const PROCESS_LIVENESS_POLL_MS = 250;

class BuilderHarnessProcessHostError extends Error {
  constructor(code = 'builder_harness_process_host_failed') {
    const selected = [
      'builder_harness_process_host_failed',
      'builder_harness_process_host_conflict',
      'builder_harness_process_host_closed',
      'builder_harness_process_host_handshake_failed',
      'builder_harness_process_host_runtime_failed',
    ].includes(code) ? code : 'builder_harness_process_host_failed';
    const messages = {
      builder_harness_process_host_failed: 'The Harness runtime could not be started.',
      builder_harness_process_host_conflict: 'The Harness runtime is already active.',
      builder_harness_process_host_closed: 'The Harness runtime is closed.',
      builder_harness_process_host_handshake_failed: 'The Harness runtime identity could not be verified.',
      builder_harness_process_host_runtime_failed: 'The Harness runtime stopped unexpectedly.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessProcessHostError';
    this.code = selected;
    this.retryable = selected === 'builder_harness_process_host_runtime_failed';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderHarnessProcessHostError(code); }

async function measureTraceWindow(windowName, metricName, callback) {
  const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
  try {
    return await builderPerformanceTrace.measureAsync(metricName, callback);
  } finally {
    if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
  }
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function safeIdentifier(value, maximum = 160) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.normalize('NFC') !== value
    || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/u.test(value)
  ) fail();
  return value;
}

function safeText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > 256 * 1_024
    || /[\p{Cf}\p{Bidi_Control}]/u.test(value)
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x08
      || (code >= 0x0b && code <= 0x1f)
      || (code >= 0x7f && code <= 0x9f)
    ) fail();
  }
  return value;
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeRequestTimeouts(rawValue) {
  const value = exactObject(rawValue, REQUEST_TIMEOUT_KEYS);
  const promptTimeout = value.session_prompt_ms.value;
  if (promptTimeout !== null) safeInteger(promptTimeout, 100, 60 * 60 * 1_000);
  return Object.freeze({
    initialize_ms: safeInteger(value.initialize_ms.value, 100, 5 * 60 * 1_000),
    session_prompt_ms: promptTimeout,
    shutdown_ms: safeInteger(value.shutdown_ms.value, 100, 60_000),
  });
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function safeLaunch(rawValue) {
  const value = exactObject(rawValue, LAUNCH_KEYS);
  return {
    executable: safeAbsolutePath(value.executable.value),
    args: value.args.value,
    cwd: safeAbsolutePath(value.cwd.value),
    env: value.env.value,
  };
}

function safeInitialize(rawValue, launchCwd) {
  const value = exactObject(rawValue, INITIALIZE_KEYS);
  const cwd = safeAbsolutePath(value.cwd.value);
  if (cwd !== launchCwd) fail();
  const maxTokens = value.max_tokens.value;
  if (maxTokens !== null) safeInteger(maxTokens, 256, 2_000_000);
  return {
    cwd,
    provider: safeIdentifier(value.provider.value),
    model: safeIdentifier(value.model.value),
    max_tokens: maxTokens,
  };
}

function createBuilderHarnessProcessHost(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const processAdapter = options.process_adapter.value;
  const spawnRuntime = serviceMethod(
    processAdapter,
    'adapter_version',
    BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
    'spawn_runtime',
  );
  const terminateProcessTree = serviceMethod(
    processAdapter,
    'adapter_version',
    BUILDER_HARNESS_PROCESS_ADAPTER_VERSION,
    'terminate_process_tree',
  );
  const launch = safeLaunch(options.launch.value);
  const initialize = safeInitialize(options.initialize.value, launch.cwd);
  const onNotification = options.on_notification.value;
  const setTimer = options.set_timeout.value;
  const clearTimer = options.clear_timeout.value;
  if (
    typeof onNotification !== 'function'
    || utilTypes.isProxy(onNotification)
    || typeof setTimer !== 'function'
    || utilTypes.isProxy(setTimer)
    || typeof clearTimer !== 'function'
    || utilTypes.isProxy(clearTimer)
  ) fail();
  const requestTimeouts = safeRequestTimeouts(options.request_timeouts.value);
  const shutdownGraceMs = safeInteger(options.shutdown_grace_ms.value, 100, 60_000);
  const eofGraceMs = safeInteger(options.eof_grace_ms.value, 100, 60_000);

  let child = null;
  let peer = null;
  let state = 'idle';
  let exited = false;
  let exitCode = null;
  let stopProcessLivenessProbe = null;
  let resolveTermination;
  const termination = new Promise((resolve) => { resolveTermination = resolve; });
  let terminationSettled = false;
  let stderrBytes = 0;
  let stderrTruncated = false;
  function handleStderr(chunk) {
    const bytes = Buffer.byteLength(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    stderrBytes += bytes;
    if (stderrBytes > MAX_STDERR_BYTES) stderrTruncated = true;
  }

  function settleTermination(reason) {
    if (terminationSettled) return;
    terminationSettled = true;
    resolveTermination(Object.freeze({
      reason,
      exit_code: exitCode,
    }));
  }

  function handleExit(code) {
    if (exited) return;
    exited = true;
    exitCode = Number.isInteger(code) ? code : null;
    if (stopProcessLivenessProbe !== null) {
      stopProcessLivenessProbe();
      stopProcessLivenessProbe = null;
    }
    if (peer !== null) peer.close();
    if (state !== 'closing') state = 'closed';
    settleTermination('process_exit');
  }

  function runtimeProcessAppearsAlive() {
    if (child === null || exited) return false;
    if (child.exitCode !== null || child.signalCode !== null) return false;
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) return false;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (error) {
      return error !== null
        && typeof error === 'object'
        && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'EPERM';
    }
  }

  function beginRuntimeProcessLivenessProbe() {
    let stopped = false;
    let timer = null;
    const probe = () => {
      timer = null;
      if (stopped || state !== 'ready') return;
      if (!runtimeProcessAppearsAlive()) {
        handleExit(child?.exitCode);
        return;
      }
      timer = Reflect.apply(setTimer, undefined, [probe, PROCESS_LIVENESS_POLL_MS]);
    };
    timer = Reflect.apply(setTimer, undefined, [probe, PROCESS_LIVENESS_POLL_MS]);
    return () => {
      stopped = true;
      if (timer === null) return;
      try { Reflect.apply(clearTimer, undefined, [timer]); } catch { /* request settlement remains authoritative */ }
      timer = null;
    };
  }

  function waitForExit(timeoutMs) {
    if (exited || child === null) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        child.off('exit', onExit);
        child.off('close', onClose);
        try { Reflect.apply(clearTimer, undefined, [timer]); } catch { /* result is still bounded */ }
        resolve(value);
      };
      const onExit = () => finish(true);
      const onClose = () => finish(true);
      child.once('exit', onExit);
      child.once('close', onClose);
      timer = Reflect.apply(setTimer, undefined, [() => finish(false), timeoutMs]);
    });
  }

  async function forceClose(reason) {
    if (stopProcessLivenessProbe !== null) {
      stopProcessLivenessProbe();
      stopProcessLivenessProbe = null;
    }
    if (peer !== null) peer.close();
    if (child !== null) {
      try { child.stdin.end(); } catch { /* process termination remains authoritative */ }
      try { await terminateProcessTree({ child, reason }); } catch { /* fixed host state below */ }
    }
    state = 'closed';
    settleTermination(reason);
  }

  async function request(method, params) {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_process_host.request.duration_ms',
      () => requestImpl(method, params),
    );
  }

  async function requestImpl(method, params) {
    if (peer === null || state === 'closed') fail('builder_harness_process_host_closed');
    try {
      return await peer.request({ method, params });
    } catch {
      if (peer.is_closed()) await forceClose('protocol_error');
      fail('builder_harness_process_host_runtime_failed');
    }
  }

  async function start() {
    return await measureTraceWindow(
      'harness_process_host_initialize',
      'main.harness_process_host.initialize.duration_ms',
      startImpl,
    );
  }

  async function startImpl() {
    if (state === 'ready') fail('builder_harness_process_host_conflict');
    if (state !== 'idle') fail('builder_harness_process_host_closed');
    state = 'starting';
    try {
      child = spawnRuntime(launch);
      child.stderr.on('data', handleStderr);
      child.once('exit', handleExit);
      child.once('close', handleExit);
      child.once('error', () => handleExit(null));
      peer = createBuilderHarnessJsonRpcPeer({
        input: child.stdin,
        output: child.stdout,
        on_notification: onNotification,
        request_timeouts: requestTimeouts,
        set_timeout: setTimer,
        clear_timeout: clearTimer,
      });
      if (peer.peer_version !== BUILDER_HARNESS_JSONRPC_PEER_VERSION) fail();
      const params = {
        cwd: initialize.cwd,
        provider: initialize.provider,
        model: initialize.model,
        ...(initialize.max_tokens === null ? {} : { maxTokens: initialize.max_tokens }),
      };
      const result = await peer.request({ method: 'initialize', params });
      let response;
      let serverInfo;
      try {
        response = exactObject(result, ['serverInfo']);
        serverInfo = exactObject(response.serverInfo.value, ['name', 'version']);
      } catch {
        fail('builder_harness_process_host_handshake_failed');
      }
      if (
        serverInfo.name.value !== 'deepseek-harness-sdk-runtime'
        || typeof serverInfo.version.value !== 'string'
        || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(serverInfo.version.value)
      ) fail('builder_harness_process_host_handshake_failed');
      state = 'ready';
      stopProcessLivenessProbe = beginRuntimeProcessLivenessProbe();
      return Object.freeze({
        host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
        runtime_name: serverInfo.name.value,
        runtime_version: serverInfo.version.value,
        protocol: 'newline_jsonrpc_2.0',
      });
    } catch (error) {
      await forceClose(error instanceof BuilderHarnessProcessHostError
        && error.code === 'builder_harness_process_host_handshake_failed'
        ? 'protocol_error'
        : 'spawn_failed');
      if (error instanceof BuilderHarnessProcessHostError) throw error;
      fail('builder_harness_process_host_handshake_failed');
    }
  }

  async function prompt(rawRequest) {
    return await measureTraceWindow(
      'harness_process_host_prompt',
      'main.harness_process_host.prompt.duration_ms',
      () => promptImpl(rawRequest),
    );
  }

  async function promptImpl(rawRequest) {
    if (state !== 'ready') fail('builder_harness_process_host_closed');
    const requestValue = exactObject(rawRequest, PROMPT_KEYS);
    const sessionId = safeIdentifier(requestValue.session_id.value, 240);
    const text = safeText(requestValue.text.value);
    const result = await request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    });
    const response = exactObject(result, ['messageId']);
    return Object.freeze({
      session_id: sessionId,
      message_id: safeIdentifier(response.messageId.value, 240),
    });
  }

  async function shutdown() {
    if (state === 'closed' || state === 'idle') {
      state = 'closed';
      return false;
    }
    if (state === 'closing') return false;
    state = 'closing';
    if (stopProcessLivenessProbe !== null) {
      stopProcessLivenessProbe();
      stopProcessLivenessProbe = null;
    }
    try {
      if (peer !== null && !peer.is_closed()) {
        try { await peer.request({ method: 'shutdown', params: null }); } catch { /* ladder continues */ }
      }
      if (await waitForExit(shutdownGraceMs)) return true;
      try { child.stdin.end(); } catch { /* ladder continues */ }
      if (await waitForExit(eofGraceMs)) return true;
      await forceClose('shutdown');
      return true;
    } finally {
      state = 'closed';
    }
  }

  async function cancel() {
    if (state === 'closed' || state === 'idle') return false;
    state = 'closing';
    if (stopProcessLivenessProbe !== null) {
      stopProcessLivenessProbe();
      stopProcessLivenessProbe = null;
    }
    await forceClose('cancelled');
    return true;
  }

  function diagnostics() {
    return Object.freeze({
      host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
      state,
      exited,
      exit_code: exitCode,
      stderr_bytes: stderrBytes,
      stderr_truncated: stderrTruncated,
      stderr_content: 'redacted',
    });
  }

  return Object.freeze({
    host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
    start,
    prompt,
    when_terminated() { return termination; },
    shutdown,
    cancel,
    diagnostics,
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_PROCESS_HOST_VERSION,
  BuilderHarnessProcessHostError,
  createBuilderHarnessProcessHost,
});
