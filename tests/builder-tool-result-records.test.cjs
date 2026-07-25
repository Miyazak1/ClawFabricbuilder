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
  BUILDER_TOOL_RESULT_RECORD_VERSION,
  TOOL_RESULT_RECORD_KIND,
  BuilderToolResultRecordError,
  createBuilderToolResultRecord,
  sanitizeBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const STEP_ID = 'builder-run-step:123e4567-e89b-42d3-a456-426614174005';
const TOOL_CALL_ID = 'builder-tool-call:123e4567-e89b-42d3-a456-426614174006';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function permissionRequest(overrides = {}) {
  return {
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    ...overrides,
  };
}

async function allowedAdmission(overrides = {}) {
  const request = permissionRequest(overrides.request ?? {});
  const guard = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => 50,
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
      ...(overrides.decision ?? {}),
    }),
  });
  return guard.admit(request);
}

function sessionPolicy(overrides = {}) {
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: 49,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...overrides,
  });
}

function callRecordInput(admission, overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: STEP_ID,
    session_policy: sessionPolicy(),
    admission,
    requested_at_ms: 51,
    ...overrides,
  };
}

async function toolCallRecord(overrides = {}) {
  return createBuilderToolCallRecord(callRecordInput(
    await allowedAdmission(overrides.admission ?? {}),
    overrides.record ?? {},
  ));
}

function result(overrides = {}) {
  return {
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
    ...overrides,
  };
}

function resultInput(record, overrides = {}) {
  return {
    tool_call_record: record,
    observed_at_ms: 60,
    result: result(),
    ...overrides,
  };
}

