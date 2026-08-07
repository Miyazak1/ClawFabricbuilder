'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');

const BUILDER_PROVIDER_CAPABILITY_MANIFEST_VERSION =
  'builder-provider-capability-manifest.v1';
const BUILDER_PROVIDER_CAPABILITY_ADMISSION_VERSION =
  'builder-provider-capability-admission.v1';

const INPUT_KEYS = Object.freeze(['provider_config', 'protocol_family', 'assessed_at_ms']);
const MANIFEST_BODY_KEYS = Object.freeze([
  'provider_config_digest',
  'display_name',
  'protocol_family',
  'base_url_policy',
  'model_id',
  'streaming',
  'json_output',
  'tool_calling',
  'reasoning_output',
  'prompt_cache_reporting',
  'hosted_conversation_state',
  'max_input_tokens',
  'max_output_tokens',
  'timeout_ms',
  'retry_policy',
  'known_limitations',
  'assessed_at_ms',
]);
const MANIFEST_KEYS = Object.freeze([
  'result_version',
  'manifest_id',
  ...MANIFEST_BODY_KEYS,
  'authority',
]);
const RETRY_POLICY_KEYS = Object.freeze(['max_attempts', 'retryable_errors']);
const AUTHORITY_KEYS = Object.freeze([
  'provider_registry',
  'provider_settings',
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
const ADMISSION_INPUT_KEYS = Object.freeze([
  'provider_capability_manifest',
  'required_capabilities',
  'expected_provider_config_digest',
  'assessed_at_ms',
]);
const ADMISSION_BODY_KEYS = Object.freeze([
  'provider_capability_manifest_id',
  'provider_config_digest',
  'protocol_family',
  'required_capabilities',
  'capability_status',
  'assessed_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'result_version',
  'admission_id',
  ...ADMISSION_BODY_KEYS,
  'authority',
]);

const CURRENT_PROTOCOL_FAMILY = 'openai_chat_completions.v1';
const CAPABILITY_NAMES = Object.freeze([
  'streaming',
  'json_output',
  'tool_calling',
  'reasoning_output',
  'prompt_cache_reporting',
  'hosted_conversation_state',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MANIFEST_ID_PATTERN = /^builder-provider-capability-manifest:[0-9a-f]{64}$/u;

const AUTHORITY = Object.freeze({
  provider_registry: 'main_side_provider_capability_manifest_v1',
  provider_settings: 'caller_provided_verified',
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

class BuilderProviderCapabilityManifestError extends Error {
  constructor() {
    super('AI provider capabilities could not be verified.');
    this.name = 'BuilderProviderCapabilityManifestError';
    this.code = 'builder_provider_capability_manifest_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderCapabilityManifestError(); }

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

function safeProtocolFamily(value) {
  if (value !== CURRENT_PROTOCOL_FAMILY) fail();
  return value;
}

function safeCapabilityName(value) {
  if (typeof value !== 'string' || !CAPABILITY_NAMES.includes(value)) fail();
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function safeNullableTokenLimit(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function safeRetryPolicy(value) {
  const source = exactObject(value, RETRY_POLICY_KEYS);
  const maxAttempts = valueAt(source, 'max_attempts');
  const retryableErrors = valueAt(source, 'retryable_errors');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) fail();
  if (!Array.isArray(retryableErrors) || utilTypes.isProxy(retryableErrors)) fail();
  const keys = Reflect.ownKeys(retryableErrors);
  const expectedKeys = [...retryableErrors.map((_, index) => String(index)), 'length'];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) fail();
  const values = retryableErrors.map((entry) => {
    if (
      entry !== 'timeout'
      && entry !== 'transport_error'
      && entry !== 'provider_unavailable'
      && entry !== 'http_retryable'
    ) fail();
    return entry;
  });
  if (new Set(values).size !== values.length) fail();
  return freezeDeep({ max_attempts: maxAttempts, retryable_errors: values });
}

function safeKnownLimitations(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 20) fail();
  const keys = Reflect.ownKeys(value);
  const expectedKeys = [...value.map((_, index) => String(index)), 'length'];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) fail();
  return freezeDeep(value.map((entry) => {
    if (
      typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 160
      || entry.trim() !== entry
    ) fail();
    for (let index = 0; index < entry.length; index += 1) {
      const code = entry.charCodeAt(index);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) fail();
    }
    return entry;
  }));
}

function safeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function manifestBodyFor(config, protocolFamily, assessedAtMs) {
  if (protocolFamily !== CURRENT_PROTOCOL_FAMILY) fail();
  return freezeDeep({
    provider_config_digest: config.config_digest,
    display_name: 'OpenAI-compatible Chat Completions',
    protocol_family: CURRENT_PROTOCOL_FAMILY,
    base_url_policy: 'https_or_loopback_http',
    model_id: config.model,
    streaming: true,
    json_output: true,
    tool_calling: false,
    reasoning_output: false,
    prompt_cache_reporting: false,
    hosted_conversation_state: false,
    max_input_tokens: null,
    max_output_tokens: config.max_tokens,
    timeout_ms: config.timeout_ms,
    retry_policy: {
      max_attempts: 1,
      retryable_errors: ['timeout', 'transport_error', 'provider_unavailable'],
    },
    known_limitations: [
      'No provider-managed conversation state is used as Builder authority.',
      'Provider tool calls are not enabled for local actions.',
      'Provider usage and cache metrics are not surfaced by this adapter yet.',
    ],
    assessed_at_ms: assessedAtMs,
  });
}

function manifestWithId(body) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CAPABILITY_MANIFEST_VERSION,
    manifest_id: digestId('builder-provider-capability-manifest', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderCapabilityManifest(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const config = sanitizeBuilderProviderConfig(valueAt(input, 'provider_config'));
    const protocolFamily = safeProtocolFamily(valueAt(input, 'protocol_family'));
    const assessedAtMs = safeTimestamp(valueAt(input, 'assessed_at_ms'));
    return manifestWithId(manifestBodyFor(config, protocolFamily, assessedAtMs));
  } catch (error) {
    if (error instanceof BuilderProviderCapabilityManifestError) throw error;
    fail();
  }
}

function sanitizeManifestBody(source) {
  return freezeDeep({
    provider_config_digest: safeDigest(valueAt(source, 'provider_config_digest')),
    display_name: valueAt(source, 'display_name') === 'OpenAI-compatible Chat Completions'
      ? 'OpenAI-compatible Chat Completions'
      : (() => { fail(); })(),
    protocol_family: safeProtocolFamily(valueAt(source, 'protocol_family')),
    base_url_policy: valueAt(source, 'base_url_policy') === 'https_or_loopback_http'
      ? 'https_or_loopback_http'
      : (() => { fail(); })(),
    model_id: (() => {
      const model = valueAt(source, 'model_id');
      if (typeof model !== 'string' || model.length === 0 || model.length > 200 || model.trim() !== model) fail();
      return model;
    })(),
    streaming: safeBoolean(valueAt(source, 'streaming')),
    json_output: safeBoolean(valueAt(source, 'json_output')),
    tool_calling: safeBoolean(valueAt(source, 'tool_calling')),
    reasoning_output: safeBoolean(valueAt(source, 'reasoning_output')),
    prompt_cache_reporting: safeBoolean(valueAt(source, 'prompt_cache_reporting')),
    hosted_conversation_state: safeBoolean(valueAt(source, 'hosted_conversation_state')),
    max_input_tokens: safeNullableTokenLimit(valueAt(source, 'max_input_tokens')),
    max_output_tokens: safeNullableTokenLimit(valueAt(source, 'max_output_tokens')),
    timeout_ms: (() => {
      const timeoutMs = valueAt(source, 'timeout_ms');
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) fail();
      return timeoutMs;
    })(),
    retry_policy: safeRetryPolicy(valueAt(source, 'retry_policy')),
    known_limitations: safeKnownLimitations(valueAt(source, 'known_limitations')),
    assessed_at_ms: safeTimestamp(valueAt(source, 'assessed_at_ms')),
  });
}

function sanitizeBuilderProviderCapabilityManifest(value) {
  try {
    const source = exactObject(value, MANIFEST_KEYS);
    if (valueAt(source, 'result_version') !== BUILDER_PROVIDER_CAPABILITY_MANIFEST_VERSION) fail();
    const body = sanitizeManifestBody(source);
    const manifestId = valueAt(source, 'manifest_id');
    if (typeof manifestId !== 'string' || !MANIFEST_ID_PATTERN.test(manifestId)) fail();
    if (digestId('builder-provider-capability-manifest', body) !== manifestId) fail();
    const authority = safeAuthority(valueAt(source, 'authority'));
    return freezeDeep({
      result_version: BUILDER_PROVIDER_CAPABILITY_MANIFEST_VERSION,
      manifest_id: manifestId,
      ...body,
      authority,
    });
  } catch (error) {
    if (error instanceof BuilderProviderCapabilityManifestError) throw error;
    fail();
  }
}

function safeRequiredCapabilities(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length === 0 || value.length > CAPABILITY_NAMES.length) {
    fail();
  }
  const keys = Reflect.ownKeys(value);
  const expectedKeys = [...value.map((_, index) => String(index)), 'length'];
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) fail();
  const capabilities = value.map(safeCapabilityName);
  if (new Set(capabilities).size !== capabilities.length) fail();
  return freezeDeep(capabilities);
}

function admissionBodyFor(manifest, requiredCapabilities, assessedAtMs) {
  if (manifest.assessed_at_ms > assessedAtMs) fail();
  for (const capability of requiredCapabilities) {
    if (manifest[capability] !== true) fail();
  }
  return freezeDeep({
    provider_capability_manifest_id: manifest.manifest_id,
    provider_config_digest: manifest.provider_config_digest,
    protocol_family: manifest.protocol_family,
    required_capabilities: requiredCapabilities,
    capability_status: 'ready',
    assessed_at_ms: assessedAtMs,
  });
}

function admitBuilderProviderCapabilities(rawInput) {
  try {
    const input = exactObject(rawInput, ADMISSION_INPUT_KEYS);
    const manifest = sanitizeBuilderProviderCapabilityManifest(valueAt(input, 'provider_capability_manifest'));
    const expectedDigest = safeDigest(valueAt(input, 'expected_provider_config_digest'));
    if (manifest.provider_config_digest !== expectedDigest) fail();
    const requiredCapabilities = safeRequiredCapabilities(valueAt(input, 'required_capabilities'));
    const assessedAtMs = safeTimestamp(valueAt(input, 'assessed_at_ms'));
    const body = admissionBodyFor(manifest, requiredCapabilities, assessedAtMs);
    return freezeDeep({
      result_version: BUILDER_PROVIDER_CAPABILITY_ADMISSION_VERSION,
      admission_id: digestId('builder-provider-capability-admission', body),
      ...body,
      authority: { ...AUTHORITY },
    });
  } catch (error) {
    if (error instanceof BuilderProviderCapabilityManifestError) throw error;
    fail();
  }
}

function sanitizeBuilderProviderCapabilityAdmission(value) {
  try {
    const source = exactObject(value, ADMISSION_KEYS);
    if (valueAt(source, 'result_version') !== BUILDER_PROVIDER_CAPABILITY_ADMISSION_VERSION) fail();
    const body = freezeDeep({
      provider_capability_manifest_id: (() => {
        const id = valueAt(source, 'provider_capability_manifest_id');
        if (typeof id !== 'string' || !MANIFEST_ID_PATTERN.test(id)) fail();
        return id;
      })(),
      provider_config_digest: safeDigest(valueAt(source, 'provider_config_digest')),
      protocol_family: safeProtocolFamily(valueAt(source, 'protocol_family')),
      required_capabilities: safeRequiredCapabilities(valueAt(source, 'required_capabilities')),
      capability_status: valueAt(source, 'capability_status') === 'ready' ? 'ready' : (() => { fail(); })(),
      assessed_at_ms: safeTimestamp(valueAt(source, 'assessed_at_ms')),
    });
    const admissionId = valueAt(source, 'admission_id');
    if (
      typeof admissionId !== 'string'
      || !/^builder-provider-capability-admission:[0-9a-f]{64}$/u.test(admissionId)
      || digestId('builder-provider-capability-admission', body) !== admissionId
    ) fail();
    return freezeDeep({
      result_version: BUILDER_PROVIDER_CAPABILITY_ADMISSION_VERSION,
      admission_id: admissionId,
      ...body,
      authority: safeAuthority(valueAt(source, 'authority')),
    });
  } catch (error) {
    if (error instanceof BuilderProviderCapabilityManifestError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_CAPABILITY_MANIFEST_VERSION,
  BUILDER_PROVIDER_CAPABILITY_ADMISSION_VERSION,
  CURRENT_PROTOCOL_FAMILY,
  BuilderProviderCapabilityManifestError,
  createBuilderProviderCapabilityManifest,
  sanitizeBuilderProviderCapabilityManifest,
  admitBuilderProviderCapabilities,
  sanitizeBuilderProviderCapabilityAdmission,
});
