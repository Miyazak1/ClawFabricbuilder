'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_PROVIDER_RESPONSE_BYTES,
  BuilderOpenAICompatibleTransportError,
  createBuilderOpenAICompatibleTransport,
} = require('../electron/builder-openai-compatible-transport.cjs');

const PRIVATE_MARKER = 'private-provider-marker-do-not-leak';

function request(overrides = {}) {
  return {
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    credential: 'provider-key-value',
    messages: [
      { role: 'system', content: 'Return one exact JSON object.' },
      { role: 'user', content: 'Build a small timer.' },
    ],
    timeout_ms: 30000,
    ...overrides,
  };
}

function providerPayload(content = '{"kind":"builder_code_project"}') {
  return {
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
  };
}

function response(payload, overrides = {}) {
  const bytes = payload instanceof Uint8Array
    ? payload
    : new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body,
    wasCancelled: () => cancelled,
    ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof BuilderOpenAICompatibleTransportError);
    assert.equal(error.code, code);
    assert.doesNotMatch(`${error.name}:${error.message}:${error.stack}`, /private|provider-key-value|example\/v1/iu);
    return true;
  });
}

test('posts one fixed non-streaming Builder request and returns only bounded generated text', async () => {
  const calls = [];
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(providerPayload());
    },
  });
  const result = await transport(request({ temperature: 0.2, max_tokens: 4096 }));
  assert.deepEqual(result, {
    transport_version: 'builder-openai-compatible-transport.v1',
    generated_text: '{"kind":"builder_code_project"}',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://provider.example/v1/chat/completions');
  const options = calls[0][1];
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer provider-key-value');
  assert.deepEqual(JSON.parse(options.body), {
    model: 'builder-model',
    messages: request().messages,
    stream: false,
    temperature: 0.2,
    max_tokens: 4096,
  });
});

test('allows HTTPS and exact loopback HTTP but rejects credentialed or remote cleartext endpoints', async () => {
  const endpoints = [];
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async (url) => {
      endpoints.push(url);
      return response(providerPayload());
    },
  });
  await transport(request({ base_url: 'http://127.0.0.1:11434/v1' }));
  await transport(request({ base_url: 'http://localhost:8080/api/v1/' }));
  assert.deepEqual(endpoints, [
    'http://127.0.0.1:11434/v1/chat/completions',
    'http://localhost:8080/api/v1/chat/completions',
  ]);
  for (const base_url of [
    'http://provider.example/v1',
    'https://user:pass@provider.example/v1',
    'https://provider.example/v1?key=value',
  ]) {
    await expectCode(transport(request({ base_url })), 'builder_provider_request_invalid');
  }
  assert.equal(endpoints.length, 2);
});

test('rejects malformed, extra, accessor, proxy, and oversized request authority before fetch', async () => {
  let calls = 0;
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => { calls += 1; return response(providerPayload()); },
  });
  const cases = [
    { ...request(), extra: true },
    { ...request(), timeout_ms: 999 },
    { ...request(), temperature: 3 },
    { ...request(), max_tokens: 0 },
    { ...request(), messages: [{ role: 'user', content: 'wrong' }] },
    { ...request(), model: 'x'.repeat(201) },
    new Proxy(request(), {}),
  ];
  const accessor = request();
  Object.defineProperty(accessor, 'model', { enumerable: true, get() { throw new Error(PRIVATE_MARKER); } });
  cases.push(accessor);
  const messageAccessor = request();
  Object.defineProperty(messageAccessor.messages, '0', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  cases.push(messageAccessor);
  for (const candidate of cases) {
    await expectCode(transport(candidate), 'builder_provider_request_invalid');
  }
  assert.equal(calls, 0);
});

test('maps explicit cancellation and timeout to distinct fixed errors', async () => {
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(PRIVATE_MARKER)), { once: true });
  });
  const cancelTransport = createBuilderOpenAICompatibleTransport({ fetchImpl });
  const controller = new AbortController();
  const pending = cancelTransport(request(), { signal: controller.signal });
  controller.abort();
  await expectCode(pending, 'builder_provider_cancelled');

  let timeoutCallback;
  const timeoutTransport = createBuilderOpenAICompatibleTransport({
    fetchImpl,
    setTimeoutImpl(callback) { timeoutCallback = callback; return 1; },
    clearTimeoutImpl() {},
  });
  const timed = timeoutTransport(request());
  timeoutCallback();
  await expectCode(timed, 'builder_provider_timeout');
});

test('rejects pre-aborted control before fetch and actively cancels stalled response bodies', async () => {
  let fetchCalls = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => { fetchCalls += 1; return response(providerPayload()); },
  });
  await expectCode(transport(request(), { signal: preAborted.signal }), 'builder_provider_cancelled');
  assert.equal(fetchCalls, 0);

  let cancelBody = false;
  let timeoutCallback;
  const stalledBody = new ReadableStream({ cancel() { cancelBody = true; } });
  const stalled = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: stalledBody,
      };
    },
    setTimeoutImpl(callback) { timeoutCallback = callback; return 2; },
    clearTimeoutImpl() {},
  });
  const pending = stalled(request());
  await Promise.resolve();
  timeoutCallback();
  await expectCode(pending, 'builder_provider_timeout');
  assert.equal(cancelBody, true);
  assert.equal(fetchCalls, 1);
});

