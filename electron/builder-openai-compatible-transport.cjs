'use strict';

const { types: utilTypes } = require('node:util');

const {
  MAX_GENERATED_TEXT_BYTES,
} = require('./builder-generation-kernel.cjs');

const BUILDER_PROVIDER_TRANSPORT_VERSION = 'builder-openai-compatible-transport.v1';
const MAX_PROVIDER_RESPONSE_BYTES = (MAX_GENERATED_TEXT_BYTES * 8) + (64 * 1024);
const MAX_PROMPT_BYTES = MAX_GENERATED_TEXT_BYTES + (64 * 1024);
const REQUEST_KEYS = Object.freeze([
  'base_url',
  'model',
  'credential',
  'messages',
  'timeout_ms',
]);
const OPTIONAL_REQUEST_KEYS = Object.freeze(['temperature', 'max_tokens']);
const MESSAGE_KEYS = Object.freeze(['role', 'content']);
const DEEPSEEK_V4_MODELS = Object.freeze(['deepseek-v4-flash', 'deepseek-v4-pro']);
const ERROR_MESSAGES = Object.freeze({
  builder_provider_request_invalid: 'AI provider settings are invalid.',
  builder_provider_unavailable: 'AI generation is unavailable.',
  builder_provider_cancelled: 'AI generation was cancelled.',
  builder_provider_timeout: 'AI generation timed out.',
  builder_provider_http_error: 'The AI service rejected the request.',
  builder_provider_response_too_large: 'The AI response was too large.',
  builder_provider_structured_response_invalid: 'The AI response could not be used.',
  builder_provider_failed: 'AI generation failed.',
});

class BuilderOpenAICompatibleTransportError extends Error {
  constructor(code = 'builder_provider_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_provider_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderOpenAICompatibleTransportError';
    this.code = selected;
    this.retryable = [
      'builder_provider_unavailable',
      'builder_provider_timeout',
      'builder_provider_failed',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderOpenAICompatibleTransportError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, allowedKeys, requiredKeys, code) {
  if (!isPlainObject(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))
  ) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
  return value;
}

function ownValue(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasDisallowedControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function safeText(value, maximumBytes, code) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximumBytes
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail(code);
  return value;
}

function safePromptText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PROMPT_BYTES
    || hasUnpairedSurrogate(value)
    || Buffer.byteLength(value, 'utf8') > MAX_PROMPT_BYTES
  ) fail('builder_provider_request_invalid');
  return value;
}

function providerEndpoint(value) {
  const text = safeText(value, 2048, 'builder_provider_request_invalid');
  try {
    const parsed = new URL(text);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) fail('builder_provider_request_invalid');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol === 'http:' && !loopback) fail('builder_provider_request_invalid');
    const base = parsed.toString().replace(/\/$/u, '');
    return `${base}/chat/completions`;
  } catch (error) {
    if (error instanceof BuilderOpenAICompatibleTransportError) throw error;
    fail('builder_provider_request_invalid');
  }
}

function sanitizeMessages(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== 2) {
    fail('builder_provider_request_invalid');
  }
  const arrayKeys = Reflect.ownKeys(value);
  if (arrayKeys.length !== 3 || arrayKeys.some((key) => !['0', '1', 'length'].includes(key))) {
    fail('builder_provider_request_invalid');
  }
  const expectedRoles = ['system', 'user'];
  const messages = expectedRoles.map((expectedRole, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_provider_request_invalid');
    }
    const message = descriptor.value;
    exactObject(message, MESSAGE_KEYS, MESSAGE_KEYS, 'builder_provider_request_invalid');
    if (ownValue(message, 'role', 'builder_provider_request_invalid') !== expectedRole) {
      fail('builder_provider_request_invalid');
    }
    return Object.freeze({
      role: expectedRole,
      content: safePromptText(ownValue(message, 'content', 'builder_provider_request_invalid')),
    });
  });
  if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > MAX_PROMPT_BYTES) {
    fail('builder_provider_request_invalid');
  }
  return Object.freeze(messages);
}

