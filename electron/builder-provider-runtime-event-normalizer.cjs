'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  CURRENT_TRANSPORT_VERSION,
  sanitizeBuilderProviderProtocolAdapterDescriptor,
} = require('./builder-provider-protocol-adapter-descriptor.cjs');

const BUILDER_PROVIDER_ADAPTER_EVENT_VERSION = 'builder-provider-adapter-event.v1';
const BUILDER_PROVIDER_RUNTIME_EVENT_VERSION = 'builder-provider-runtime-event.v1';

const INPUT_KEYS = Object.freeze([
  'provider_protocol_adapter_descriptor',
  'adapter_event',
  'normalized_at_ms',
]);
const ADAPTER_EVENT_KEYS = Object.freeze([
  'event_version',
  'event_kind',
  'event_index',
  'occurred_at_ms',
  'payload',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'normalized_event_id',
  'adapter_descriptor_id',
  'provider_config_digest',
  'protocol_family',
  'transport_version',
  'event_kind',
  'event_index',
  'occurred_at_ms',
  'normalized_at_ms',
  'payload',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'runtime_event_normalizer',
  'adapter_descriptor',
  'renderer_authority',
  'raw_provider_envelope',
  'provider_prompt',
  'credential_readback',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'prompt_bridge',
]);

const REQUEST_STARTED_PAYLOAD_KEYS = Object.freeze(['request_mode']);
const TEXT_DELTA_PAYLOAD_KEYS = Object.freeze(['delta_text']);
const RESPONSE_COMPLETED_PAYLOAD_KEYS = Object.freeze(['transport_version', 'generated_text']);
const RESPONSE_FAILED_PAYLOAD_KEYS = Object.freeze(['failure_code', 'retryable']);
const NORMALIZED_REQUEST_STARTED_KEYS = Object.freeze(['request_mode']);
const NORMALIZED_TEXT_DELTA_KEYS = Object.freeze(['display_delta_text', 'display_delta_bytes']);
const NORMALIZED_COMPLETED_KEYS = Object.freeze([
  'transport_version',
  'generated_text_digest',
  'generated_text_bytes',
]);
const NORMALIZED_FAILED_KEYS = Object.freeze(['failure_code', 'retryable']);

const AUTHORITY = Object.freeze({
  runtime_event_normalizer: 'main_side_provider_runtime_event_normalizer_v1',
  adapter_descriptor: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  raw_provider_envelope: 'not_accepted',
  provider_prompt: 'not_included',
  credential_readback: 'not_performed',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
  prompt_bridge: 'not_enabled',
});

