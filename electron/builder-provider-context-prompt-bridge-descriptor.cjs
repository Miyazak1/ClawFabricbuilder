'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  BUILDER_GENERATED_OPERATIONS_KIND,
  MAX_GENERATED_TEXT_BYTES,
  createBuilderGenerationPromptDescriptorWithProviderContext,
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  sanitizeBuilderProviderContextPromptBridgeAdmission,
} = require('./builder-provider-context-prompt-bridge-admission.cjs');

const PROVIDER_CONTEXT_PROMPT_BRIDGE_DESCRIPTOR_VERSION =
  'builder-provider-context-prompt-bridge-descriptor.v1';
const PROVIDER_CONTEXT_PROMPT_VERSION = 'builder-code-project.v3.provider-context-bridge';

const INPUT_KEYS = Object.freeze([
  'request',
  'base_source_tree',
  'conversation_events',
  'provider_context_prompt_bridge_admission',
  'built_at_ms',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'descriptor_id',
  'project_id',
  'request_id',
  'prompt_version',
  'prompt_descriptor',
  'source_ref',
  'built_at_ms',
  'authority',
]);
const PROMPT_DESCRIPTOR_KEYS = Object.freeze([
  'version',
  'request_id',
  'prompt_version',
  'system_instruction',
  'user_instruction',
  'output_contract',
  'max_generated_text_bytes',
]);
const OUTPUT_CONTRACT_KEYS = Object.freeze([
  'kind',
  'exact_keys',
  'operation_keys',
  'format',
]);
const SOURCE_REF_KEYS = Object.freeze([
  'prompt_bridge_admission_id',
  'context_digest',
  'provider_config_digest',
  'admitted_at_ms',
  'consent_expires_at_ms',
]);
const AUTHORITY_KEYS = Object.freeze([
  'prompt_bridge_descriptor',
  'generation_kernel',
  'prompt_bridge_admission',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'ipc_registration',
  'secret_access',
]);

const AUTHORITY = Object.freeze({
  prompt_bridge_descriptor: 'main_only_prompt_descriptor_from_verified_context_admission_v1',
  generation_kernel: 'explicit_provider_context_prompt_descriptor_variant_v1',
  prompt_bridge_admission: 'caller_provided_verified',
  renderer_authority: 'not_accepted',
  provider_context_body: 'main_only_prompt_descriptor_body',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_performed',
  ipc_registration: 'not_performed',
  secret_access: 'not_accessed',
});

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-provider-context-prompt-bridge-admission:[0-9a-f]{64}$/u;
const DESCRIPTOR_ID_PATTERN = /^builder-provider-context-prompt-bridge-descriptor:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/iu;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const COMMON_SECRET_VALUE_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/u;

class BuilderProviderContextPromptBridgeDescriptorError extends Error {
  constructor() {
    super('The provider context prompt bridge descriptor could not be verified.');
    this.name = 'BuilderProviderContextPromptBridgeDescriptorError';
    this.code = 'builder_provider_context_prompt_bridge_descriptor_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProviderContextPromptBridgeDescriptorError(); }

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
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safePromptText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 256 * 1024
    || Buffer.byteLength(value, 'utf8') > 512 * 1024
    || UNSAFE_UNICODE_FORMAT_PATTERN.test(value)
    || CREDENTIAL_ASSIGNMENT_PATTERN.test(value)
    || AUTHORIZATION_VALUE_PATTERN.test(value)
    || PRIVATE_KEY_PATTERN.test(value)
    || COMMON_SECRET_VALUE_PATTERN.test(value)
  ) fail();
  return value;
}

function sanitizeStringArray(value, expected) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== expected.length) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  return freezeDeep(expected.map((item, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    if (descriptor.value !== item) fail();
    return item;
  }));
}

function sanitizeOutputContract(value) {
  const source = exactObject(value, OUTPUT_CONTRACT_KEYS);
  return freezeDeep({
    kind: valueAt(source, 'kind') === BUILDER_GENERATED_OPERATIONS_KIND
      ? BUILDER_GENERATED_OPERATIONS_KIND
      : fail(),
    exact_keys: sanitizeStringArray(valueAt(source, 'exact_keys'), ['kind', 'title', 'summary', 'operations']),
    operation_keys: sanitizeStringArray(valueAt(source, 'operation_keys'), ['operation', 'path', 'content']),
    format: valueAt(source, 'format') === 'json_object_only' ? 'json_object_only' : fail(),
  });
}

function sanitizePromptDescriptor(value, requestId) {
  const source = exactObject(value, PROMPT_DESCRIPTOR_KEYS);
  return freezeDeep({
    version: valueAt(source, 'version') === BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION
      ? BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION
      : fail(),
    request_id: safePattern(valueAt(source, 'request_id'), DIGEST_PATTERN) === requestId
      ? requestId
      : fail(),
    prompt_version: valueAt(source, 'prompt_version') === PROVIDER_CONTEXT_PROMPT_VERSION
      ? PROVIDER_CONTEXT_PROMPT_VERSION
      : fail(),
    system_instruction: safePromptText(valueAt(source, 'system_instruction')),
    user_instruction: safePromptText(valueAt(source, 'user_instruction')),
    output_contract: sanitizeOutputContract(valueAt(source, 'output_contract')),
    max_generated_text_bytes: valueAt(source, 'max_generated_text_bytes') === MAX_GENERATED_TEXT_BYTES
      ? MAX_GENERATED_TEXT_BYTES
      : fail(),
  });
}

