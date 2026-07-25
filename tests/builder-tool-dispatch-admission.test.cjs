'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  createBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');
const {
  BUILDER_TOOL_DISPATCH_ADMISSION_VERSION,
  TOOL_DISPATCH_ADMISSION_KIND,
  BuilderToolDispatchAdmissionError,
  createBuilderToolDispatchAdmission,
  sanitizeBuilderToolDispatchAdmission,
} = require('../electron/builder-tool-dispatch-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
} = require('../electron/builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function sessionPolicy(overrides = {}) {
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: overrides.issued_at_ms ?? 49,
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      ...(overrides.limits ?? {}),
    },
  });
}

async function allowedAdmission(index, evaluatedAtMs = 50) {
  const guard = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => evaluatedAtMs,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: ACTOR_ID,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    }),
  });
  return guard.admit({
    tool_call_id: id('tool-call', index),
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: `project:/src/file-${index}.tsx`,
    },
  });
}

async function toolCallRecord(index, overrides = {}) {
  return createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: id('run-step', index),
    session_policy: overrides.session_policy ?? sessionPolicy(),
    admission: await allowedAdmission(index, overrides.evaluated_at_ms ?? 50),
    requested_at_ms: overrides.requested_at_ms ?? (51 + index),
  });
}

function toolResultRecord(callRecord, overrides = {}) {
  const status = overrides.status ?? 'succeeded';
  const summaryCode = overrides.summary_code
    ?? (status === 'succeeded' ? 'completed_without_raw_output' : 'failed_without_raw_output');
  return createBuilderToolResultRecord({
    runtime_invocation_admission: overrides.runtime_invocation_admission ?? toolRuntimeAdmission(callRecord),
    tool_call_record: callRecord,
    observed_at_ms: overrides.observed_at_ms ?? (callRecord.requested_at_ms + 1),
    result: {
      status,
      summary_code: summaryCode,
    },
  });
}

function toolRuntimeAdmission(callRecord) {
  const dispatch = createBuilderToolDispatchAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existing(callRecord)],
    tool_call_record: callRecord,
    dispatch_request_id: id('tool-dispatch-request', 40 + Number.parseInt(callRecord.step_id.slice(-12), 16)),
    admitted_at_ms: callRecord.requested_at_ms,
  });
  const selection = createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: callRecord,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: id('tool-adapter-selection', 50 + Number.parseInt(callRecord.step_id.slice(-12), 16)),
    selected_at_ms: dispatch.admitted_at_ms,
  });
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: callRecord,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: id('tool-runtime-invocation', 60 + Number.parseInt(callRecord.step_id.slice(-12), 16)),
    runtime_admitted_at_ms: selection.selected_at_ms,
  });
}

function existing(callRecord, resultRecord = null) {
  return {
    step_id: callRecord.step_id,
    tool_call_id: callRecord.tool_call_id,
    tool_call_record: callRecord,
    tool_result_record: resultRecord,
  };
}

function dispatchInput(callRecord, existingToolCalls, overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: existingToolCalls,
    tool_call_record: callRecord,
    dispatch_request_id: id('tool-dispatch-request', 1),
    admitted_at_ms: callRecord.requested_at_ms,
    ...overrides,
  };
}