function sanitizeRequest(value) {
  const allowed = [...REQUEST_KEYS, ...OPTIONAL_REQUEST_KEYS];
  exactObject(value, allowed, REQUEST_KEYS, 'builder_provider_request_invalid');
  const timeoutMs = ownValue(value, 'timeout_ms', 'builder_provider_request_invalid');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    fail('builder_provider_request_invalid');
  }
  const request = {
    endpoint: providerEndpoint(ownValue(value, 'base_url', 'builder_provider_request_invalid')),
    model: safeText(ownValue(value, 'model', 'builder_provider_request_invalid'), 200, 'builder_provider_request_invalid'),
    credential: safeText(ownValue(value, 'credential', 'builder_provider_request_invalid'), 16 * 1024, 'builder_provider_request_invalid'),
    messages: sanitizeMessages(ownValue(value, 'messages', 'builder_provider_request_invalid')),
    timeout_ms: timeoutMs,
  };
  if (Reflect.ownKeys(value).includes('temperature')) {
    const temperature = ownValue(value, 'temperature', 'builder_provider_request_invalid');
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      fail('builder_provider_request_invalid');
    }
    request.temperature = temperature;
  }
  if (Reflect.ownKeys(value).includes('max_tokens')) {
    const maxTokens = ownValue(value, 'max_tokens', 'builder_provider_request_invalid');
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072) {
      fail('builder_provider_request_invalid');
    }
    request.max_tokens = maxTokens;
  }
  return Object.freeze(request);
}

function providerDialectFields(request) {
  try {
    const endpoint = new URL(request.endpoint);
    if (
      endpoint.protocol === 'https:'
      && endpoint.hostname.toLowerCase() === 'api.deepseek.com'
      && (endpoint.port === '' || endpoint.port === '443')
      && DEEPSEEK_V4_MODELS.includes(request.model)
    ) {
      return { thinking: { type: 'disabled' } };
    }
  } catch {
    // The sanitized request owns endpoint validation; unknown dialects add no fields.
  }
  return {};
}

function responseHeader(response, name) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return '';
  const value = response.headers.get(name);
  return typeof value === 'string' ? value : '';
}

function cancelBody(body) {
  if (!body || typeof body.cancel !== 'function') return;
  try {
    const pending = body.cancel();
    if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
  } catch {
    // Disposal cannot replace the bounded failure.
  }
}

async function readBoundedBody(response, signal, abortCode) {
  const contentLength = responseHeader(response, 'content-length');
  if (contentLength) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      cancelBody(response.body);
      fail('builder_provider_structured_response_invalid');
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > MAX_PROVIDER_RESPONSE_BYTES) {
      cancelBody(response.body);
      fail('builder_provider_response_too_large');
    }
  }
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') fail('builder_provider_structured_response_invalid');
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let shouldCancel = false;
  const cancelForAbort = () => {
    if (typeof reader.cancel !== 'function') return;
    try {
      const pending = reader.cancel();
      if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    } catch {
      // The fixed abort result remains authoritative.
    }
  };
  try {
    signal.addEventListener('abort', cancelForAbort, { once: true });
    if (signal.aborted) {
      cancelForAbort();
      fail(abortCode());
    }
    while (true) {
      const next = await reader.read();
      if (signal.aborted) fail(abortCode());
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || total + next.value.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
        shouldCancel = true;
        fail('builder_provider_response_too_large');
      }
      total += next.value.byteLength;
      chunks.push(next.value);
    }
  } finally {
    try { signal.removeEventListener('abort', cancelForAbort); } catch { /* best-effort cleanup */ }
    if (shouldCancel && typeof reader.cancel === 'function') {
      try { await reader.cancel(); } catch { /* bounded failure remains authoritative */ }
    }
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('builder_provider_structured_response_invalid');
  }
}

function generatedTextFromPayload(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices) || payload.choices.length !== 1) {
    fail('builder_provider_structured_response_invalid');
  }
  const choice = payload.choices[0];
  if (!isPlainObject(choice) || choice.finish_reason !== 'stop' || !isPlainObject(choice.message)) {
    fail('builder_provider_structured_response_invalid');
  }
  if (choice.message.role !== 'assistant') fail('builder_provider_structured_response_invalid');
  const content = choice.message.content;
  if (
    typeof content !== 'string'
    || content.length === 0
    || content.length > MAX_GENERATED_TEXT_BYTES
    || hasUnpairedSurrogate(content)
    || Buffer.byteLength(content, 'utf8') > MAX_GENERATED_TEXT_BYTES
  ) fail('builder_provider_structured_response_invalid');
  return content;
}