function sanitizeSourceRef(value) {
  const source = exactObject(value, SOURCE_REF_KEYS);
  const admittedAtMs = safeTimestamp(valueAt(source, 'admitted_at_ms'));
  const consentExpiresAtMs = safeTimestamp(valueAt(source, 'consent_expires_at_ms'));
  if (admittedAtMs >= consentExpiresAtMs) fail();
  return freezeDeep({
    prompt_bridge_admission_id: safePattern(valueAt(source, 'prompt_bridge_admission_id'), ADMISSION_ID_PATTERN),
    context_digest: safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN),
    provider_config_digest: safePattern(valueAt(source, 'provider_config_digest'), DIGEST_PATTERN),
    admitted_at_ms: admittedAtMs,
    consent_expires_at_ms: consentExpiresAtMs,
  });
}

function sanitizeAuthority(value) {
  const source = exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(source) !== canonicalJson(AUTHORITY)) fail();
  return freezeDeep({ ...AUTHORITY });
}

function sanitizeRequest(value) {
  try {
    return sanitizeBuilderGenerationRequest(value);
  } catch {
    fail();
  }
}

function sanitizeAdmission(value) {
  try {
    return sanitizeBuilderProviderContextPromptBridgeAdmission(value);
  } catch {
    fail();
  }
}

function descriptorFromInput(input, request, admission) {
  try {
    return createBuilderGenerationPromptDescriptorWithProviderContext({
      request,
      base_source_tree: valueAt(input, 'base_source_tree'),
      conversation_events: valueAt(input, 'conversation_events'),
      provider_context_prompt_bridge_admission: admission,
    });
  } catch {
    fail();
  }
}

function bodyFor(input, request, admission, builtAtMs) {
  if (
    request.existing_project_id === null
    || request.existing_project_id !== admission.project_id
    || admission.admitted_at_ms > builtAtMs
    || admission.source_ref.consent_expires_at_ms <= builtAtMs
  ) fail();
  const promptDescriptor = descriptorFromInput(input, request, admission);
  const sourceRef = freezeDeep({
    prompt_bridge_admission_id: admission.admission_id,
    context_digest: admission.source_ref.context_digest,
    provider_config_digest: admission.provider_config_digest,
    admitted_at_ms: admission.admitted_at_ms,
    consent_expires_at_ms: admission.source_ref.consent_expires_at_ms,
  });
  return freezeDeep({
    project_id: request.existing_project_id,
    request_id: request.request_digest,
    prompt_version: promptDescriptor.prompt_version,
    prompt_descriptor: sanitizePromptDescriptor(promptDescriptor, request.request_digest),
    source_ref: sourceRef,
    built_at_ms: builtAtMs,
  });
}

function withDescriptorId(body) {
  return freezeDeep({
    result_version: PROVIDER_CONTEXT_PROMPT_BRIDGE_DESCRIPTOR_VERSION,
    descriptor_id: digestId('builder-provider-context-prompt-bridge-descriptor', body),
    ...body,
    authority: { ...AUTHORITY },
  });
}

function createBuilderProviderContextPromptBridgeDescriptor(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  const request = sanitizeRequest(valueAt(input, 'request'));
  const admission = sanitizeAdmission(valueAt(input, 'provider_context_prompt_bridge_admission'));
  const builtAtMs = safeTimestamp(valueAt(input, 'built_at_ms'));
  return withDescriptorId(bodyFor(input, request, admission, builtAtMs));
}

function sanitizeBuilderProviderContextPromptBridgeDescriptor(value) {
  const source = exactObject(value, RESULT_KEYS);
  if (valueAt(source, 'result_version') !== PROVIDER_CONTEXT_PROMPT_BRIDGE_DESCRIPTOR_VERSION) fail();
  const requestId = safePattern(valueAt(source, 'request_id'), DIGEST_PATTERN);
  const sourceRef = sanitizeSourceRef(valueAt(source, 'source_ref'));
  const builtAtMs = safeTimestamp(valueAt(source, 'built_at_ms'));
  const body = freezeDeep({
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    request_id: requestId,
    prompt_version: valueAt(source, 'prompt_version') === PROVIDER_CONTEXT_PROMPT_VERSION
      ? PROVIDER_CONTEXT_PROMPT_VERSION
      : fail(),
    prompt_descriptor: sanitizePromptDescriptor(valueAt(source, 'prompt_descriptor'), requestId),
    source_ref: sourceRef,
    built_at_ms: builtAtMs,
  });
  if (
    body.prompt_descriptor.prompt_version !== body.prompt_version
    || sourceRef.admitted_at_ms > builtAtMs
    || sourceRef.consent_expires_at_ms <= builtAtMs
  ) fail();
  const normalized = withDescriptorId(body);
  if (
    valueAt(source, 'descriptor_id') !== normalized.descriptor_id
    || safePattern(valueAt(source, 'descriptor_id'), DESCRIPTOR_ID_PATTERN) !== normalized.descriptor_id
  ) fail();
  return freezeDeep({
    ...normalized,
    authority: sanitizeAuthority(valueAt(source, 'authority')),
  });
}

module.exports = freezeDeep({
  PROVIDER_CONTEXT_PROMPT_BRIDGE_DESCRIPTOR_VERSION,
  BuilderProviderContextPromptBridgeDescriptorError,
  createBuilderProviderContextPromptBridgeDescriptor,
  sanitizeBuilderProviderContextPromptBridgeDescriptor,
});
