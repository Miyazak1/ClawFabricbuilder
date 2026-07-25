'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_TOOL_SESSION_POLICY_VERSION = 'builder-tool-session-policy.v1';
const TOOL_SESSION_POLICY_KIND = 'builder_tool_session_policy';
const INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'issued_at_ms',
  'limits',
]);
const POLICY_KEYS = Object.freeze([
  'policy_version',
  'policy_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'issued_at_ms',
  'limits',
  'lifecycle',
  'authority',
  'policy_digest',
]);
const LIMIT_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_retries',
  'max_step_timeout_ms',
  'max_total_timeout_ms',
  'max_public_summary_bytes',
  'max_raw_output_bytes',
  'max_chargeable_dispatches',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'step_admission',
  'tool_call_admission',
  'dispatch_admission',
  'execution_admission',
  'retry_admission',
  'cancellation_admission',
  'restart_admission',
  'raw_output_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'policy_authority',
  'conversation_binding',
  'issuance_authority',
  'digest_authority',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'raw_output_storage',
  'cost_authority',
  'git_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_BUILDER_TOOL_SESSION_LIMITS = Object.freeze({
  max_steps: 16,
  max_tool_calls: 16,
  max_retries: 2,
  max_step_timeout_ms: 120_000,
  max_total_timeout_ms: 300_000,
  max_public_summary_bytes: 160,
  max_raw_output_bytes: 0,
  max_chargeable_dispatches: 0,
});
const MAX_TOOL_RAW_OUTPUT_BYTES = 64 * 1_024;
const HARD_LIMITS = Object.freeze({
  max_steps: 32,
  max_tool_calls: 32,
  max_retries: 4,
  max_step_timeout_ms: 120_000,
  max_total_timeout_ms: 300_000,
  max_public_summary_bytes: 160,
  max_raw_output_bytes: MAX_TOOL_RAW_OUTPUT_BYTES,
  max_chargeable_dispatches: 0,
});
const LIFECYCLE = Object.freeze({
  step_admission: 'bounded_by_main_policy',
  tool_call_admission: 'bounded_pre_dispatch_only',
  dispatch_admission: 'not_performed_by_policy_contract',
  execution_admission: 'not_performed_by_policy_contract',
  retry_admission: 'bounded_not_started',
  cancellation_admission: 'policy_only_not_cancelled',
  restart_admission: 'policy_must_be_reissued_after_restart',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  policy_authority: 'main_tool_session_policy_contract_v1',
  conversation_binding: 'ids_only_host_replay_required',
  issuance_authority: 'trusted_main_run_context_required',
  digest_authority: 'integrity_digest_not_issuer_proof_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed_by_policy_contract',
  raw_output_storage: 'not_present',
  cost_authority: 'no_chargeable_dispatches_without_runtime_meter_v1',
  git_authority: 'not_present',
});