test('cancels a stalled response body when the caller aborts after headers arrive', async () => {
  let cancelBody = false;
  const body = new ReadableStream({ cancel() { cancelBody = true; } });
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body,
    }),
  });
  const controller = new AbortController();
  const pending = transport(request(), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expectCode(pending, 'builder_provider_cancelled');
  assert.equal(cancelBody, true);
});

test('rejects forged control and contains timer or cleanup failures behind fixed errors', async () => {
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => response(providerPayload()),
  });
  const controller = new AbortController();
  await expectCode(
    transport(request(), new Proxy({ signal: controller.signal }, {})),
    'builder_provider_request_invalid',
  );
  const accessor = {};
  Object.defineProperty(accessor, 'signal', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  await expectCode(transport(request(), accessor), 'builder_provider_request_invalid');

  const brokenTimer = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => response(providerPayload()),
    setTimeoutImpl() { throw new Error(PRIVATE_MARKER); },
    clearTimeoutImpl() {},
  });
  await expectCode(brokenTimer(request()), 'builder_provider_unavailable');

  const cleanupFailure = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => response(providerPayload()),
    setTimeoutImpl() { return 3; },
    clearTimeoutImpl() { throw new Error(PRIVATE_MARKER); },
  });
  await assert.doesNotReject(cleanupFailure(request()));
});

test('fails before reading when canonical Content-Length exceeds the fixed response budget', async () => {
  const oversized = response(providerPayload(), {
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': String(MAX_PROVIDER_RESPONSE_BYTES + 1),
    }),
  });
  const transport = createBuilderOpenAICompatibleTransport({ fetchImpl: async () => oversized });
  await expectCode(transport(request()), 'builder_provider_response_too_large');
  assert.equal(oversized.wasCancelled(), true);
});

test('cancels a streamed body as soon as accumulated bytes exceed the fixed response budget', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body,
    }),
  });
  await expectCode(transport(request()), 'builder_provider_response_too_large');
  assert.equal(cancelled, true);
});

test('rejects unreadable bodies, malformed lengths, media types, UTF-8, JSON, and HTTP failures', async () => {
  const invalidUtf8 = Uint8Array.from([0xc3, 0x28]);
  const cases = [
    { value: { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: null }, code: 'builder_provider_response_invalid' },
    { value: response(providerPayload(), { headers: new Headers({ 'content-type': 'application/json', 'content-length': '01' }) }), code: 'builder_provider_response_invalid' },
    { value: response(providerPayload(), { headers: new Headers({ 'content-type': 'text/plain' }) }), code: 'builder_provider_response_invalid' },
    { value: response(invalidUtf8), code: 'builder_provider_response_invalid' },
    { value: response('{not-json'), code: 'builder_provider_response_invalid' },
    { value: response(providerPayload(), { ok: false, status: 500 }), code: 'builder_provider_failed' },
  ];
  for (const candidate of cases) {
    const transport = createBuilderOpenAICompatibleTransport({ fetchImpl: async () => candidate.value });
    await expectCode(transport(request()), candidate.code);
  }
});

test('rejects provider choice drift and never returns provider metadata or usage', async () => {
  const cases = [
    {},
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'tool', content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] },
  ];
  for (const payload of cases) {
    const transport = createBuilderOpenAICompatibleTransport({ fetchImpl: async () => response(payload) });
    await expectCode(transport(request()), 'builder_provider_response_invalid');
  }
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => response({
      id: PRIVATE_MARKER,
      model: PRIVATE_MARKER,
      usage: { total_tokens: 100 },
      ...providerPayload(),
    }),
  });
  assert.deepEqual(Reflect.ownKeys(await transport(request())), ['transport_version', 'generated_text']);
});

test('returns fixed redacted failures for thrown fetch and missing transport', async () => {
  const transport = createBuilderOpenAICompatibleTransport({
    fetchImpl: async () => { throw new Error(PRIVATE_MARKER); },
  });
  await expectCode(transport(request()), 'builder_provider_failed');
  assert.throws(
    () => createBuilderOpenAICompatibleTransport({ fetchImpl: null }),
    (error) => error.code === 'builder_provider_unavailable' && !String(error).includes(PRIVATE_MARKER),
  );
});

test('contains no legacy dispatcher, renderer, repository, secret store, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-openai-compatible-transport.cjs'),
    'utf8',
  );
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);
  assert.deepEqual(requires, ['node:util', './builder-generation-kernel.cjs']);
  assert.doesNotMatch(
    source,
    /chat_planner|local-provider-executor|generic.*dispatch|ipcMain|ipcRenderer|contextBridge|BrowserWindow|repository|secure-provider|localStorage|sessionStorage|child_process|worker_threads|\beval\s*\(|new Function/iu,
  );
});
