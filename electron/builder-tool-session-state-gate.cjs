'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  sanitizeBuilderToolResultRecord,
} = require('./builder-tool-result-records.cjs');

const BUILDER_TOOL_SESSION_STATE_GATE_VERSION = 'builder-tool-session-state-gate.v1';
const TOOL_CALL_ADMISSION_KIND = 'builder_tool_call_session_state_admission';
const TOOL_RESULT_ADMISSION_KIND = 'builder_tool_result_session_state_admission';
const REQUEST_KEYS = Object.freeze([
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
  'admitted_at_ms',
]);
const RESULT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'run_status',
  'interrupt_requested',
  'cancel_requested',
  'existing_tool_calls',
  'tool_result_record',
  'admitted_at_ms',
]);
const EXISTING_TOOL_CALL_KEYS = Object.freeze([
  'step_id',
  'tool_call_id',
  'tool_call_record',
  'tool_result_record',
]);
const LIFECYCLE = Object.freeze({
  session_state_admission: 'bounded_main_session_state_verified',
  dispatch_admission: 'not_performed',
  execution_admission: 'not_performed',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  state_authority: 'main_tool_session_state_gate_v1',
  conversation_binding: 'trusted_active_run_context_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
});

class BuilderToolSessionStateGateError extends Error {
  constructor() {
    super('The tool session state could not be verified.');
    this.name = 'BuilderToolSessionStateGateError';
    this.code = 'builder_tool_session_state_gate_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolSessionStateGateError();
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
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
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 32) fail();
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

function sanitizeExistingToolCalls(value, expected, policyDigest) {
  assertDenseArray(value);
  const stepIds = new Set();
  const toolCallIds = new Set();
  const callDigests = new Set();
  const resultDigests = new Set();
  let openToolCall = null;
  let retryCount = 0;
  let latestObservedAtMs = null;
  const items = value.map((item) => {
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
    let resultRecord = null;
    if (descriptors.tool_result_record.value === null) {
      if (openToolCall !== null) fail();
      openToolCall = callRecord;
    } else {
      resultRecord = sanitizeBuilderToolResultRecord(descriptors.tool_result_record.value);
      if (
        !sameRunBinding(resultRecord, expected)
        || resultRecord.tool_call_record.record_digest !== callRecord.record_digest
        || resultDigests.has(resultRecord.record_digest)
      ) fail();
      resultDigests.add(resultRecord.record_digest);
      latestObservedAtMs = resultRecord.observed_at_ms;
      if (resultRecord.result.status !== 'succeeded') retryCount += 1;
    }
    return freezeDeep({
      step_id: callRecord.step_id,
      tool_call_id: callRecord.tool_call_id,
      tool_call_record: callRecord,
      tool_result_record: resultRecord,
    });
  });
  return freezeDeep({
    items,
    stepIds,
    toolCallIds,
    callDigests,
    resultDigests,
    openToolCall,
    retryCount,
  });
}

function assertPolicyEnvelope({ policy, admittedAtMs, requestedAtMs, observedAtMs }) {
  if (
    admittedAtMs < requestedAtMs
    || admittedAtMs - policy.issued_at_ms > policy.limits.max_total_timeout_ms
  ) fail();
  if (observedAtMs !== null && admittedAtMs < observedAtMs) fail();
}

function admission({
  kind,
  expected,
  policy,
  stepIndex,
  toolCallCount,
  retryCount,
  admittedAtMs,
}) {
  return freezeDeep({
    admission_version: BUILDER_TOOL_SESSION_STATE_GATE_VERSION,
    admission_kind: kind,
    project_id: expected.project_id,
    conversation_id: expected.conversation_id,
    turn_id: expected.turn_id,
    task_id: expected.task_id,
    run_id: expected.run_id,
    policy_digest: policy.policy_digest,
    step_index: stepIndex,
    tool_call_count: toolCallCount,
    retry_count: retryCount,
    admitted_at_ms: admittedAtMs,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function admitBuilderToolCallSessionState(rawInput) {
  try {
    const descriptors = exactObject(rawInput, REQUEST_KEYS);
    const record = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const expected = {
      project_id: record.project_id,
      conversation_id: record.conversation_id,
      turn_id: record.turn_id,
      task_id: record.task_id,
      run_id: record.run_id,
    };
    assertRunnable(descriptors, expected);
    const admittedAtMs = safeTimestamp(descriptors.admitted_at_ms.value);
    const policy = record.session_policy;
    assertPolicyEnvelope({
      policy,
      admittedAtMs,
      requestedAtMs: record.requested_at_ms,
      observedAtMs: null,
    });
    const existing = sanitizeExistingToolCalls(
      descriptors.existing_tool_calls.value,
      expected,
      policy.policy_digest,
    );
    if (
      existing.openToolCall !== null
      || existing.stepIds.has(record.step_id)
      || existing.toolCallIds.has(record.tool_call_id)
      || existing.callDigests.has(record.record_digest)
      || existing.items.length + 1 > policy.limits.max_steps
      || existing.items.length + 1 > policy.limits.max_tool_calls
      || existing.retryCount > policy.limits.max_retries
    ) fail();
    const prior = existing.items.at(-1) ?? null;
    if (prior !== null) {
      const priorResult = prior.tool_result_record;
      if (priorResult === null || record.requested_at_ms < priorResult.observed_at_ms) fail();
    }
    return admission({
      kind: TOOL_CALL_ADMISSION_KIND,
      expected,
      policy,
      stepIndex: existing.items.length + 1,
      toolCallCount: existing.items.length + 1,
      retryCount: existing.retryCount,
      admittedAtMs,
    });
  } catch (error) {
    if (error instanceof BuilderToolSessionStateGateError) throw error;
    fail();
  }
}

function admitBuilderToolResultSessionState(rawInput) {
  try {
    const descriptors = exactObject(rawInput, RESULT_KEYS);
    const record = sanitizeBuilderToolResultRecord(descriptors.tool_result_record.value);
    const callRecord = record.tool_call_record;
    const expected = {
      project_id: record.project_id,
      conversation_id: record.conversation_id,
      turn_id: record.turn_id,
      task_id: record.task_id,
      run_id: record.run_id,
    };
    assertRunnable(descriptors, expected);
    const admittedAtMs = safeTimestamp(descriptors.admitted_at_ms.value);
    const policy = callRecord.session_policy;
    assertPolicyEnvelope({
      policy,
      admittedAtMs,
      requestedAtMs: callRecord.requested_at_ms,
      observedAtMs: record.observed_at_ms,
    });
    const existing = sanitizeExistingToolCalls(
      descriptors.existing_tool_calls.value,
      expected,
      policy.policy_digest,
    );
    if (
      existing.openToolCall === null
      || existing.openToolCall.record_digest !== callRecord.record_digest
      || existing.resultDigests.has(record.record_digest)
      || existing.items.length > policy.limits.max_steps
      || existing.items.length > policy.limits.max_tool_calls
    ) fail();
    return admission({
      kind: TOOL_RESULT_ADMISSION_KIND,
      expected,
      policy,
      stepIndex: existing.items.length,
      toolCallCount: existing.items.length,
      retryCount: existing.retryCount + (record.result.status === 'succeeded' ? 0 : 1),
      admittedAtMs,
    });
  } catch (error) {
    if (error instanceof BuilderToolSessionStateGateError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_SESSION_STATE_GATE_VERSION,
  TOOL_CALL_ADMISSION_KIND,
  TOOL_RESULT_ADMISSION_KIND,
  BuilderToolSessionStateGateError,
  admitBuilderToolCallSessionState,
  admitBuilderToolResultSessionState,
});
