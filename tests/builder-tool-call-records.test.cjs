'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  BUILDER_TOOL_CALL_RECORD_VERSION,
  TOOL_CALL_RECORD_KIND,
  BuilderToolCallRecordError,
  createBuilderToolCallRecord,
  sanitizeBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');

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

function recordInput(admission, overrides = {}) {
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

function assertRecordError(error) {
  assert.equal(error instanceof BuilderToolCallRecordError, true);
  assert.equal(error.code, 'builder_tool_call_record_invalid');
  assert.equal(error.message, 'The tool call record could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

test('creates a run-bound tool call record from an allowed permission admission without dispatching', async () => {
  const admission = await allowedAdmission();
  const record = createBuilderToolCallRecord(recordInput(admission));

  assert.equal(record.record_version, BUILDER_TOOL_CALL_RECORD_VERSION);
  assert.equal(record.record_kind, TOOL_CALL_RECORD_KIND);
  assert.equal(record.project_id, PROJECT_ID);
  assert.equal(record.conversation_id, CONVERSATION_ID);
  assert.equal(record.turn_id, TURN_ID);
  assert.equal(record.task_id, TASK_ID);
  assert.equal(record.run_id, RUN_ID);
  assert.equal(record.step_id, STEP_ID);
  assert.equal(record.tool_call_id, TOOL_CALL_ID);
  assert.equal(record.tool_name, 'filesystem.read');
  assert.deepEqual(record.lifecycle, {
    permission_admission: 'verified_allowed',
    session_policy_admission: 'verified_main_run_policy',
    dispatch_admission: 'not_started',
    execution_admission: 'not_performed',
    result_admission: 'not_recorded',
    revision_admission: 'not_created',
  });
  assert.deepEqual(record.authority, {
    record_authority: 'main_tool_call_record_contract_v1',
    admission_authority: 'main_permission_decision_before_tool_dispatch_v1',
    session_policy_authority: 'main_tool_session_policy_contract_v1',
    conversation_binding: 'ids_only_host_replay_required',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
  });
  assert.equal(record.permission_admission_receipt.evidence_digest, admission.evidence_digest);
  assert.equal(record.session_policy.policy_digest, sessionPolicy().policy_digest);
  assert.match(record.record_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.session_policy), true);
  assert.equal(Object.isFrozen(record.permission_admission_receipt), true);
  assert.equal(Object.isFrozen(record.resource), true);
  assert.deepEqual(sanitizeBuilderToolCallRecord(structuredClone(record)), record);
});

test('outer record digest covers a valid alternate session policy receipt', async () => {
  const admission = await allowedAdmission();
  const baseline = createBuilderToolCallRecord(recordInput(admission));
  const alternatePolicy = sessionPolicy({
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      max_steps: 17,
      max_raw_output_bytes: 1_024,
    },
  });
  const alternate = createBuilderToolCallRecord(recordInput(admission, {
    session_policy: alternatePolicy,
  }));

  assert.match(alternate.session_policy.policy_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(alternate.session_policy.limits.max_raw_output_bytes, 1_024);
  assert.notEqual(alternate.session_policy.policy_digest, baseline.session_policy.policy_digest);
  assert.notEqual(alternate.record_digest, baseline.record_digest);
  assert.deepEqual(sanitizeBuilderToolCallRecord(structuredClone(alternate)), alternate);
});

test('fails closed on forged permission admission, cross-project binding, or lifecycle drift', async () => {
  const admission = await allowedAdmission();
  const record = createBuilderToolCallRecord(recordInput(admission));
  const otherProjectId = 'builder-project:123e4567-e89b-42d3-a456-426614174099';

  for (const invalidInput of [
    recordInput({ ...admission, permission_decision: 'denied' }),
    recordInput({ ...admission, evidence_digest: `sha256:${'0'.repeat(64)}` }),
    recordInput({ ...admission, execution_admission: 'executed' }),
    recordInput({ ...admission, project_id: otherProjectId }),
    recordInput(admission, { session_policy: { ...sessionPolicy(), policy_digest: `sha256:${'0'.repeat(64)}` } }),
    recordInput(admission, { session_policy: sessionPolicy({ run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174099' }) }),
    recordInput(admission, { session_policy: sessionPolicy({ issued_at_ms: 51 }) }),
    recordInput(admission, { conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174099' }),
    recordInput(admission, { requested_at_ms: 49 }),
    recordInput(admission, { requested_at_ms: 120_052 }),
    recordInput(admission, { requested_at_ms: 300_050 }),
    recordInput(admission, { task_id: null }),
  ]) {
    assert.throws(() => createBuilderToolCallRecord(invalidInput), assertRecordError);
  }

  for (const drift of [
    { ...record, tool_name: 'filesystem.write' },
    { ...record, action: 'filesystem.write' },
    { ...record, resource: { ...record.resource, resource_id: 'project:/src/other.tsx' } },
    { ...record, session_policy: { ...record.session_policy, policy_digest: `sha256:${'f'.repeat(64)}` } },
    { ...record, lifecycle: { ...record.lifecycle, session_policy_admission: 'not_checked' } },
    { ...record, lifecycle: { ...record.lifecycle, execution_admission: 'performed' } },
    { ...record, authority: { ...record.authority, session_policy_authority: 'renderer_policy' } },
    { ...record, authority: { ...record.authority, renderer_authority: 'renderer_selected' } },
    { ...record, record_digest: `sha256:${'f'.repeat(64)}` },
  ]) {
    assert.throws(() => sanitizeBuilderToolCallRecord(drift), assertRecordError);
  }
});

test('rejects hostile input without invoking getters or leaking rejected material', async () => {
  const admission = await allowedAdmission();
  let getterCalls = 0;
  const accessorInput = {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: STEP_ID,
    session_policy: sessionPolicy(),
    requested_at_ms: 51,
  };
  Object.defineProperty(accessorInput, 'admission', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return admission;
    },
  });
  const sessionPolicyAccessorInput = {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: STEP_ID,
    admission,
    requested_at_ms: 51,
  };
  Object.defineProperty(sessionPolicyAccessorInput, 'session_policy', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return sessionPolicy();
    },
  });

  for (const invalid of [
    null,
    {},
    { ...recordInput(admission), extra: true },
    new Proxy(recordInput(admission), {}),
    accessorInput,
    sessionPolicyAccessorInput,
  ]) {
    assert.throws(() => createBuilderToolCallRecord(invalid), (error) => {
      assertRecordError(error);
      assert.doesNotMatch(`${error.message}\n${error.stack}`, /project:\/src\/app\.tsx|private/u);
      return true;
    });
  }
  assert.equal(getterCalls, 0);
});

test('record carries no execution result, provider, credential, Git, or renderer authority', async () => {
  const record = createBuilderToolCallRecord(recordInput(await allowedAdmission()));
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(
    serialized,
    /stdout|stderr|exit_code|result_bytes|source_tree|git_candidate_receipt|commit_oid|tree_oid|provider_id|provider_config|provider_secret|credential_secret|credential_value|secret_ref|Authorization|Bearer|ipcRenderer|BrowserWindow/iu,
  );
  assert.equal(Object.hasOwn(record, 'result'), false);
  assert.equal(Object.hasOwn(record, 'provider'), false);
  assert.equal(Object.hasOwn(record, 'git_candidate_receipt'), false);
  assert.equal(record.session_policy.authority.provider_dispatch, false);
  assert.equal(record.session_policy.authority.tool_dispatch, 'not_performed_by_policy_contract');
  assert.equal(record.session_policy.limits.max_raw_output_bytes, 0);
  assert.equal(record.authority.provider_dispatch, false);
  assert.equal(record.authority.credential_readback, false);
});

test('source remains a pure pre-dispatch record contract with no IPC, provider, Git, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-call-records.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-call-record\.v1/u);
  assert.match(source, /main_tool_call_record_contract_v1/u);
  assert.match(source, /builder-tool-session-policy\.cjs/u);
  assert.match(source, /permission_admission:\s*'verified_allowed'/u);
  assert.match(source, /session_policy_admission:\s*'verified_main_run_policy'/u);
  assert.match(source, /dispatch_admission:\s*'not_started'/u);
  assert.match(source, /execution_admission:\s*'not_performed'/u);
  assert.match(source, /requestedAtMs - admission\.evaluated_at_ms > sessionPolicy\.limits\.max_step_timeout_ms/u);
  assert.match(source, /requestedAtMs - sessionPolicy\.issued_at_ms > sessionPolicy\.limits\.max_total_timeout_ms/u);
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