const EVENT_KINDS = Object.freeze([
  'request_started',
  'text_delta',
  'response_completed',
  'response_failed',
]);
const NORMALIZED_EVENT_KINDS = Object.freeze([
  'provider_request_started',
  'provider_text_delta',
  'provider_response_completed',
  'provider_response_failed',
]);
const FAILURE_CODES = Object.freeze([
  'cancelled',
  'timeout',
  'http_error',
  'transport_error',
  'structured_response_invalid',
  'provider_unavailable',
  'provider_failed',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DESCRIPTOR_ID_PATTERN = /^builder-provider-protocol-adapter-descriptor:[0-9a-f]{64}$/u;
const NORMALIZED_EVENT_ID_PATTERN = /^builder-provider-runtime-event:[0-9a-f]{64}$/u;
const MAX_DELTA_BYTES = 16 * 1024;
const MAX_GENERATED_TEXT_BYTES = 2 * 1024 * 1024;

class BuilderProviderRuntimeEventNormalizerError extends Error {
  constructor() {
    super('AI provider runtime event could not be verified.');
    this.name = 'BuilderProviderRuntimeEventNormalizerError';
    this.code = 'builder_provider_runtime_event_normalizer_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderRuntimeEventNormalizerError(); }

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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function digestId(prefix, value) {
  return `${prefix}:${digest(value).slice('sha256:'.length)}`;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeEventIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeDescriptorId(value) {
  if (typeof value !== 'string' || !DESCRIPTOR_ID_PATTERN.test(value)) fail();
  return value;
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

function safeText(value, maximumBytes, allowEmpty) {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || hasUnpairedSurrogate(value)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  return value;
}

function safeEventKind(value) {
  if (typeof value !== 'string' || !EVENT_KINDS.includes(value)) fail();
  return value;
}

function safeNormalizedEventKind(value) {
  if (typeof value !== 'string' || !NORMALIZED_EVENT_KINDS.includes(value)) fail();
  return value;
}

function safeRequestMode(value) {
  if (value !== 'streaming' && value !== 'non_streaming') fail();
  return value;
}

function safeFailureCode(value) {
  if (typeof value !== 'string' || !FAILURE_CODES.includes(value)) fail();
  return value;
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function sanitizeAdapterEvent(value) {
  const source = exactObject(value, ADAPTER_EVENT_KEYS);
  if (valueAt(source, 'event_version') !== BUILDER_PROVIDER_ADAPTER_EVENT_VERSION) fail();
  return freezeDeep({
    event_version: BUILDER_PROVIDER_ADAPTER_EVENT_VERSION,
    event_kind: safeEventKind(valueAt(source, 'event_kind')),
    event_index: safeEventIndex(valueAt(source, 'event_index')),
    occurred_at_ms: safeTimestamp(valueAt(source, 'occurred_at_ms')),
    payload: valueAt(source, 'payload'),
  });
}

function ensureStreamAllowed(descriptor) {
  if (
    !descriptor.required_capabilities.includes('streaming')
    || descriptor.stream_shape.kind !== 'sse_choices_delta'
    || descriptor.stream_shape.status !== 'current_transport'
  ) fail();
}

function normalizePayload(descriptor, adapterEvent) {
  if (adapterEvent.event_kind === 'request_started') {
    const source = exactObject(adapterEvent.payload, REQUEST_STARTED_PAYLOAD_KEYS);
    const requestMode = safeRequestMode(valueAt(source, 'request_mode'));
    if (requestMode === 'streaming') ensureStreamAllowed(descriptor);
    return freezeDeep({
      event_kind: 'provider_request_started',
      payload: { request_mode: requestMode },
    });
  }
  if (adapterEvent.event_kind === 'text_delta') {
    ensureStreamAllowed(descriptor);
    const source = exactObject(adapterEvent.payload, TEXT_DELTA_PAYLOAD_KEYS);
    const text = safeText(valueAt(source, 'delta_text'), MAX_DELTA_BYTES, false);
    return freezeDeep({
      event_kind: 'provider_text_delta',
      payload: {
        display_delta_text: text,
        display_delta_bytes: Buffer.byteLength(text, 'utf8'),
      },
    });
  }
  if (adapterEvent.event_kind === 'response_completed') {
    const source = exactObject(adapterEvent.payload, RESPONSE_COMPLETED_PAYLOAD_KEYS);
    if (valueAt(source, 'transport_version') !== CURRENT_TRANSPORT_VERSION) fail();
    const text = safeText(valueAt(source, 'generated_text'), MAX_GENERATED_TEXT_BYTES, false);
    return freezeDeep({
      event_kind: 'provider_response_completed',
      payload: {
        transport_version: CURRENT_TRANSPORT_VERSION,
        generated_text_digest: digestText(text),
        generated_text_bytes: Buffer.byteLength(text, 'utf8'),
      },
    });
  }
  if (adapterEvent.event_kind === 'response_failed') {
    const source = exactObject(adapterEvent.payload, RESPONSE_FAILED_PAYLOAD_KEYS);
    const retryable = valueAt(source, 'retryable');
    if (typeof retryable !== 'boolean') fail();
    return freezeDeep({
      event_kind: 'provider_response_failed',
      payload: {
        failure_code: safeFailureCode(valueAt(source, 'failure_code')),
        retryable,
      },
    });
  }
  fail();
}

function normalizeBuilderProviderRuntimeEvent(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const descriptor = sanitizeBuilderProviderProtocolAdapterDescriptor(
      valueAt(input, 'provider_protocol_adapter_descriptor'),
    );
    const adapterEvent = sanitizeAdapterEvent(valueAt(input, 'adapter_event'));
    const normalizedAtMs = safeTimestamp(valueAt(input, 'normalized_at_ms'));
    if (adapterEvent.occurred_at_ms > normalizedAtMs) fail();
    const normalized = normalizePayload(descriptor, adapterEvent);
    const body = freezeDeep({
      adapter_descriptor_id: descriptor.descriptor_id,
      provider_config_digest: descriptor.provider_config_digest,
      protocol_family: descriptor.protocol_family,
      transport_version: descriptor.transport_version,
      event_kind: normalized.event_kind,
      event_index: adapterEvent.event_index,
      occurred_at_ms: adapterEvent.occurred_at_ms,
      normalized_at_ms: normalizedAtMs,
      payload: normalized.payload,
    });
    return freezeDeep({
      result_version: BUILDER_PROVIDER_RUNTIME_EVENT_VERSION,
      normalized_event_id: digestId('builder-provider-runtime-event', body),
      ...body,
      authority: { ...AUTHORITY },
    });
  } catch (error) {
    if (error instanceof BuilderProviderRuntimeEventNormalizerError) throw error;
    fail();
  }
}

function sanitizePayloadForKind(eventKind, value) {
  if (eventKind === 'provider_request_started') {
    const source = exactObject(value, NORMALIZED_REQUEST_STARTED_KEYS);
    return freezeDeep({ request_mode: safeRequestMode(valueAt(source, 'request_mode')) });
  }
  if (eventKind === 'provider_text_delta') {
    const source = exactObject(value, NORMALIZED_TEXT_DELTA_KEYS);
    const text = safeText(valueAt(source, 'display_delta_text'), MAX_DELTA_BYTES, false);
    const bytes = valueAt(source, 'display_delta_bytes');
    if (!Number.isSafeInteger(bytes) || bytes !== Buffer.byteLength(text, 'utf8')) fail();
    return freezeDeep({ display_delta_text: text, display_delta_bytes: bytes });
  }
  if (eventKind === 'provider_response_completed') {
    const source = exactObject(value, NORMALIZED_COMPLETED_KEYS);
    const bytes = valueAt(source, 'generated_text_bytes');
    if (valueAt(source, 'transport_version') !== CURRENT_TRANSPORT_VERSION) fail();
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_GENERATED_TEXT_BYTES) fail();
    return freezeDeep({
      transport_version: CURRENT_TRANSPORT_VERSION,
      generated_text_digest: safeDigest(valueAt(source, 'generated_text_digest')),
      generated_text_bytes: bytes,
    });
  }
  if (eventKind === 'provider_response_failed') {
    const source = exactObject(value, NORMALIZED_FAILED_KEYS);
    const retryable = valueAt(source, 'retryable');
    if (typeof retryable !== 'boolean') fail();
    return freezeDeep({
      failure_code: safeFailureCode(valueAt(source, 'failure_code')),
      retryable,
    });
  }
  fail();
}

function sanitizeBuilderProviderRuntimeEvent(value) {
  try {
    const source = exactObject(value, RESULT_KEYS);
    if (valueAt(source, 'result_version') !== BUILDER_PROVIDER_RUNTIME_EVENT_VERSION) fail();
    const eventKind = safeNormalizedEventKind(valueAt(source, 'event_kind'));
    const body = freezeDeep({
      adapter_descriptor_id: safeDescriptorId(valueAt(source, 'adapter_descriptor_id')),
      provider_config_digest: safeDigest(valueAt(source, 'provider_config_digest')),
      protocol_family: valueAt(source, 'protocol_family') === 'openai_chat_completions.v1'
        ? 'openai_chat_completions.v1'
        : (() => { fail(); })(),
      transport_version: valueAt(source, 'transport_version') === CURRENT_TRANSPORT_VERSION
        ? CURRENT_TRANSPORT_VERSION
        : (() => { fail(); })(),
      event_kind: eventKind,
      event_index: safeEventIndex(valueAt(source, 'event_index')),
      occurred_at_ms: safeTimestamp(valueAt(source, 'occurred_at_ms')),
      normalized_at_ms: safeTimestamp(valueAt(source, 'normalized_at_ms')),
      payload: sanitizePayloadForKind(eventKind, valueAt(source, 'payload')),
    });
    if (body.occurred_at_ms > body.normalized_at_ms) fail();
    const normalizedEventId = valueAt(source, 'normalized_event_id');
    if (
      typeof normalizedEventId !== 'string'
      || !NORMALIZED_EVENT_ID_PATTERN.test(normalizedEventId)
      || digestId('builder-provider-runtime-event', body) !== normalizedEventId
    ) fail();
    return freezeDeep({
      result_version: BUILDER_PROVIDER_RUNTIME_EVENT_VERSION,
      normalized_event_id: normalizedEventId,
      ...body,
      authority: safeAuthority(valueAt(source, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderProviderRuntimeEventNormalizerError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_ADAPTER_EVENT_VERSION,
  BUILDER_PROVIDER_RUNTIME_EVENT_VERSION,
  BuilderProviderRuntimeEventNormalizerError,
  normalizeBuilderProviderRuntimeEvent,
  sanitizeBuilderProviderRuntimeEvent,
});
