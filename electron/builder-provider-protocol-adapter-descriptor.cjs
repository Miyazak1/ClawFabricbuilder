'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderCapabilityAdmission,
  sanitizeBuilderProviderCapabilityManifest,
} = require('./builder-provider-capability-manifest.cjs');

const BUILDER_PROVIDER_PROTOCOL_ADAPTER_DESCRIPTOR_VERSION =
  'builder-provider-protocol-adapter-descriptor.v1';
const CURRENT_PROTOCOL_FAMILY = 'openai_chat_completions.v1';
const CURRENT_ADAPTER_ID = 'builder-provider-protocol-adapter:openai-chat-completions-v1';
const CURRENT_TRANSPORT_VERSION = 'builder-openai-compatible-transport.v1';

const INPUT_KEYS = Object.freeze([
  'provider_capability_manifest',
  'provider_capability_admission',
  'adapter_family',
  'described_at_ms',
]);
const DESCRIPTOR_BODY_KEYS = Object.freeze([
  'adapter_id',
  'adapter_family',
  'protocol_family',
  'transport_version',
  'provider_capability_manifest_id',
  'provider_capability_admission_id',
  'provider_config_digest',
  'required_capabilities',
  'request_shape',
  'response_shape',
  'stream_shape',
  'tool_call_shape',
  'usage_shape',
  'known_limitations',
  'described_at_ms',
]);
const DESCRIPTOR_KEYS = Object.freeze([
  'result_version',
  'descriptor_id',
  ...DESCRIPTOR_BODY_KEYS,
  'authority',
]);
const SHAPE_KEYS = Object.freeze(['kind', 'status']);
const AUTHORITY_KEYS = Object.freeze([
  'adapter_descriptor',
  'provider_capability_manifest',
  'provider_capability_admission',
  'credential_readback',
  'renderer_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'prompt_bridge',
]);

const AUTHORITY = Object.freeze({
  adapter_descriptor: 'main_side_provider_protocol_adapter_descriptor_v1',
  provider_capability_manifest: 'caller_provided_verified',
  provider_capability_admission: 'caller_provided_verified',
  credential_readback: 'not_performed',
  renderer_authority: 'not_accepted',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
  prompt_bridge: 'not_enabled',
});

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MANIFEST_ID_PATTERN = /^builder-provider-capability-manifest:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-provider-capability-admission:[0-9a-f]{64}$/u;
const DESCRIPTOR_ID_PATTERN = /^builder-provider-protocol-adapter-descriptor:[0-9a-f]{64}$/u;
const CAPABILITY_NAMES = Object.freeze(['streaming', 'json_output']);

class BuilderProviderProtocolAdapterDescriptorError extends Error {
  constructor() {
    super('AI provider protocol adapter could not be verified.');
    this.name = 'BuilderProviderProtocolAdapterDescriptorError';
    this.code = 'builder_provider_protocol_adapter_descriptor_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderProtocolAdapterDescriptorError(); }

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

function digestId(prefix, value) {
  return `${prefix}:${digest(value).slice('sha256:'.length)}`;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeManifestId(value) {
  if (typeof value !== 'string' || !MANIFEST_ID_PATTERN.test(value)) fail();
  return value;
}

function safeAdmissionId(value) {
  if (typeof value !== 'string' || !ADMISSION_ID_PATTERN.test(value)) fail();
  return value;
}

function safeRequiredCapabilities(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length === 0 || value.length > CAPABILITY_NAMES.length) {
    fail();
  }
  const keys = Reflect.ownKeys(value);
  const expectedKeys = [...value.map((_, index) => String(index)), 'length'];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) fail();
  const capabilities = value.map((entry) => {
    if (typeof entry !== 'string' || !CAPABILITY_NAMES.includes(entry)) fail();
    return entry;
  });
  if (new Set(capabilities).size !== capabilities.length) fail();
  if (!capabilities.includes('json_output')) fail();
  return freezeDeep(capabilities);
}

function safeKnownLimitations(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== 3) fail();
  const keys = Reflect.ownKeys(value);
  const expectedKeys = ['0', '1', '2', 'length'];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) fail();
  const expected = [
    'Adapter descriptor only; no provider dispatch is performed.',
    'Provider tool calls are not normalized as executable local actions.',
    'Usage metrics are not normalized by this descriptor checkpoint.',
  ];
  for (let index = 0; index < expected.length; index += 1) {
    if (value[index] !== expected[index]) fail();
  }
  return freezeDeep([...expected]);
}

function shape(kind, status) {
  return freezeDeep({ kind, status });
}