function assertRecordError(error) {
  assert.equal(error instanceof BuilderToolResultRecordError, true);
  assert.equal(error.code, 'builder_tool_result_record_invalid');
  assert.equal(error.message, 'The tool result record could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

test('creates a fixed-code tool result record from a verified pre-dispatch tool call record', async () => {
  const callRecord = await toolCallRecord();
  const record = createBuilderToolResultRecord(resultInput(callRecord));

  assert.equal(record.record_version, BUILDER_TOOL_RESULT_RECORD_VERSION);
  assert.equal(record.record_kind, TOOL_RESULT_RECORD_KIND);
  assert.equal(record.project_id, PROJECT_ID);
  assert.equal(record.conversation_id, CONVERSATION_ID);
  assert.equal(record.turn_id, TURN_ID);
  assert.equal(record.task_id, TASK_ID);
  assert.equal(record.run_id, RUN_ID);
  assert.equal(record.step_id, STEP_ID);
  assert.equal(record.tool_call_id, TOOL_CALL_ID);
  assert.equal(record.action, 'filesystem.read');
  assert.equal(record.resource_kind, 'filesystem');
  assert.equal(record.observed_at_ms, 60);
  assert.deepEqual(record.result, {
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
    display_summary: 'This step completed. Details were not kept.',
    summary_digest: record.result.summary_digest,
  });
  assert.match(record.result.summary_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(record.lifecycle, {
    permission_admission: 'verified_allowed',
    tool_call_admission: 'verified_pre_dispatch_record',
    dispatch_admission: 'not_performed_by_record_contract',
    execution_admission: 'not_performed_by_record_contract',
    result_admission: 'fixed_summary_code_recorded',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
  assert.deepEqual(record.authority, {
    record_authority: 'main_tool_result_record_contract_v1',
    tool_call_authority: 'main_tool_call_record_contract_v1',
    conversation_binding: 'verified_tool_call_record',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed_by_record_contract',
    raw_output_storage: 'not_present',
    git_authority: 'not_present',
  });
  assert.match(record.record_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.tool_call_record), true);
  assert.equal(Object.isFrozen(record.result), true);
  assert.deepEqual(sanitizeBuilderToolResultRecord(structuredClone(record)), record);
});

test('fails closed on forged tool call records, stale timing, and result drift', async () => {
  const callRecord = await toolCallRecord();
  const tightSummaryCallRecord = await toolCallRecord({
    record: {
      session_policy: sessionPolicy({
        limits: {
          ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
          max_public_summary_bytes: 1,
        },
      }),
    },
  });
  const record = createBuilderToolResultRecord(resultInput(callRecord));

  for (const invalidInput of [
    resultInput({ ...callRecord, record_digest: `sha256:${'0'.repeat(64)}` }),
    resultInput({ ...callRecord, lifecycle: { ...callRecord.lifecycle, result_admission: 'recorded' } }),
    resultInput(callRecord, { observed_at_ms: 50 }),
    resultInput(callRecord, { observed_at_ms: 120_052 }),
    resultInput(callRecord, { observed_at_ms: 300_050 }),
    resultInput(tightSummaryCallRecord),
    resultInput(callRecord, { result: result({ status: 'running' }) }),
    resultInput(callRecord, { result: result({ status: 'succeeded', summary_code: 'failed_without_raw_output' }) }),
    resultInput(callRecord, { result: result({ status: 'failed', summary_code: 'completed_without_raw_output' }) }),
    resultInput(callRecord, { result: { status: 'failed', summary_code: 'output_rejected', summary: 'export const answer = 42;' } }),
    resultInput(callRecord, { result: { status: 'failed', summary_code: 'output_rejected', summary: 'BEGIN RSA PRIVATE KEY' } }),
    resultInput(callRecord, { result: { ...result(), output_digest: `sha256:${'b'.repeat(64)}` } }),
    resultInput(callRecord, { result: { ...result(), stdout: 'raw bytes' } }),
  ]) {
    assert.throws(() => createBuilderToolResultRecord(invalidInput), assertRecordError);
  }

  for (const drift of [
    { ...record, action: 'filesystem.write' },
    { ...record, resource_kind: 'project' },
    { ...record, result: { ...record.result, display_summary: 'Completed with output.' } },
    { ...record, result: { ...record.result, summary_digest: `sha256:${'f'.repeat(64)}` } },
    { ...record, lifecycle: { ...record.lifecycle, raw_output_admission: 'included' } },
    { ...record, authority: { ...record.authority, renderer_authority: 'renderer_selected' } },
    { ...record, record_digest: `sha256:${'f'.repeat(64)}` },
  ]) {
    assert.throws(() => sanitizeBuilderToolResultRecord(drift), assertRecordError);
  }
});

test('accepts only terminal fixed-code summaries and never raw output fields', async () => {
  const callRecord = await toolCallRecord();
  for (const [status, summaryCode] of [
    ['succeeded', 'completed_without_raw_output'],
    ['failed', 'failed_without_raw_output'],
    ['failed', 'output_rejected'],
    ['failed', 'adapter_unavailable'],
    ['failed', 'timed_out_without_raw_output'],
    ['cancelled', 'cancelled_without_raw_output'],
  ]) {
    const record = createBuilderToolResultRecord(resultInput(callRecord, {
      result: result({
        status,
        summary_code: summaryCode,
      }),
    }));
    assert.equal(record.result.status, status);
    assert.equal(record.result.summary_code, summaryCode);
    assert.match(record.result.display_summary, /^[A-Z][A-Za-z. ]+$/u);
  }

  for (const invalidResult of [
    { status: 'succeeded', summary_code: 'output_rejected' },
    { status: 'failed', summary_code: 'completed_without_raw_output' },
    { status: 'cancelled', summary_code: 'adapter_unavailable' },
    { status: 'failed', summary_code: 'export const answer = 42;' },
    { status: 'failed', summary: 'Failed without output.' },
  ]) {
    assert.throws(
      () => createBuilderToolResultRecord(resultInput(callRecord, { result: invalidResult })),
      assertRecordError,
    );
  }
});

test('rejects hostile input without invoking getters or leaking rejected material', async () => {
  const callRecord = await toolCallRecord();
  let getterCalls = 0;
  const accessorResult = {
    status: 'succeeded',
  };
  Object.defineProperty(accessorResult, 'summary_code', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'completed_without_raw_output';
    },
  });

  for (const invalid of [
    null,
    {},
    { ...resultInput(callRecord), extra: true },
    new Proxy(resultInput(callRecord), {}),
    resultInput(callRecord, { result: accessorResult }),
  ]) {
    assert.throws(() => createBuilderToolResultRecord(invalid), (error) => {
      assertRecordError(error);
      assert.doesNotMatch(`${error.message}\n${error.stack}`, /api_key|D:\\CODE|raw bytes/u);
      return true;
    });
  }
  assert.equal(getterCalls, 0);
});

test('record carries no raw result, provider, credential, Git, renderer, or save authority', async () => {
  const record = createBuilderToolResultRecord(resultInput(await toolCallRecord()));
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(
    serialized,
    /stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_id|provider_config|provider_secret|credential_secret|credential_value|secret_ref|ipcRenderer|BrowserWindow|persist_candidate_commit|write_current/iu,
  );
  assert.equal(Object.hasOwn(record.result, 'stdout'), false);
  assert.equal(Object.hasOwn(record.result, 'stderr'), false);
  assert.equal(Object.hasOwn(record.result, 'raw_output'), false);
  assert.equal(Object.hasOwn(record.result, 'output_digest'), false);
  assert.equal(Object.hasOwn(record, 'git_candidate_receipt'), false);
  assert.equal(record.authority.provider_dispatch, false);
  assert.equal(record.authority.credential_readback, false);
  assert.equal(record.lifecycle.revision_admission, 'not_created');
});

test('source remains a pure result-admission contract with no IPC, provider, Git, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-result-records.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-result-record\.v1/u);
  assert.match(source, /main_tool_result_record_contract_v1/u);
  assert.match(source, /sanitizeBuilderToolCallRecord/u);
  assert.match(source, /tool_call_admission:\s*'verified_pre_dispatch_record'/u);
  assert.match(source, /max_public_summary_bytes/u);
  assert.match(source, /observedAtMs - toolCallRecord\.requested_at_ms > toolCallRecord\.session_policy\.limits\.max_step_timeout_ms/u);
  assert.match(source, /observedAtMs - toolCallRecord\.session_policy\.issued_at_ms > toolCallRecord\.session_policy\.limits\.max_total_timeout_ms/u);
  assert.match(source, /result_admission:\s*'fixed_summary_code_recorded'/u);
  assert.match(source, /raw_output_admission:\s*'not_included'/u);
  assert.match(source, /revision_admission:\s*'not_created'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