function sanitizeControl(value) {
  if (value === undefined) return null;
  exactObject(value, ['signal'], ['signal'], 'builder_provider_request_invalid');
  const signal = ownValue(value, 'signal', 'builder_provider_request_invalid');
  if (
    signal === null
    || typeof signal !== 'object'
    || utilTypes.isProxy(signal)
    || typeof AbortSignal !== 'function'
    || !(signal instanceof AbortSignal)
  ) fail('builder_provider_request_invalid');
  return signal;
}

function createBuilderOpenAICompatibleTransport(options = {}) {
  const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
  const setTimer = options.setTimeoutImpl === undefined ? setTimeout : options.setTimeoutImpl;
  const clearTimer = options.clearTimeoutImpl === undefined ? clearTimeout : options.clearTimeoutImpl;
  if (typeof fetchImpl !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    fail('builder_provider_unavailable');
  }

  return async function builderOpenAICompatibleTransport(rawRequest, rawControl) {
    const request = sanitizeRequest(rawRequest);
    const callerSignal = sanitizeControl(rawControl);
    const controller = new AbortController();
    let abortSource = '';
    let timer = null;
    let callerListenerInstalled = false;
    const abortCode = () => (
      abortSource === 'timeout' ? 'builder_provider_timeout' : 'builder_provider_cancelled'
    );
    const abortFromCaller = () => {
      if (controller.signal.aborted) return;
      abortSource = 'caller';
      controller.abort();
    };
    try {
      if (callerSignal) {
        if (callerSignal.aborted) abortFromCaller();
        else {
          callerSignal.addEventListener('abort', abortFromCaller, { once: true });
          callerListenerInstalled = true;
        }
      }
      if (controller.signal.aborted) fail(abortCode());
      try {
        timer = setTimer(() => {
          if (controller.signal.aborted) return;
          abortSource = 'timeout';
          controller.abort();
        }, request.timeout_ms);
      } catch {
        fail('builder_provider_unavailable');
      }
      const response = await Reflect.apply(fetchImpl, undefined, [request.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${request.credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          response_format: { type: 'json_object' },
          stream: false,
          ...providerDialectFields(request),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.max_tokens === undefined ? {} : { max_tokens: request.max_tokens }),
        }),
        signal: controller.signal,
      }]);
      if (controller.signal.aborted) fail(abortCode());
      if (
        !response
        || response.ok !== true
        || !Number.isSafeInteger(response.status)
        || response.status < 200
        || response.status >= 300
      ) {
        cancelBody(response?.body);
        fail('builder_provider_http_error');
      }
      const contentType = responseHeader(response, 'content-type').toLowerCase().split(';', 1)[0].trim();
      if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
        cancelBody(response.body);
        fail('builder_provider_structured_response_invalid');
      }
      const text = await readBoundedBody(response, controller.signal, abortCode);
      if (controller.signal.aborted) fail(abortCode());
      let payload;
      try { payload = JSON.parse(text); } catch { fail('builder_provider_structured_response_invalid'); }
      const generatedText = generatedTextFromPayload(payload);
      if (controller.signal.aborted) fail(abortCode());
      return Object.freeze({
        transport_version: BUILDER_PROVIDER_TRANSPORT_VERSION,
        generated_text: generatedText,
      });
    } catch (error) {
      if (controller.signal.aborted) fail(abortCode());
      if (error instanceof BuilderOpenAICompatibleTransportError) throw error;
      fail('builder_provider_failed');
    } finally {
      if (timer !== null) {
        try { clearTimer(timer); } catch { /* cleanup cannot replace the operation result */ }
      }
      if (callerSignal && callerListenerInstalled) {
        try { callerSignal.removeEventListener('abort', abortFromCaller); } catch { /* best-effort cleanup */ }
      }
    }
  };
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_TRANSPORT_VERSION,
  MAX_PROVIDER_RESPONSE_BYTES,
  BuilderOpenAICompatibleTransportError,
  createBuilderOpenAICompatibleTransport,
});