function safeShape(value, expectedKind, expectedStatus) {
  const source = exactObject(value, SHAPE_KEYS);
  if (valueAt(source, 'kind') !== expectedKind || valueAt(source, 'status') !== expectedStatus) fail();
  return shape(expectedKind, expectedStatus);
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function descriptorBodyFor(manifest, admission, adapterFamily, describedAtMs) {
  if (adapterFamily !== CURRENT_ADAPTER_ID) fail();
  if (manifest.protocol_family !== CURRENT_PROTOCOL_FAMILY || admission.protocol_family !== CURRENT_PROTOCOL_FAMILY) {
    fail();
  }
  if (
    manifest.provider_config_digest !== admission.provider_config_digest
    || manifest.manifest_id !== admission.provider_capability_manifest_id
    || manifest.assessed_at_ms > describedAtMs
    || admission.assessed_at_ms > describedAtMs
  ) fail();
  const requiredCapabilities = safeRequiredCapabilities(admission.required_capabilities);
  return freezeDeep({
    adapter_id: CURRENT_ADAPTER_ID,
    adapter_family: 'openai_compatible_chat_completions',
    protocol_family: CURRENT_PROTOCOL_FAMILY,
    transport_version: CURRENT_TRANSPORT_VERSION,
    provider_capability_manifest_id: manifest.manifest_id,
    provider_capability_admission_id: admission.admission_id,
    provider_config_digest: manifest.provider_config_digest,
    required_capabilities: requiredCapabilities,
    request_shape: shape('messages_json_object', 'current_transport'),
    response_shape: shape('choices_message_content', 'current_transport'),
    stream_shape: requiredCapabilities.includes('streaming')
      ? shape('sse_choices_delta', 'current_transport')
      : shape('not_required', 'not_requested'),
    tool_call_shape: shape('not_admitted', 'blocked_by_capability_manifest'),
    usage_shape: shape('not_normalized', 'not_available'),
    known_limitations: [
      'Adapter descriptor only; no provider dispatch is performed.',
      'Provider tool calls are not normalized as executable local actions.',
      'Usage metrics are not normalized by this descriptor checkpoint.',
    ],
    described_at_ms: describedAtMs,
  });
}

function descriptorWithId(body) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_PROTOCOL_ADAPTER_DESCRIPTOR_VERSION,
    descriptor_id: digestId('builder-provider-protocol-adapter-descriptor', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function describeBuilderProviderProtocolAdapter(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const manifest = sanitizeBuilderProviderCapabilityManifest(valueAt(input, 'provider_capability_manifest'));
    const admission = sanitizeBuilderProviderCapabilityAdmission(valueAt(input, 'provider_capability_admission'));
    const adapterFamily = valueAt(input, 'adapter_family');
    const describedAtMs = safeTimestamp(valueAt(input, 'described_at_ms'));
    return descriptorWithId(descriptorBodyFor(manifest, admission, adapterFamily, describedAtMs));
  } catch (error) {
    if (error instanceof BuilderProviderProtocolAdapterDescriptorError) throw error;
    fail();
  }
}

function descriptorBodyFromSource(source) {
  return freezeDeep({
    adapter_id: valueAt(source, 'adapter_id') === CURRENT_ADAPTER_ID ? CURRENT_ADAPTER_ID : (() => { fail(); })(),
    adapter_family: valueAt(source, 'adapter_family') === 'openai_compatible_chat_completions'
      ? 'openai_compatible_chat_completions'
      : (() => { fail(); })(),
    protocol_family: valueAt(source, 'protocol_family') === CURRENT_PROTOCOL_FAMILY ? CURRENT_PROTOCOL_FAMILY : (() => { fail(); })(),
    transport_version: valueAt(source, 'transport_version') === CURRENT_TRANSPORT_VERSION ? CURRENT_TRANSPORT_VERSION : (() => { fail(); })(),
    provider_capability_manifest_id: safeManifestId(valueAt(source, 'provider_capability_manifest_id')),
    provider_capability_admission_id: safeAdmissionId(valueAt(source, 'provider_capability_admission_id')),
    provider_config_digest: safeDigest(valueAt(source, 'provider_config_digest')),
    required_capabilities: safeRequiredCapabilities(valueAt(source, 'required_capabilities')),
    request_shape: safeShape(valueAt(source, 'request_shape'), 'messages_json_object', 'current_transport'),
    response_shape: safeShape(valueAt(source, 'response_shape'), 'choices_message_content', 'current_transport'),
    stream_shape: (() => {
      const required = safeRequiredCapabilities(valueAt(source, 'required_capabilities'));
      return required.includes('streaming')
        ? safeShape(valueAt(source, 'stream_shape'), 'sse_choices_delta', 'current_transport')
        : safeShape(valueAt(source, 'stream_shape'), 'not_required', 'not_requested');
    })(),
    tool_call_shape: safeShape(valueAt(source, 'tool_call_shape'), 'not_admitted', 'blocked_by_capability_manifest'),
    usage_shape: safeShape(valueAt(source, 'usage_shape'), 'not_normalized', 'not_available'),
    known_limitations: safeKnownLimitations(valueAt(source, 'known_limitations')),
    described_at_ms: safeTimestamp(valueAt(source, 'described_at_ms')),
  });
}

function sanitizeBuilderProviderProtocolAdapterDescriptor(value) {
  try {
    const source = exactObject(value, DESCRIPTOR_KEYS);
    if (valueAt(source, 'result_version') !== BUILDER_PROVIDER_PROTOCOL_ADAPTER_DESCRIPTOR_VERSION) fail();
    const body = descriptorBodyFromSource(source);
    const descriptorId = valueAt(source, 'descriptor_id');
    if (
      typeof descriptorId !== 'string'
      || !DESCRIPTOR_ID_PATTERN.test(descriptorId)
      || digestId('builder-provider-protocol-adapter-descriptor', body) !== descriptorId
    ) fail();
    return freezeDeep({
      result_version: BUILDER_PROVIDER_PROTOCOL_ADAPTER_DESCRIPTOR_VERSION,
      descriptor_id: descriptorId,
      ...body,
      authority: safeAuthority(valueAt(source, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderProviderProtocolAdapterDescriptorError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_PROTOCOL_ADAPTER_DESCRIPTOR_VERSION,
  CURRENT_ADAPTER_ID,
  CURRENT_PROTOCOL_FAMILY,
  CURRENT_TRANSPORT_VERSION,
  BuilderProviderProtocolAdapterDescriptorError,
  describeBuilderProviderProtocolAdapter,
  sanitizeBuilderProviderProtocolAdapterDescriptor,
});
