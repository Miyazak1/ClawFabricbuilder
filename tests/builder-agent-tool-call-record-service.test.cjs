'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION,
  BuilderAgentToolCallRecordServiceError,
  createBuilderAgentToolCallRecordService,
} = require('../electron/builder-agent-tool-call-record-service.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const USER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const TURN_ID = 'builder-turn:77777777-7777-4777-8777-777777777777';
const STEP_ID = 'builder-run-step:88888888-8888-4888-8888-888888888888';
const TOOL_CALL_ID = 'builder-tool-call:99999999-9999-4999-8999-999999999999';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;
const GRANT_PERMISSION_ID = `builder-permission:${'e'.repeat(64)}`;

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStore(root) {
  return createBuilderAgentSupervisedActionAdmissionStore(
    path.join(root, 'action-admissions.sqlite'),
  );
}

function requestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Prepare one tool call record without dispatch.',
    created_at_ms: 1,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Request permission before tool use.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function fixture(action = 'call_tool', index = 1) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Prepare one bounded tool call record.',
    created_at_ms: 3,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one tool call record.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: index,
      tool_call_count: 0,
      runtime_ms: 100 + index,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
  }, assignment, activeStatus, lease);
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_REF_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '1'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  const admission = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: requestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
  return { admission };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-tool-call-record-service-');
  const store = openStore(root);
  const service = createBuilderAgentToolCallRecordService({
    supervised_action_admission_store: store,
  });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { service, store };
}

function seedAdmission(store, admission) {
  store.record_admission({ admission });
  return admission;
}

function sessionPolicy(admission, overrides = {}) {
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: admission.admitted_at_ms + 1,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...overrides,
  });
}

async function permissionAdmission(admission, overrides = {}) {
  const actorId = overrides.actor_id ?? AGENT_ID;
  const evaluatedAtMs = overrides.evaluated_at_ms ?? admission.admitted_at_ms + 2;
  const guard = createBuilderToolPermissionAdmission({
    actor_id: actorId,
    now_ms: () => evaluatedAtMs,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: actorId,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: GRANT_PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
      ...(overrides.decision ?? {}),
    }),
  });
  return guard.admit({
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
  });
}

async function request(admission, overrides = {}) {
  return {
    owner_id: OWNER_ID,
    supervised_action_admission_id: admission.admission_id,
    turn_id: TURN_ID,
    step_id: STEP_ID,
    session_policy: sessionPolicy(admission, overrides.session_policy ?? {}),
    permission_admission: await permissionAdmission(admission, overrides.permission_admission ?? {}),
    requested_at_ms: overrides.requested_at_ms ?? admission.admitted_at_ms + 3,
  };
}

function assertServiceError(error, code = 'builder_agent_tool_call_record_service_invalid') {
  assert.equal(error instanceof BuilderAgentToolCallRecordServiceError, true);
  assert.equal(error.code, code);
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /private|credential|api\.deepseek|secret-value|source text|project:\/src\/app\.tsx|permission_id|raw output/iu,
  );
  return true;
}

test('creates an Agent tool call record only after a store-backed call-tool action admission', async (t) => {
  const { service, store } = serviceFor(t);
  const { admission } = fixture('call_tool', 1);
  seedAdmission(store, admission);

  const result = service.create_agent_tool_call_record(await request(admission));
  assert.equal(result.result_version, BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_TOOL_CALL_RECORD_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_tool_call_record_admitted');
  assert.equal(result.status, 'ready');
  assert.equal(result.requested_next_action, 'call_tool');
  assert.equal(result.next_gate, 'tool_call_record_required_later');
  assert.equal(result.supervised_action_admission.admission_id, admission.admission_id);
  assert.equal(result.supervised_action_admission_read.status, 'ready');
  assert.equal(result.action_task_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.action_run_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.tool_call_record.project_id, PROJECT_ID);
  assert.equal(result.tool_call_record.conversation_id, CONVERSATION_ID);
  assert.equal(result.tool_call_record.task_id, TASK_ID);
  assert.equal(result.tool_call_record.run_id, RUN_ID);
  assert.equal(result.tool_call_record.step_id, STEP_ID);
  assert.equal(result.tool_call_record.permission_admission_receipt.actor_id, AGENT_ID);
  assert.equal(result.tool_call_record.lifecycle.dispatch_admission, 'not_started');
  assert.equal(result.tool_call_record.lifecycle.execution_admission, 'not_performed');
  assert.equal(result.tool_call_record.authority.tool_dispatch, 'not_performed');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_tool_call_record_service');
  assert.equal(result.evidence.supervised_action_admission_store_authority, 'main_owned_agent_supervised_action_admission_store');
  assert.equal(result.evidence.tool_call_record_authority, 'main_tool_call_record_contract_v1');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.execution_authority, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.revision_authority, false);

  const replay = service.create_agent_tool_call_record(await request(admission));
  assert.deepEqual(replay.tool_call_record, result.tool_call_record);
});

test('fails closed without a call-tool admission or when action, actor, or timing drifts', async (t) => {
  const { service, store } = serviceFor(t);
  const { admission } = fixture('call_tool', 2);
  await assert.rejects(
    async () => service.create_agent_tool_call_record(await request(admission)),
    (error) => assertServiceError(error, 'builder_agent_tool_call_record_service_conflict'),
  );

  const finish = fixture('finish_for_review', 3).admission;
  seedAdmission(store, finish);
  await assert.rejects(
    async () => service.create_agent_tool_call_record(await request(finish)),
    (error) => assertServiceError(error),
  );

  seedAdmission(store, admission);
  await assert.rejects(
    async () => service.create_agent_tool_call_record(await request(admission, {
      permission_admission: { actor_id: USER_ID },
    })),
    (error) => assertServiceError(error),
  );
  await assert.rejects(
    async () => service.create_agent_tool_call_record(await request(admission, {
      session_policy: { issued_at_ms: admission.admitted_at_ms - 1 },
    })),
    (error) => assertServiceError(error),
  );
  await assert.rejects(
    async () => service.create_agent_tool_call_record(await request(admission, {
      requested_at_ms: admission.admitted_at_ms - 1,
    })),
    (error) => assertServiceError(error),
  );
});

test('rejects malformed stores and hostile requests without leaking private material', async (t) => {
  const { service, store } = serviceFor(t);
  const { admission } = fixture('call_tool', 4);
  seedAdmission(store, admission);

  assert.throws(
    () => createBuilderAgentToolCallRecordService({
      supervised_action_admission_store: {
        store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
      },
    }),
    (error) => assertServiceError(error),
  );
  let getterCalls = 0;
  const hostile = await request(admission);
  Object.defineProperty(hostile, 'requested_at_ms', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return admission.admitted_at_ms + 3;
    },
  });
  assert.throws(
    () => service.create_agent_tool_call_record(hostile),
    (error) => assertServiceError(error),
  );
  assert.equal(getterCalls, 0);
  const proxyRequest = await request(admission);
  assert.throws(
    () => service.create_agent_tool_call_record(new Proxy(proxyRequest, {})),
    (error) => assertServiceError(error),
  );
});

test('source boundary remains main-only and exposes no dispatch, execution, source, or IPC authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-tool-call-record-service.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_agent_tool_call_record_service/u);
  assert.match(source, /main_owned_agent_supervised_action_admission_store/u);
  assert.match(source, /main_tool_call_record_contract_v1/u);
  assert.match(source, /requested_next_action !== 'call_tool'/u);
  assert.match(source, /next_gate !== 'tool_call_record_required_later'/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /execution_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
