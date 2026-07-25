'use strict';

const assert = require('node:assert/strict');
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
  BUILDER_TOOL_SESSION_STATE_GATE_VERSION,
  TOOL_CALL_ADMISSION_KIND,
  TOOL_RESULT_ADMISSION_KIND,
  BuilderToolSessionStateGateError,
  admitBuilderToolCallSessionState,
  admitBuilderToolResultSessionState,
} = require('../electron/builder-tool-session-state-gate.cjs');

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
    tool_call_record: callRecord,
    observed_at_ms: overrides.observed_at_ms ?? (callRecord.requested_at_ms + 1),
    result: {
      status,
      summary_code: summaryCode,
    },
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

function callInput(callRecord, overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [],
    tool_call_record: callRecord,
    admitted_at_ms: callRecord.requested_at_ms,
    ...overrides,
  };
}

function resultInput(resultRecord, existingCalls, overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: existingCalls,
    tool_result_record: resultRecord,
    admitted_at_ms: resultRecord.observed_at_ms,
    ...overrides,
  };
}

function assertGateError(error) {
  assert.equal(error instanceof BuilderToolSessionStateGateError, true);
  assert.equal(error.code, 'builder_tool_session_state_gate_invalid');
  assert.equal(error.message, 'The tool session state could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

test('admits bounded tool call and result state without dispatch authority', async () => {
  const callRecord = await toolCallRecord(6);
  const callAdmission = admitBuilderToolCallSessionState(callInput(callRecord));
  assert.equal(callAdmission.admission_version, BUILDER_TOOL_SESSION_STATE_GATE_VERSION);
  assert.equal(callAdmission.admission_kind, TOOL_CALL_ADMISSION_KIND);
  assert.equal(callAdmission.policy_digest, callRecord.session_policy.policy_digest);
  assert.equal(callAdmission.step_index, 1);
  assert.equal(callAdmission.tool_call_count, 1);
  assert.equal(callAdmission.retry_count, 0);
  assert.deepEqual(callAdmission.lifecycle, {
    session_state_admission: 'bounded_main_session_state_verified',
    dispatch_admission: 'not_performed',
    execution_admission: 'not_performed',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
  assert.equal(callAdmission.authority.state_authority, 'main_tool_session_state_gate_v1');
  assert.equal(callAdmission.authority.provider_dispatch, false);
  assert.equal(callAdmission.authority.tool_dispatch, 'not_performed');
  assert.equal(callAdmission.authority.renderer_authority, 'not_present');

  const resultRecord = toolResultRecord(callRecord);
  const resultAdmission = admitBuilderToolResultSessionState(resultInput(
    resultRecord,
    [existing(callRecord)],
  ));
  assert.equal(resultAdmission.admission_kind, TOOL_RESULT_ADMISSION_KIND);
  assert.equal(resultAdmission.step_index, 1);
  assert.equal(resultAdmission.tool_call_count, 1);
  assert.equal(resultAdmission.retry_count, 0);
  assert.equal(Object.isFrozen(resultAdmission), true);
  assert.equal(Object.isFrozen(resultAdmission.authority), true);
});

test('enforces serial calls, fixed run policy, step count, and retry exhaustion', async () => {
  const countPolicy = sessionPolicy({
    limits: { max_steps: 1, max_tool_calls: 1, max_retries: 0 },
  });
  const first = await toolCallRecord(10, { session_policy: countPolicy });
  const firstResult = toolResultRecord(first, { status: 'succeeded' });
  const second = await toolCallRecord(11, {
    session_policy: countPolicy,
    requested_at_ms: firstResult.observed_at_ms + 1,
  });
  assert.throws(() => admitBuilderToolCallSessionState(callInput(second, {
    existing_tool_calls: [existing(first, firstResult)],
  })), assertGateError);

  const toolCallPolicy = sessionPolicy({
    limits: { max_steps: 4, max_tool_calls: 1, max_retries: 2 },
  });
  const limitedToolCall = await toolCallRecord(12, { session_policy: toolCallPolicy });
  const limitedToolResult = toolResultRecord(limitedToolCall, { status: 'succeeded' });
  const overToolCallLimit = await toolCallRecord(13, {
    session_policy: toolCallPolicy,
    requested_at_ms: limitedToolResult.observed_at_ms + 1,
  });
  assert.throws(() => admitBuilderToolCallSessionState(callInput(overToolCallLimit, {
    existing_tool_calls: [existing(limitedToolCall, limitedToolResult)],
  })), assertGateError);

  const retryPolicy = sessionPolicy({
    limits: { max_steps: 4, max_tool_calls: 4, max_retries: 1 },
  });
  const failedFirst = await toolCallRecord(20, { session_policy: retryPolicy });
  const failedFirstResult = toolResultRecord(failedFirst, { status: 'failed' });
  const retry = await toolCallRecord(21, {
    session_policy: retryPolicy,
    requested_at_ms: failedFirstResult.observed_at_ms + 1,
  });
  assert.equal(admitBuilderToolCallSessionState(callInput(retry, {
    existing_tool_calls: [existing(failedFirst, failedFirstResult)],
  })).step_index, 2);
  const retryResult = toolResultRecord(retry, { status: 'failed' });
  const exhausted = await toolCallRecord(22, {
    session_policy: retryPolicy,
    requested_at_ms: retryResult.observed_at_ms + 1,
  });
  assert.throws(() => admitBuilderToolCallSessionState(callInput(exhausted, {
    existing_tool_calls: [existing(failedFirst, failedFirstResult), existing(retry, retryResult)],
  })), assertGateError);

  const openCall = await toolCallRecord(30);
  const parallelCall = await toolCallRecord(31);
  assert.throws(() => admitBuilderToolCallSessionState(callInput(parallelCall, {
    existing_tool_calls: [existing(openCall)],
  })), assertGateError);

  const settled = toolResultRecord(openCall);
  const driftedPolicyCall = await toolCallRecord(32, {
    session_policy: sessionPolicy({ issued_at_ms: 50 }),
    requested_at_ms: settled.observed_at_ms + 1,
  });
  assert.throws(() => admitBuilderToolCallSessionState(callInput(driftedPolicyCall, {
    existing_tool_calls: [existing(openCall, settled)],
  })), assertGateError);
});

test('rejects stale admissions, non-running state, and hostile graphs', async () => {
  const callRecord = await toolCallRecord(40);
  assert.throws(() => admitBuilderToolCallSessionState(callInput(callRecord, {
    admitted_at_ms: callRecord.requested_at_ms - 1,
  })), assertGateError);
  assert.throws(() => admitBuilderToolCallSessionState(callInput(callRecord, {
    run_status: 'completed',
  })), assertGateError);
  assert.throws(() => admitBuilderToolCallSessionState(callInput(callRecord, {
    interrupt_requested: true,
  })), assertGateError);
  assert.throws(() => admitBuilderToolCallSessionState(callInput(callRecord, {
    existing_tool_calls: new Proxy([], {}),
  })), assertGateError);
  const accessorInput = callInput(callRecord);
  Object.defineProperty(accessorInput, 'tool_call_record', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(() => admitBuilderToolCallSessionState(accessorInput), assertGateError);

  const resultRecord = toolResultRecord(callRecord);
  assert.throws(() => admitBuilderToolResultSessionState(resultInput(resultRecord, [])), assertGateError);
  assert.throws(() => admitBuilderToolResultSessionState(resultInput(
    resultRecord,
    [existing(callRecord)],
    { admitted_at_ms: resultRecord.observed_at_ms - 1 },
  )), assertGateError);
});

test('source remains a pure main-only state gate with no IPC, provider, Git, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-session-state-gate.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-session-state-gate\.v1/u);
  assert.match(source, /main_tool_session_state_gate_v1/u);
  assert.match(source, /bounded_main_session_state_verified/u);
  assert.match(source, /existing\.openToolCall !== null/u);
  assert.match(source, /existing\.items\.length \+ 1 > policy\.limits\.max_steps/u);
  assert.match(source, /existing\.items\.length \+ 1 > policy\.limits\.max_tool_calls/u);
  assert.match(source, /existing\.retryCount > policy\.limits\.max_retries/u);
  assert.match(source, /callRecord\.session_policy\.policy_digest !== policyDigest/u);
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