class BuilderToolSessionPolicyError extends Error {
  constructor() {
    super('The tool session policy could not be verified.');
    this.name = 'BuilderToolSessionPolicyError';
    this.code = 'builder_tool_session_policy_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolSessionPolicyError();
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

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
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
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safePositiveBoundedInteger(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail();
  return value;
}

function safeNonNegativeBoundedInteger(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail();
  return value;
}

function safeZeroBound(value) {
  if (value !== 0) fail();
  return value;
}

function sanitizeLimits(value) {
  const descriptors = exactObject(value, LIMIT_KEYS);
  const limits = freezeDeep({
    max_steps: safePositiveBoundedInteger(descriptors.max_steps.value, HARD_LIMITS.max_steps),
    max_tool_calls: safePositiveBoundedInteger(
      descriptors.max_tool_calls.value,
      HARD_LIMITS.max_tool_calls,
    ),
    max_retries: safeNonNegativeBoundedInteger(descriptors.max_retries.value, HARD_LIMITS.max_retries),
    max_step_timeout_ms: safePositiveBoundedInteger(
      descriptors.max_step_timeout_ms.value,
      HARD_LIMITS.max_step_timeout_ms,
    ),
    max_total_timeout_ms: safePositiveBoundedInteger(
      descriptors.max_total_timeout_ms.value,
      HARD_LIMITS.max_total_timeout_ms,
    ),
    max_public_summary_bytes: safePositiveBoundedInteger(
      descriptors.max_public_summary_bytes.value,
      HARD_LIMITS.max_public_summary_bytes,
    ),
    max_raw_output_bytes: safeNonNegativeBoundedInteger(
      descriptors.max_raw_output_bytes.value,
      HARD_LIMITS.max_raw_output_bytes,
    ),
    max_chargeable_dispatches: safeZeroBound(descriptors.max_chargeable_dispatches.value),
  });
  if (
    limits.max_tool_calls > limits.max_steps
    || limits.max_retries >= limits.max_steps
    || limits.max_step_timeout_ms > limits.max_total_timeout_ms
  ) fail();
  return limits;
}

function sanitizeLifecycle(value) {
  const descriptors = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (descriptors[key].value !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (descriptors[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function policyDigestBody(value) {
  return {
    authority: value.authority,
    conversation_id: value.conversation_id,
    issued_at_ms: value.issued_at_ms,
    lifecycle: value.lifecycle,
    limits: value.limits,
    policy_kind: value.policy_kind,
    policy_version: value.policy_version,
    project_id: value.project_id,
    run_id: value.run_id,
    task_id: value.task_id,
    turn_id: value.turn_id,
  };
}

function unsignedPolicy({
  projectId,
  conversationId,
  turnId,
  taskId,
  runId,
  issuedAtMs,
  limits,
}) {
  return freezeDeep({
    policy_version: BUILDER_TOOL_SESSION_POLICY_VERSION,
    policy_kind: TOOL_SESSION_POLICY_KIND,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: issuedAtMs,
    limits,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolSessionPolicy(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const policy = unsignedPolicy({
      projectId,
      conversationId: safeConversationId(descriptors.conversation_id.value, projectId),
      turnId: safeTurnId(descriptors.turn_id.value),
      taskId: safeTaskId(descriptors.task_id.value),
      runId: safeRunId(descriptors.run_id.value),
      issuedAtMs: safeTimestamp(descriptors.issued_at_ms.value),
      limits: sanitizeLimits(descriptors.limits.value),
    });
    return freezeDeep({
      ...policy,
      policy_digest: sha256Canonical(policyDigestBody(policy)),
    });
  } catch (error) {
    if (error instanceof BuilderToolSessionPolicyError) throw error;
    fail();
  }
}

function sanitizeBuilderToolSessionPolicy(rawPolicy) {
  try {
    const descriptors = exactObject(rawPolicy, POLICY_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const policy = unsignedPolicy({
      projectId,
      conversationId: safeConversationId(descriptors.conversation_id.value, projectId),
      turnId: safeTurnId(descriptors.turn_id.value),
      taskId: safeTaskId(descriptors.task_id.value),
      runId: safeRunId(descriptors.run_id.value),
      issuedAtMs: safeTimestamp(descriptors.issued_at_ms.value),
      limits: sanitizeLimits(descriptors.limits.value),
    });
    if (
      descriptors.policy_version.value !== BUILDER_TOOL_SESSION_POLICY_VERSION
      || descriptors.policy_kind.value !== TOOL_SESSION_POLICY_KIND
      || JSON.stringify(sanitizeLifecycle(descriptors.lifecycle.value)) !== JSON.stringify(policy.lifecycle)
      || JSON.stringify(sanitizeAuthority(descriptors.authority.value)) !== JSON.stringify(policy.authority)
    ) fail();
    const digest = safeDigest(descriptors.policy_digest.value);
    if (digest !== sha256Canonical(policyDigestBody(policy))) fail();
    return freezeDeep({
      ...policy,
      policy_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolSessionPolicyError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_SESSION_POLICY_VERSION,
  TOOL_SESSION_POLICY_KIND,
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  BuilderToolSessionPolicyError,
  createBuilderToolSessionPolicy,
  sanitizeBuilderToolSessionPolicy,
});
