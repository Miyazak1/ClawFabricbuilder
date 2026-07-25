'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  sanitizeBuilderToolResultRecord,
} = require('./builder-tool-result-records.cjs');

const BUILDER_TOOL_DISPATCH_ADMISSION_VERSION = 'builder-tool-dispatch-admission.v1';
const TOOL_DISPATCH_ADMISSION_KIND = 'builder_tool_dispatch_admission';
const INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'run_status',
  'interrupt_requested',
  'cancel_requested',
  'existing_tool_calls',
  'tool_call_record',
  'dispatch_request_id',
  'admitted_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'dispatch_request_id',
  'policy_digest',
  'record_digest',
  'admitted_at_ms',
  'tool_call_count',
  'retry_count',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const EXISTING_TOOL_CALL_KEYS = Object.freeze([
  'step_id',
  'tool_call_id',
  'tool_call_record',
  'tool_result_record',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'session_state_admission',
  'dispatch_admission',
  'execution_admission',
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'dispatch_authority',
  'session_state_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'adapter_selection',
  'raw_output_storage',
  'git_authority',
  'cost_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const DISPATCH_REQUEST_ID_PATTERN = new RegExp(`^builder-tool-dispatch-request:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze({
  session_state_admission: 'verified_open_tool_call',
  dispatch_admission: 'bounded_main_admission_only',
  execution_admission: 'not_started',
  result_admission: 'not_recorded',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  dispatch_authority: 'main_tool_dispatch_admission_contract_v1',
  session_state_authority: 'main_tool_session_state_gate_v1',
  conversation_binding: 'trusted_open_tool_call_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  adapter_selection: 'not_selected',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
  cost_authority: 'no_chargeable_dispatch_without_runtime_meter_v1',
});

class BuilderToolDispatchAdmissionError extends Error {
  constructor() {
    super('The tool dispatch admission could not be verified.');
    this.name = 'BuilderToolDispatchAdmissionError';
    this.code = 'builder_tool_dispatch_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolDispatchAdmissionError();
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

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeToolCallId(value) {
  return safePattern(value, TOOL_CALL_ID_PATTERN);
}

function safeDispatchRequestId(value) {
  return safePattern(value, DISPATCH_REQUEST_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeBoundedCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) fail();
  return value;
}

function safeNonNegativeBoundedCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 32) fail();
  return value;
}

function sameRunBinding(record, expected) {
  return record.project_id === expected.project_id
    && record.conversation_id === expected.conversation_id
    && record.turn_id === expected.turn_id
    && record.task_id === expected.task_id
    && record.run_id === expected.run_id;
}

function assertRunnable(descriptors, expected) {
  if (
    descriptors.project_id.value !== expected.project_id
    || descriptors.conversation_id.value !== expected.conversation_id
    || descriptors.turn_id.value !== expected.turn_id
    || descriptors.task_id.value !== expected.task_id
    || descriptors.run_id.value !== expected.run_id
    || descriptors.run_status.value !== 'running'
    || descriptors.interrupt_requested.value !== false
    || descriptors.cancel_requested.value !== false
  ) fail();
}

function assertDenseArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > 32) {
    fail();
  }
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.some((key) => typeof key === 'symbol')) fail();
  const expectedKeys = new Set([
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
    fail();
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function sanitizeExistingToolCalls(value, expected, policyDigest, expectedRecordDigest) {
  assertDenseArray(value);
  const stepIds = new Set();
  const toolCallIds = new Set();
  const callDigests = new Set();
  const resultDigests = new Set();
  let openToolCall = null;
  let retryCount = 0;
  let latestObservedAtMs = null;
  for (const item of value) {
    if (openToolCall !== null) fail();
    const descriptors = exactObject(item, EXISTING_TOOL_CALL_KEYS);
    const callRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    if (latestObservedAtMs !== null && callRecord.requested_at_ms < latestObservedAtMs) fail();
    if (
      !sameRunBinding(callRecord, expected)
      || callRecord.session_policy.policy_digest !== policyDigest
      || descriptors.step_id.value !== callRecord.step_id
      || descriptors.tool_call_id.value !== callRecord.tool_call_id
      || stepIds.has(callRecord.step_id)
      || toolCallIds.has(callRecord.tool_call_id)
      || callDigests.has(callRecord.record_digest)
    ) fail();
    stepIds.add(callRecord.step_id);
    toolCallIds.add(callRecord.tool_call_id);
    callDigests.add(callRecord.record_digest);
    if (descriptors.tool_result_record.value === null) {
      if (openToolCall !== null) fail();
      openToolCall = callRecord;
    } else {
      const resultRecord = sanitizeBuilderToolResultRecord(descriptors.tool_result_record.value);
      if (
        !sameRunBinding(resultRecord, expected)
        || resultRecord.tool_call_record.record_digest !== callRecord.record_digest
        || resultDigests.has(resultRecord.record_digest)
      ) fail();
      resultDigests.add(resultRecord.record_digest);
      latestObservedAtMs = resultRecord.observed_at_ms;
      if (resultRecord.result.status !== 'succeeded') retryCount += 1;
    }
  }
  if (
    openToolCall === null
    || openToolCall.record_digest !== expectedRecordDigest
    || value.length > openToolCall.session_policy.limits.max_steps
    || value.length > openToolCall.session_policy.limits.max_tool_calls
    || retryCount > openToolCall.session_policy.limits.max_retries
  ) fail();
  return freezeDeep({
    openToolCall,
    toolCallCount: value.length,
    retryCount,
  });
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

function admissionDigestBody(value) {
  return {
    admitted_at_ms: value.admitted_at_ms,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_digest: value.record_digest,
    retry_count: value.retry_count,
    run_id: value.run_id,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_count: value.tool_call_count,
    tool_call_id: value.tool_call_id,
    turn_id: value.turn_id,
  };
}

function unsignedAdmission({
  projectId,
  conversationId,
  turnId,
  taskId,
  runId,
  toolCallRecord,
  dispatchRequestId,
  admittedAtMs,
  toolCallCount,
  retryCount,
}) {
  const policy = toolCallRecord.session_policy;
  if (
    toolCallRecord.lifecycle.session_policy_admission !== 'verified_main_run_policy'
    || toolCallRecord.lifecycle.dispatch_admission !== 'not_started'
    || toolCallRecord.lifecycle.execution_admission !== 'not_performed'
    || policy.limits.max_chargeable_dispatches !== 0
    || admittedAtMs < toolCallRecord.requested_at_ms
    || admittedAtMs - toolCallRecord.requested_at_ms > policy.limits.max_step_timeout_ms
    || admittedAtMs - policy.issued_at_ms > policy.limits.max_total_timeout_ms
  ) fail();
  return freezeDeep({
    admission_version: BUILDER_TOOL_DISPATCH_ADMISSION_VERSION,
    admission_kind: TOOL_DISPATCH_ADMISSION_KIND,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: toolCallRecord.step_id,
    tool_call_id: toolCallRecord.tool_call_id,
    dispatch_request_id: dispatchRequestId,
    policy_digest: policy.policy_digest,
    record_digest: toolCallRecord.record_digest,
    admitted_at_ms: admittedAtMs,
    tool_call_count: toolCallCount,
    retry_count: retryCount,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolDispatchAdmission(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const conversationId = safeConversationId(descriptors.conversation_id.value, projectId);
    const expected = {
      project_id: projectId,
      conversation_id: conversationId,
      turn_id: safeTurnId(descriptors.turn_id.value),
      task_id: safeTaskId(descriptors.task_id.value),
      run_id: safeRunId(descriptors.run_id.value),
    };
    assertRunnable(descriptors, expected);
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    if (!sameRunBinding(toolCallRecord, expected)) fail();
    const state = sanitizeExistingToolCalls(
      descriptors.existing_tool_calls.value,
      expected,
      toolCallRecord.session_policy.policy_digest,
      toolCallRecord.record_digest,
    );
    if (state.openToolCall.record_digest !== toolCallRecord.record_digest) fail();
    const admission = unsignedAdmission({
      projectId,
      conversationId,
      turnId: expected.turn_id,
      taskId: expected.task_id,
      runId: expected.run_id,
      toolCallRecord,
      dispatchRequestId: safeDispatchRequestId(descriptors.dispatch_request_id.value),
      admittedAtMs: safeTimestamp(descriptors.admitted_at_ms.value),
      toolCallCount: state.toolCallCount,
      retryCount: state.retryCount,
    });
    return freezeDeep({
      ...admission,
      admission_digest: sha256Canonical(admissionDigestBody(admission)),
    });
  } catch (error) {
    if (error instanceof BuilderToolDispatchAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderToolDispatchAdmission(rawAdmission) {
  try {
    const descriptors = exactObject(rawAdmission, ADMISSION_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const admission = freezeDeep({
      admission_version: descriptors.admission_version.value,
      admission_kind: descriptors.admission_kind.value,
      project_id: projectId,
      conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
      turn_id: safeTurnId(descriptors.turn_id.value),
      task_id: safeTaskId(descriptors.task_id.value),
      run_id: safeRunId(descriptors.run_id.value),
      step_id: safeStepId(descriptors.step_id.value),
      tool_call_id: safeToolCallId(descriptors.tool_call_id.value),
      dispatch_request_id: safeDispatchRequestId(descriptors.dispatch_request_id.value),
      policy_digest: safeDigest(descriptors.policy_digest.value),
      record_digest: safeDigest(descriptors.record_digest.value),
      admitted_at_ms: safeTimestamp(descriptors.admitted_at_ms.value),
      tool_call_count: safeBoundedCount(descriptors.tool_call_count.value),
      retry_count: safeNonNegativeBoundedCount(descriptors.retry_count.value),
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      admission.admission_version !== BUILDER_TOOL_DISPATCH_ADMISSION_VERSION
      || admission.admission_kind !== TOOL_DISPATCH_ADMISSION_KIND
      || admission.retry_count >= admission.tool_call_count
    ) fail();
    const digest = safeDigest(descriptors.admission_digest.value);
    if (digest !== sha256Canonical(admissionDigestBody(admission))) fail();
    return freezeDeep({
      ...admission,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolDispatchAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_DISPATCH_ADMISSION_VERSION,
  TOOL_DISPATCH_ADMISSION_KIND,
  BuilderToolDispatchAdmissionError,
  createBuilderToolDispatchAdmission,
  sanitizeBuilderToolDispatchAdmission,
});
