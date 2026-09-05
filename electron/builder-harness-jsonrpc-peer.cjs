'use strict';

const { types: utilTypes } = require('node:util');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');

const BUILDER_HARNESS_JSONRPC_PEER_VERSION = 'builder-harness-jsonrpc-peer.v1';
const OPTION_KEYS = Object.freeze([
  'input',
  'output',
  'on_notification',
  'request_timeouts',
  'set_timeout',
  'clear_timeout',
]);
const REQUEST_TIMEOUT_KEYS = Object.freeze([
  'initialize_ms',
  'session_prompt_ms',
  'shutdown_ms',
]);
const REQUEST_KEYS = Object.freeze(['method', 'params']);
const REQUEST_METHODS = Object.freeze([
  'initialize',
  'session/prompt',
  'session/resume',
  'session/recover-empty-output',
  'session/compact',
  'shutdown',
]);
const NOTIFICATION_METHODS = Object.freeze([
  'session.event',
  'session.status',
  'session.context-usage',
  'subagent.started',
  'subagent.finished',
]);
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 64;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

class BuilderHarnessJsonRpcPeerError extends Error {
  constructor(code = 'builder_harness_jsonrpc_invalid') {
    const selected = [
      'builder_harness_jsonrpc_invalid',
      'builder_harness_jsonrpc_closed',
      'builder_harness_jsonrpc_timeout',
      'builder_harness_jsonrpc_protocol_error',
      'builder_harness_jsonrpc_remote_error',
    ].includes(code) ? code : 'builder_harness_jsonrpc_invalid';
    const messages = {
      builder_harness_jsonrpc_invalid: 'The Harness protocol request could not be verified.',
      builder_harness_jsonrpc_closed: 'The Harness protocol connection is closed.',
      builder_harness_jsonrpc_timeout: 'The Harness protocol request timed out.',
      builder_harness_jsonrpc_protocol_error: 'The Harness runtime returned an invalid protocol frame.',
      builder_harness_jsonrpc_remote_error: 'The Harness runtime rejected the protocol request.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessJsonRpcPeerError';
    this.code = selected;
    this.retryable = selected === 'builder_harness_jsonrpc_timeout';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderHarnessJsonRpcPeerError(code);
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeRequestTimeouts(value) {
  const descriptors = exactObject(value, REQUEST_TIMEOUT_KEYS);
  const promptTimeout = descriptors.session_prompt_ms.value;
  if (promptTimeout !== null) safeInteger(promptTimeout, 100, 60 * 60 * 1_000);
  return Object.freeze({
    initialize_ms: safeInteger(descriptors.initialize_ms.value, 100, 5 * 60 * 1_000),
    session_prompt_ms: promptTimeout,
    shutdown_ms: safeInteger(descriptors.shutdown_ms.value, 100, 60_000),
  });
}

function safeJson(value, depth = 0) {
  if (depth > 64) fail();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (utilTypes.isProxy(value) || value.length > 10_000) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol')
      || keys.length !== value.length + 1
      || !keys.includes('length')
    ) fail();
    return value.map((entry, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
      return safeJson(descriptor.value, depth + 1);
    });
  }
  if (!isPlainObject(value)) fail();
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 10_000 || keys.some((key) => typeof key !== 'string')) fail();
  for (const key of keys) {
    if (FORBIDDEN_JSON_KEYS.has(key)) fail();
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    result[key] = safeJson(descriptor.value, depth + 1);
  }
  return result;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function trustedInput(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.write === 'function';
}

function trustedOutput(value) {
  return value !== null
    && typeof value === 'object'
    && !utilTypes.isProxy(value)
    && typeof value.on === 'function'
    && typeof value.off === 'function';
}

function createBuilderHarnessJsonRpcPeer(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const input = options.input.value;
  const output = options.output.value;
  const onNotification = options.on_notification.value;
  const requestTimeouts = safeRequestTimeouts(options.request_timeouts.value);
  const setTimer = options.set_timeout.value;
  const clearTimer = options.clear_timeout.value;
  if (
    !trustedInput(input)
    || !trustedOutput(output)
    || typeof onNotification !== 'function'
    || utilTypes.isProxy(onNotification)
    || typeof setTimer !== 'function'
    || utilTypes.isProxy(setTimer)
    || typeof clearTimer !== 'function'
    || utilTypes.isProxy(clearTimer)
  ) fail();

  const pending = new Map();
  let nextRequestId = 1;
  let incoming = Buffer.alloc(0);
  let closed = false;
  let notificationChain = Promise.resolve();

  function rejectPending(code) {
    for (const request of pending.values()) {
      if (request.timer !== null) {
        try { Reflect.apply(clearTimer, undefined, [request.timer]); } catch { /* settled below */ }
      }
      request.reject(new BuilderHarnessJsonRpcPeerError(code));
    }
    pending.clear();
  }

  function detach() {
    output.off('data', handleData);
    output.off('end', handleEnd);
    output.off('close', handleEnd);
    output.off('error', handleError);
  }

  function closeWith(code) {
    if (closed) return;
    closed = true;
    detach();
    incoming = Buffer.alloc(0);
    rejectPending(code);
  }

  function protocolFailure() {
    closeWith('builder_harness_jsonrpc_protocol_error');
  }

  function settleResponse(frame) {
    return builderPerformanceTrace.measureSync(
      'main.harness_jsonrpc.settle_response.duration_ms',
      () => settleResponseImpl(frame),
    );
  }

  function settleResponseImpl(frame) {
    const keys = Reflect.ownKeys(frame);
    const hasResult = keys.includes('result');
    const hasError = keys.includes('error');
    if (
      frame.jsonrpc !== '2.0'
      || !Number.isSafeInteger(frame.id)
      || frame.id < 1
      || hasResult === hasError
      || keys.length !== 3
    ) {
      protocolFailure();
      return;
    }
    const request = pending.get(frame.id);
    if (request === undefined) {
      protocolFailure();
      return;
    }
    pending.delete(frame.id);
    try {
      if (request.timer !== null) Reflect.apply(clearTimer, undefined, [request.timer]);
    } catch {
      request.reject(
        new BuilderHarnessJsonRpcPeerError('builder_harness_jsonrpc_protocol_error'),
      );
      protocolFailure();
      return;
    }
    if (hasError) {
      if (!isPlainObject(frame.error) || !Number.isInteger(frame.error.code)) {
        protocolFailure();
        return;
      }
      request.reject(new BuilderHarnessJsonRpcPeerError('builder_harness_jsonrpc_remote_error'));
      return;
    }
    request.resolve(freezeDeep(safeJson(frame.result)));
  }

  function deliverNotification(frame) {
    return builderPerformanceTrace.measureSync(
      'main.harness_jsonrpc.dispatch_notification.duration_ms',
      () => deliverNotificationImpl(frame),
    );
  }

  function deliverNotificationImpl(frame) {
    const keys = Reflect.ownKeys(frame);
    if (
      frame.jsonrpc !== '2.0'
      || keys.length !== 3
      || !keys.includes('method')
      || !keys.includes('params')
      || typeof frame.method !== 'string'
      || !NOTIFICATION_METHODS.includes(frame.method)
    ) {
      protocolFailure();
      return;
    }
    const notification = freezeDeep({
      method: frame.method,
      params: safeJson(frame.params),
    });
    notificationChain = notificationChain.then(
      () => Promise.resolve(Reflect.apply(onNotification, undefined, [notification])),
    ).catch(() => {
      protocolFailure();
    });
  }

  function handleFrame(line) {
    if (line.length === 0) {
      protocolFailure();
      return;
    }
    let frame;
    try {
      frame = builderPerformanceTrace.measureSync(
        'main.harness_jsonrpc.parse_frame.duration_ms',
        () => safeJson(JSON.parse(UTF8_DECODER.decode(line))),
      );
    } catch {
      protocolFailure();
      return;
    }
    if (!isPlainObject(frame)) {
      protocolFailure();
      return;
    }
    const keys = Reflect.ownKeys(frame);
    if (keys.includes('id') && !keys.includes('method')) settleResponse(frame);
    else if (!keys.includes('id') && keys.includes('method')) deliverNotification(frame);
    else protocolFailure();
  }

  function handleData(rawChunk) {
    return builderPerformanceTrace.measureSync(
      'main.harness_jsonrpc.handle_data.duration_ms',
      () => handleDataImpl(rawChunk),
    );
  }

  function handleDataImpl(rawChunk) {
    if (closed) return;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    incoming = Buffer.concat([incoming, chunk]);
    if (incoming.length > MAX_FRAME_BYTES && incoming.indexOf(0x0a) < 0) {
      protocolFailure();
      return;
    }
    let newline = incoming.indexOf(0x0a);
    while (newline >= 0 && !closed) {
      let line = incoming.subarray(0, newline);
      incoming = incoming.subarray(newline + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, line.length - 1);
      if (line.length > MAX_FRAME_BYTES) {
        protocolFailure();
        return;
      }
      handleFrame(line);
      newline = incoming.indexOf(0x0a);
    }
  }

  function handleEnd() {
    closeWith('builder_harness_jsonrpc_closed');
  }

  function handleError() {
    closeWith('builder_harness_jsonrpc_closed');
  }

  output.on('data', handleData);
  output.on('end', handleEnd);
  output.on('close', handleEnd);
  output.on('error', handleError);

  async function request(rawRequest) {
    return await builderPerformanceTrace.measureAsync(
      'main.harness_jsonrpc.request.duration_ms',
      () => requestImpl(rawRequest),
    );
  }

  async function requestImpl(rawRequest) {
    if (closed) fail('builder_harness_jsonrpc_closed');
    if (pending.size >= MAX_PENDING_REQUESTS) fail();
    const descriptors = exactObject(rawRequest, REQUEST_KEYS);
    const method = descriptors.method.value;
    if (typeof method !== 'string' || !REQUEST_METHODS.includes(method)) fail();
    const params = method === 'shutdown'
      ? (descriptors.params.value === null ? null : fail())
      : safeJson(descriptors.params.value);
    const id = nextRequestId;
    nextRequestId += 1;
    const frame = builderPerformanceTrace.measureSync(
      'main.harness_jsonrpc.request_serialize.duration_ms',
      () => JSON.stringify(method === 'shutdown'
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params }),
    );
    if (Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) fail();

    const timeoutMs = {
      initialize: requestTimeouts.initialize_ms,
      'session/prompt': requestTimeouts.session_prompt_ms,
      'session/recover-empty-output': requestTimeouts.session_prompt_ms,
      'session/compact': requestTimeouts.session_prompt_ms,
      'session/resume': requestTimeouts.initialize_ms,
      shutdown: requestTimeouts.shutdown_ms,
    }[method];

    return new Promise((resolve, reject) => {
      let timer = null;
      try {
        if (timeoutMs !== null) {
          timer = Reflect.apply(setTimer, undefined, [() => {
            const active = pending.get(id);
            if (active === undefined) return;
            pending.delete(id);
            active.reject(new BuilderHarnessJsonRpcPeerError('builder_harness_jsonrpc_timeout'));
          }, timeoutMs]);
        }
        pending.set(id, { resolve, reject, timer });
        const accepted = builderPerformanceTrace.measureSync(
          'main.harness_jsonrpc.request_write.duration_ms',
          () => Reflect.apply(input.write, input, [`${frame}\n`, 'utf8']),
        );
        if (accepted !== true && accepted !== false) throw new Error('invalid_write_result');
      } catch {
        if (pending.has(id)) {
          pending.delete(id);
          if (timer !== null) {
            try { Reflect.apply(clearTimer, undefined, [timer]); } catch { /* fixed failure below */ }
          }
        }
        reject(new BuilderHarnessJsonRpcPeerError('builder_harness_jsonrpc_closed'));
        closeWith('builder_harness_jsonrpc_closed');
      }
    });
  }

  function close() {
    closeWith('builder_harness_jsonrpc_closed');
  }

  return Object.freeze({
    peer_version: BUILDER_HARNESS_JSONRPC_PEER_VERSION,
    request,
    close,
    is_closed() { return closed; },
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_JSONRPC_PEER_VERSION,
  MAX_FRAME_BYTES,
  BuilderHarnessJsonRpcPeerError,
  createBuilderHarnessJsonRpcPeer,
});