function assertDispatchError(error) {
  assert.equal(error instanceof BuilderToolDispatchAdmissionError, true);
  assert.equal(error.code, 'builder_tool_dispatch_admission_invalid');
  assert.equal(error.message, 'The tool dispatch admission could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function digestAdmission(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
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
  }), 'utf8').digest('hex')}`;
}

test('creates a main-only dispatch admission for the current open tool call', async () => {
  const policy = sessionPolicy({ limits: { max_steps: 4, max_tool_calls: 4, max_retries: 2 } });
  const first = await toolCallRecord(6, { session_policy: policy });
  const failed = toolResultRecord(first, { status: 'failed' });
  const open = await toolCallRecord(7, {
    session_policy: policy,
    requested_at_ms: failed.observed_at_ms + 1,
  });
  const admission = createBuilderToolDispatchAdmission(dispatchInput(
    open,
    [existing(first, failed), existing(open)],
  ));

  assert.equal(admission.admission_version, BUILDER_TOOL_DISPATCH_ADMISSION_VERSION);
  assert.equal(admission.admission_kind, TOOL_DISPATCH_ADMISSION_KIND);
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, CONVERSATION_ID);
  assert.equal(admission.turn_id, TURN_ID);
  assert.equal(admission.task_id, TASK_ID);
  assert.equal(admission.run_id, RUN_ID);
  assert.equal(admission.step_id, open.step_id);
  assert.equal(admission.tool_call_id, open.tool_call_id);
  assert.equal(admission.policy_digest, policy.policy_digest);
  assert.equal(admission.record_digest, open.record_digest);
  assert.equal(admission.tool_call_count, 2);
  assert.equal(admission.retry_count, 1);
  assert.deepEqual(admission.lifecycle, {
    session_state_admission: 'verified_open_tool_call',
    dispatch_admission: 'bounded_main_admission_only',
    execution_admission: 'not_started',
    result_admission: 'not_recorded',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
  assert.deepEqual(admission.authority, {
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
  assert.deepEqual(sanitizeBuilderToolDispatchAdmission(admission), admission);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.lifecycle), true);
  assert.equal(Object.isFrozen(admission.authority), true);
});

test('rejects missing, settled, mismatched, or non-final open tool calls', async () => {
  const policy = sessionPolicy();
  const open = await toolCallRecord(10, { session_policy: policy });
  const settled = toolResultRecord(open);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, [])), assertDispatchError);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(
    open,
    [existing(open, settled)],
  )), assertDispatchError);

  const otherOpen = await toolCallRecord(11, {
    session_policy: policy,
    requested_at_ms: settled.observed_at_ms + 1,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, [
    existing(otherOpen),
  ])), assertDispatchError);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(otherOpen, [
    existing(otherOpen),
    existing(open, settled),
  ])), assertDispatchError);
});

test('rejects policy drift, exhausted retries, stale timing, and cancelled runs', async () => {
  const retryPolicy = sessionPolicy({ limits: { max_steps: 4, max_tool_calls: 4, max_retries: 1 } });
  const first = await toolCallRecord(20, { session_policy: retryPolicy });
  const failed = toolResultRecord(first, { status: 'failed' });
  const retry = await toolCallRecord(21, {
    session_policy: retryPolicy,
    requested_at_ms: failed.observed_at_ms + 1,
  });
  const retryFailed = toolResultRecord(retry, { status: 'failed' });
  const exhausted = await toolCallRecord(22, {
    session_policy: retryPolicy,
    requested_at_ms: retryFailed.observed_at_ms + 1,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(exhausted, [
    existing(first, failed),
    existing(retry, retryFailed),
    existing(exhausted),
  ])), assertDispatchError);

  const stepLimitPolicy = sessionPolicy({ limits: { max_steps: 1, max_tool_calls: 1, max_retries: 0 } });
  const limitedStep = await toolCallRecord(23, { session_policy: stepLimitPolicy });
  const limitedStepResult = toolResultRecord(limitedStep);
  const overStepLimit = await toolCallRecord(24, {
    session_policy: stepLimitPolicy,
    requested_at_ms: limitedStepResult.observed_at_ms + 1,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(overStepLimit, [
    existing(limitedStep, limitedStepResult),
    existing(overStepLimit),
  ])), assertDispatchError);

  const toolCallLimitPolicy = sessionPolicy({ limits: { max_steps: 4, max_tool_calls: 1 } });
  const limitedToolCall = await toolCallRecord(25, { session_policy: toolCallLimitPolicy });
  const limitedToolCallResult = toolResultRecord(limitedToolCall);
  const overToolCallLimit = await toolCallRecord(26, {
    session_policy: toolCallLimitPolicy,
    requested_at_ms: limitedToolCallResult.observed_at_ms + 1,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(overToolCallLimit, [
    existing(limitedToolCall, limitedToolCallResult),
    existing(overToolCallLimit),
  ])), assertDispatchError);

  const stable = await toolCallRecord(30, { session_policy: policyWithTotalTimeout(1_000) });
  const drifted = await toolCallRecord(31, {
    session_policy: policyWithTotalTimeout(1_000, 50),
    requested_at_ms: stable.requested_at_ms + 1,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(drifted, [
    existing(stable, toolResultRecord(stable)),
    existing(drifted),
  ])), assertDispatchError);

  const open = await toolCallRecord(40);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, [existing(open)], {
    admitted_at_ms: open.requested_at_ms - 1,
  })), assertDispatchError);
  const shortStep = await toolCallRecord(41, {
    session_policy: policyWithTimeout(10, 1_000),
    requested_at_ms: 60,
  });
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(shortStep, [existing(shortStep)], {
    admitted_at_ms: 71,
  })), assertDispatchError);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, [existing(open)], {
    admitted_at_ms: open.session_policy.issued_at_ms + open.session_policy.limits.max_total_timeout_ms + 1,
  })), assertDispatchError);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, [existing(open)], {
    cancel_requested: true,
  })), assertDispatchError);
});

function policyWithTotalTimeout(maxTotalTimeoutMs, issuedAtMs = 49) {
  return policyWithTimeout(
    Math.min(maxTotalTimeoutMs, DEFAULT_BUILDER_TOOL_SESSION_LIMITS.max_step_timeout_ms),
    maxTotalTimeoutMs,
    issuedAtMs,
  );
}

function policyWithTimeout(maxStepTimeoutMs, maxTotalTimeoutMs, issuedAtMs = 49) {
  return sessionPolicy({
    issued_at_ms: issuedAtMs,
    limits: {
      max_total_timeout_ms: maxTotalTimeoutMs,
      max_step_timeout_ms: maxStepTimeoutMs,
    },
  });
}

test('rejects forged admissions and hostile input without leaking rejected material', async () => {
  const open = await toolCallRecord(50);
  const admission = createBuilderToolDispatchAdmission(dispatchInput(open, [existing(open)]));
  assert.throws(() => sanitizeBuilderToolDispatchAdmission({
    ...admission,
    retry_count: admission.retry_count + 1,
  }), assertDispatchError);
  const forgedRetry = {
    ...admission,
    retry_count: admission.tool_call_count,
  };
  assert.throws(() => sanitizeBuilderToolDispatchAdmission({
    ...forgedRetry,
    admission_digest: digestAdmission(forgedRetry),
  }), assertDispatchError);
  assert.throws(() => sanitizeBuilderToolDispatchAdmission({
    ...admission,
    authority: {
      ...admission.authority,
      tool_dispatch: 'performed',
    },
  }), assertDispatchError);
  const accessorInput = dispatchInput(open, [existing(open)]);
  Object.defineProperty(accessorInput, 'tool_call_record', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(() => createBuilderToolDispatchAdmission(accessorInput), assertDispatchError);
  assert.throws(() => createBuilderToolDispatchAdmission(dispatchInput(open, new Proxy([existing(open)], {}))), assertDispatchError);
});

test('source remains a pure dispatch-admission contract with no IPC, provider, Git, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-dispatch-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-dispatch-admission\.v1/u);
  assert.match(source, /main_tool_dispatch_admission_contract_v1/u);
  assert.match(source, /trusted_open_tool_call_required/u);
  assert.match(source, /adapter_selection:\s*'not_selected'/u);
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /max_chargeable_dispatches !== 0/u);
  assert.match(source, /admittedAtMs - toolCallRecord\.requested_at_ms > policy\.limits\.max_step_timeout_ms/u);
  assert.match(source, /admission\.retry_count >= admission\.tool_call_count/u);
  assert.match(source, /openToolCall\.record_digest !== expectedRecordDigest/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
