'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  CONVERSATION_ID_PATTERN,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');

const BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION = 'builder-programming-runtime.v1';
const BUILDER_PROGRAMMING_RUNTIME_DESCRIPTOR_VERSION =
  'builder-programming-runtime-descriptor.v1';
const BUILDER_PROGRAMMING_RUNTIME_RUN_CONTRACT_VERSION =
  'builder-programming-runtime-run-contract.v1';
const BUILDER_PROGRAMMING_WORKSPACE_REF_VERSION =
  'builder-programming-workspace-ref.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID_PATTERNS = Object.freeze({
  project: new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
  conversation: CONVERSATION_ID_PATTERN,
  turn: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  task: new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'),
  run: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  message: new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u'),
  workspace: /^builder-programming-workspace:[0-9a-f]{64}$/u,
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DESCRIPTOR_ID_PATTERN = /^builder-programming-runtime-descriptor:[0-9a-f]{64}$/u;
const RUN_CONTRACT_ID_PATTERN = /^builder-programming-runtime-run-contract:[0-9a-f]{64}$/u;
const RUNTIME_KIND_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/u;
const IMPLEMENTATION_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const UNSAFE_UNICODE_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;

const CAPABILITY_KEYS = Object.freeze([
  'streaming_text',
  'reasoning_status',
  'native_tool_calls',
  'steering',
  'cancellation',
  'session_resume',
  'context_compaction',
  'parallel_read_tools',
]);
const DESCRIPTOR_INPUT_KEYS = Object.freeze([
  'runtime_kind',
  'implementation_version',
  'capabilities',
]);
const DESCRIPTOR_KEYS = Object.freeze([
  'descriptor_version',
  'protocol_version',
  'descriptor_id',
  ...DESCRIPTOR_INPUT_KEYS,
  'descriptor_digest',
]);
const WORKSPACE_REF_KEYS = Object.freeze([
  'ref_version',
  'workspace_id',
  'source_tree_digest',
  'writable',
]);
const LIMIT_KEYS = Object.freeze([
  'max_steps',
  'max_duration_ms',
  'max_model_tokens',
  'max_tool_output_bytes',
]);
const ADMISSION_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'mode',
  'workspace_ref',
  'provider_config_digest',
  'allowed_tools',
  'limits',
  'admitted_at_ms',
]);
const INPUT_KEYS = Object.freeze(['message_id', 'text']);
const RUN_CONTRACT_INPUT_KEYS = Object.freeze([
  'runtime_descriptor',
  'admission',
  'input',
]);
const RUN_CONTRACT_KEYS = Object.freeze([
  'run_contract_version',
  'protocol_version',
  'run_contract_id',
  ...RUN_CONTRACT_INPUT_KEYS,
  'run_contract_digest',
]);

const TOOL_KINDS = Object.freeze([
  'read', 'search', 'edit', 'write', 'command', 'browser', 'question',
]);
const MODE_TOOL_POLICY = Object.freeze({
  ask: Object.freeze(['read', 'search', 'question']),
  plan: Object.freeze(['read', 'search', 'question']),
  build: TOOL_KINDS,
});

class BuilderProgrammingRuntimeContractError extends Error {
  constructor() {
    super('The programming runtime contract could not be verified.');
    this.name = 'BuilderProgrammingRuntimeContractError';
    this.code = 'builder_programming_runtime_contract_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProgrammingRuntimeContractError();
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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
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
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) fail();
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
  ).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestId(prefix, value) {
  return `${prefix}:${sha256Canonical(value).slice('sha256:'.length)}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeEnum(value, values) {
  if (typeof value !== 'string' || !values.includes(value)) fail();
  return value;
}

function safeBoolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function hasUnsafeText(value) {
  if (UNSAFE_UNICODE_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function safeText(value, maximumCodePoints, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnsafeText(value)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  return value;
}

function sanitizeCapabilities(value) {
  const source = exactObject(value, CAPABILITY_KEYS);
  return freezeDeep({
    streaming_text: safeBoolean(valueAt(source, 'streaming_text')),
    reasoning_status: safeEnum(valueAt(source, 'reasoning_status'), ['none', 'bounded_status']),
    native_tool_calls: safeBoolean(valueAt(source, 'native_tool_calls')),
    steering: safeEnum(valueAt(source, 'steering'), ['none', 'queued', 'live']),
    cancellation: safeEnum(
      valueAt(source, 'cancellation'),
      ['cooperative', 'process', 'unsupported'],
    ),
    session_resume: safeEnum(valueAt(source, 'session_resume'), ['none', 'runtime_local']),
    context_compaction: safeBoolean(valueAt(source, 'context_compaction')),
    parallel_read_tools: safeBoolean(valueAt(source, 'parallel_read_tools')),
  });
}

function descriptorBody(value) {
  return freezeDeep({
    descriptor_version: BUILDER_PROGRAMMING_RUNTIME_DESCRIPTOR_VERSION,
    protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
    runtime_kind: safePattern(valueAt(value, 'runtime_kind'), RUNTIME_KIND_PATTERN),
    implementation_version: safePattern(
      valueAt(value, 'implementation_version'),
      IMPLEMENTATION_VERSION_PATTERN,
    ),
    capabilities: sanitizeCapabilities(valueAt(value, 'capabilities')),
  });
}

function createBuilderProgrammingRuntimeDescriptor(rawInput) {
  try {
    const input = exactObject(rawInput, DESCRIPTOR_INPUT_KEYS);
    const body = descriptorBody(input);
    return freezeDeep({
      ...body,
      descriptor_id: digestId('builder-programming-runtime-descriptor', body),
      descriptor_digest: sha256Canonical(body),
    });
  } catch (error) {
    if (error instanceof BuilderProgrammingRuntimeContractError) throw error;
    fail();
  }
}

function sanitizeBuilderProgrammingRuntimeDescriptor(rawValue) {
  try {
    const source = exactObject(rawValue, DESCRIPTOR_KEYS);
    const body = descriptorBody(source);
    const descriptorId = safePattern(valueAt(source, 'descriptor_id'), DESCRIPTOR_ID_PATTERN);
    const descriptorDigest = safePattern(valueAt(source, 'descriptor_digest'), DIGEST_PATTERN);
    if (
      descriptorId !== digestId('builder-programming-runtime-descriptor', body)
      || descriptorDigest !== sha256Canonical(body)
    ) fail();
    return freezeDeep({
      ...body,
      descriptor_id: descriptorId,
      descriptor_digest: descriptorDigest,
    });
  } catch (error) {
    if (error instanceof BuilderProgrammingRuntimeContractError) throw error;
    fail();
  }
}

function sanitizeWorkspaceRef(value, mode) {
  const source = exactObject(value, WORKSPACE_REF_KEYS);
  const writable = safeBoolean(valueAt(source, 'writable'));
  if ((mode === 'build') !== writable) fail();
  return freezeDeep({
    ref_version: valueAt(source, 'ref_version') === BUILDER_PROGRAMMING_WORKSPACE_REF_VERSION
      ? BUILDER_PROGRAMMING_WORKSPACE_REF_VERSION
      : (() => { fail(); })(),
    workspace_id: safePattern(valueAt(source, 'workspace_id'), ID_PATTERNS.workspace),
    source_tree_digest: safePattern(valueAt(source, 'source_tree_digest'), DIGEST_PATTERN),
    writable,
  });
}

function sanitizeAllowedTools(value, mode) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > TOOL_KINDS.length) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const allowed = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const tool = safeEnum(descriptor.value, TOOL_KINDS);
    if (!MODE_TOOL_POLICY[mode].includes(tool) || allowed.includes(tool)) fail();
    allowed.push(tool);
  }
  const expectedOrder = TOOL_KINDS.filter((tool) => allowed.includes(tool));
  if (canonicalJson(allowed) !== canonicalJson(expectedOrder)) fail();
  return freezeDeep(allowed);
}

function sanitizeLimits(value) {
  const source = exactObject(value, LIMIT_KEYS);
  return freezeDeep({
    max_steps: safeInteger(valueAt(source, 'max_steps'), 1, 128),
    max_duration_ms: safeInteger(valueAt(source, 'max_duration_ms'), 1_000, 60 * 60 * 1_000),
    max_model_tokens: safeInteger(valueAt(source, 'max_model_tokens'), 256, 2_000_000),
    max_tool_output_bytes: safeInteger(
      valueAt(source, 'max_tool_output_bytes'),
      1_024,
      16 * 1_024 * 1_024,
    ),
  });
}

function sanitizeAdmission(value) {
  const source = exactObject(value, ADMISSION_KEYS);
  const mode = safeEnum(valueAt(source, 'mode'), ['ask', 'plan', 'build']);
  const projectId = safePattern(valueAt(source, 'project_id'), ID_PATTERNS.project);
  const conversationId = safePattern(valueAt(source, 'conversation_id'), ID_PATTERNS.conversation);
  try {
    sanitizeBuilderConversationAddress(projectId, conversationId);
  } catch {
    fail();
  }
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(valueAt(source, 'turn_id'), ID_PATTERNS.turn),
    task_id: safePattern(valueAt(source, 'task_id'), ID_PATTERNS.task),
    run_id: safePattern(valueAt(source, 'run_id'), ID_PATTERNS.run),
    mode,
    workspace_ref: sanitizeWorkspaceRef(valueAt(source, 'workspace_ref'), mode),
    provider_config_digest: safePattern(
      valueAt(source, 'provider_config_digest'),
      DIGEST_PATTERN,
    ),
    allowed_tools: sanitizeAllowedTools(valueAt(source, 'allowed_tools'), mode),
    limits: sanitizeLimits(valueAt(source, 'limits')),
    admitted_at_ms: safeInteger(valueAt(source, 'admitted_at_ms'), 0, Number.MAX_SAFE_INTEGER),
  });
}

function sanitizeInput(value) {
  const source = exactObject(value, INPUT_KEYS);
  return freezeDeep({
    message_id: safePattern(valueAt(source, 'message_id'), ID_PATTERNS.message),
    text: safeText(valueAt(source, 'text'), 8_192, 32 * 1_024),
  });
}

function runContractBody(value) {
  return freezeDeep({
    run_contract_version: BUILDER_PROGRAMMING_RUNTIME_RUN_CONTRACT_VERSION,
    protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
    runtime_descriptor: sanitizeBuilderProgrammingRuntimeDescriptor(
      valueAt(value, 'runtime_descriptor'),
    ),
    admission: sanitizeAdmission(valueAt(value, 'admission')),
    input: sanitizeInput(valueAt(value, 'input')),
  });
}

function assertCapabilitiesSupportAdmission(descriptor, admission) {
  if (admission.allowed_tools.length > 0 && !descriptor.capabilities.native_tool_calls) fail();
  if (
    descriptor.capabilities.cancellation === 'unsupported'
    && admission.mode === 'build'
  ) fail();
}

function createBuilderProgrammingRuntimeRunContract(rawInput) {
  try {
    const input = exactObject(rawInput, RUN_CONTRACT_INPUT_KEYS);
    const body = runContractBody(input);
    assertCapabilitiesSupportAdmission(body.runtime_descriptor, body.admission);
    return freezeDeep({
      ...body,
      run_contract_id: digestId('builder-programming-runtime-run-contract', body),
      run_contract_digest: sha256Canonical(body),
    });
  } catch (error) {
    if (error instanceof BuilderProgrammingRuntimeContractError) throw error;
    fail();
  }
}

function sanitizeBuilderProgrammingRuntimeRunContract(rawValue) {
  try {
    const source = exactObject(rawValue, RUN_CONTRACT_KEYS);
    const body = runContractBody(source);
    assertCapabilitiesSupportAdmission(body.runtime_descriptor, body.admission);
    const runContractId = safePattern(
      valueAt(source, 'run_contract_id'),
      RUN_CONTRACT_ID_PATTERN,
    );
    const runContractDigest = safePattern(valueAt(source, 'run_contract_digest'), DIGEST_PATTERN);
    if (
      runContractId !== digestId('builder-programming-runtime-run-contract', body)
      || runContractDigest !== sha256Canonical(body)
    ) fail();
    return freezeDeep({
      ...body,
      run_contract_id: runContractId,
      run_contract_digest: runContractDigest,
    });
  } catch (error) {
    if (error instanceof BuilderProgrammingRuntimeContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  BUILDER_PROGRAMMING_RUNTIME_DESCRIPTOR_VERSION,
  BUILDER_PROGRAMMING_RUNTIME_RUN_CONTRACT_VERSION,
  BUILDER_PROGRAMMING_WORKSPACE_REF_VERSION,
  BuilderProgrammingRuntimeContractError,
  createBuilderProgrammingRuntimeDescriptor,
  sanitizeBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
  sanitizeBuilderProgrammingRuntimeRunContract,
});
